import { type Span, trace, type Tracer } from '@opentelemetry/api';
import {
  type Browser,
  type BrowserContext,
  chromium,
  type Frame,
  type Page,
  type Request,
  type Response,
} from 'playwright';

import type { RuntimeOptions } from '../types.js';
import { config } from './config.js';
import { renderSixel } from './sixel.js';
import { withSpan } from './telemetry.js';

const setUrlAttributes = (span: Span, url: string): void => {
  span.setAttribute('url.full', url);
  span.setAttribute('pwopen.url.full', url);
};

type RequestTiming = ReturnType<Request['timing']>;

const isValidEpochMs = (value: number): boolean => Number.isFinite(value) && value > 0;

const durationMs = (start: number, end: number): number | null => {
  if (start < 0 || end < 0 || end < start) {
    return null;
  }
  return end - start;
};

const recordTimingAttributes = (span: Span, timing: RequestTiming): void => {
  const dnsMs = durationMs(timing.domainLookupStart, timing.domainLookupEnd);
  if (dnsMs !== null) {
    span.setAttribute('http.timing.dns_ms', dnsMs);
  }

  const tcpMs = durationMs(timing.connectStart, timing.connectEnd);
  const canSplitTls =
    timing.connectStart >= 0 &&
    timing.connectEnd >= timing.connectStart &&
    timing.secureConnectionStart >= timing.connectStart &&
    timing.secureConnectionStart <= timing.connectEnd;

  if (canSplitTls) {
    const tcpHandshakeMs = durationMs(timing.connectStart, timing.secureConnectionStart);
    if (tcpHandshakeMs !== null) {
      span.setAttribute('http.timing.tcp_handshake_ms', tcpHandshakeMs);
    }

    const tlsNegotiationMs = durationMs(timing.secureConnectionStart, timing.connectEnd);
    if (tlsNegotiationMs !== null) {
      span.setAttribute('http.timing.tls_negotiation_ms', tlsNegotiationMs);
    }
  } else if (tcpMs !== null) {
    span.setAttribute('http.timing.tcp_handshake_ms', tcpMs);
  }

  if (tcpMs !== null) {
    span.setAttribute('http.timing.tcp_ms', tcpMs);
  }

  const ttfbMs = durationMs(timing.requestStart, timing.responseStart);
  if (ttfbMs !== null) {
    span.setAttribute('http.timing.ttfb_ms', ttfbMs);
  }
};

const buildRedirectChain = (response: Response): Request[] => {
  const chain: Request[] = [];
  let current: Request | null = response.request();
  while (current) {
    chain.unshift(current);
    current = current.redirectedFrom();
  }
  return chain;
};

const recordFinalNavigationAttributes = (
  span: Span,
  finalRequest: Request,
  finalResponse: Response | null,
): void => {
  span.setAttribute('pwopen.url.final', finalRequest.url());
  if (finalResponse) {
    span.setAttribute('http.response.status', finalResponse.status());
  }
};

const startHopSpan = (tracer: Tracer, name: string, timing: RequestTiming): Span => {
  const hopStartTime = isValidEpochMs(timing.startTime) ? timing.startTime : undefined;
  return hopStartTime
    ? tracer.startSpan(name, { startTime: hopStartTime })
    : tracer.startSpan(name);
};

const endHopSpan = (span: Span, timing: RequestTiming): void => {
  const hopStartTime = isValidEpochMs(timing.startTime) ? timing.startTime : undefined;
  const hopEndTime =
    hopStartTime !== undefined && timing.responseEnd >= 0
      ? hopStartTime + timing.responseEnd
      : undefined;
  if (hopEndTime !== undefined && hopEndTime >= (hopStartTime ?? 0)) {
    span.end(hopEndTime);
  } else {
    span.end();
  }
};

const hopSpanName = (isFinal: boolean, response: Response | null): string => {
  if (isFinal) {
    return 'page.navigate.final';
  }
  const status = response?.status();
  return `page.navigate.redirect_${status ?? '30x'}`;
};

const recordRedirectSpans = async (tracer: Tracer, chain: Request[]): Promise<void> => {
  for (let index = 0; index < chain.length; index += 1) {
    const hopRequest = chain[index];
    const hopResponse = await hopRequest.response();
    const hopTiming = hopRequest.timing();
    const isFinal = index === chain.length - 1;
    const hopName = hopSpanName(isFinal, hopResponse);
    const hopSpan = startHopSpan(tracer, hopName, hopTiming);

    setUrlAttributes(hopSpan, hopRequest.url());
    if (hopResponse) {
      hopSpan.setAttribute('http.response.status', hopResponse.status());
    }
    recordTimingAttributes(hopSpan, hopTiming);
    endHopSpan(hopSpan, hopTiming);
  }
};

const recordNavigationTiming = async (
  span: Span,
  response: Response,
  tracer: Tracer,
): Promise<void> => {
  const chain = buildRedirectChain(response);
  if (chain.length === 0) {
    return;
  }

  const finalRequest = chain[chain.length - 1];
  const finalResponse = (await finalRequest.response()) ?? response;
  recordFinalNavigationAttributes(span, finalRequest, finalResponse);

  if (chain.length === 1) {
    recordTimingAttributes(span, finalRequest.timing());
    return;
  }

  span.setAttribute('pwopen.redirect.count', chain.length - 1);
  await recordRedirectSpans(tracer, chain);
};

async function navigateWithRetries(page: Page, url: string, tracer: Tracer): Promise<void> {
  const maxAttempts = Math.max(0, config.navigationRetries);

  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    try {
      await withSpan(tracer, 'page.navigate', async (span) => {
        span.setAttribute('pwopen.navigation.attempt', attempt);
        setUrlAttributes(span, url);

        const response = await page.goto(url, { waitUntil: 'load', timeout: config.timeoutMs });
        if (response) {
          try {
            await recordNavigationTiming(span, response, tracer);
          } catch (error) {
            console.warn(`[WARN] Failed to record navigation timing: ${String(error)}`);
          }
        }
      });

      return;
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }
      console.warn(`[WARN] Navigation failed, retrying (${attempt + 1}/${maxAttempts}): ${url}`);
    }
  }
}

async function waitForMainFrameIdle(
  page: Page,
  idleMs: number,
  timeoutMs: number,
): Promise<boolean> {
  const mainFrame = page.mainFrame();

  return new Promise<boolean>((resolve) => {
    let idleTimer: NodeJS.Timeout | undefined;
    const timeoutTimer: NodeJS.Timeout = setTimeout(() => {
      finish();
    }, timeoutMs);
    let settled = false;
    let sawNavigation = false;

    const cleanup = () => {
      page.off('framenavigated', onNavigated);
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
      }
    };

    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      resolve(sawNavigation);
    };

    const scheduleIdle = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        finish();
      }, idleMs);
    };

    const onNavigated = (frame: Frame) => {
      if (frame === mainFrame) {
        sawNavigation = true;
        scheduleIdle();
      }
    };

    page.on('framenavigated', onNavigated);
    scheduleIdle();
  });
}

async function waitForRenderSettled(page: Page, tracer: Tracer): Promise<void> {
  const settleTimeout = Math.min(5000, config.timeoutMs);

  let sawNavigation = false;
  try {
    sawNavigation = await withSpan(tracer, 'render.wait.main_frame_idle', async (span) => {
      span.setAttribute('pwopen.idle_ms', 200);
      span.setAttribute('pwopen.settle_timeout_ms', settleTimeout);
      const result = await waitForMainFrameIdle(page, 200, settleTimeout);
      span.setAttribute('pwopen.saw_navigation', result);
      return result;
    });
  } catch (error) {
    console.warn(`[WARN] Navigation idle wait failed: ${String(error)}`);
  }

  if (sawNavigation) {
    try {
      await withSpan(tracer, 'render.wait.load_state', async (span) => {
        span.setAttribute('pwopen.timeout_ms', settleTimeout);
        await page.waitForLoadState('load', { timeout: settleTimeout });
      });
    } catch (error) {
      console.warn(`[WARN] Page did not reach load state: ${String(error)}`);
    }
  }

  try {
    await withSpan(tracer, 'render.wait.fonts_raf', async () => {
      await page.evaluate(async () => {
        const fontsReady = (document as { fonts?: { ready?: Promise<unknown> } }).fonts?.ready;
        if (fontsReady) {
          await fontsReady;
        }

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      });
    });
  } catch (error) {
    console.warn(`[WARN] Render settle check failed: ${String(error)}`);
  }

  if (config.renderWaitMs > 0) {
    await withSpan(tracer, 'render.wait.post_delay', async (span) => {
      span.setAttribute('pwopen.render_wait_ms', config.renderWaitMs);
      await page.waitForTimeout(config.renderWaitMs);
    });
  }
}

export async function openUrls(
  urls: string[],
  options: RuntimeOptions,
  tracerOverride?: Tracer,
): Promise<number> {
  if (urls.length === 0) {
    console.warn('[WARN] No valid URLs to open.');
    return 0;
  }

  const tracer = tracerOverride ?? trace.getTracer('pwopen');
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let closing = false;
  let exitRequested = false;
  let failedCount = 0;

  const closeResources = async (reason?: string): Promise<void> => {
    if (closing) {
      return;
    }
    closing = true;

    if (reason) {
      console.warn(`[WARN] Received ${reason}, closing browser...`);
    }

    if (context) {
      try {
        await context.close();
      } catch (error) {
        console.warn(`[WARN] Failed to close context: ${String(error)}`);
      } finally {
        context = null;
      }
    }

    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        console.warn(`[WARN] Failed to close browser: ${String(error)}`);
      } finally {
        browser = null;
      }
    }
  };

  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const registerSignalHandlers = () => {
    (['SIGINT', 'SIGTERM'] as const).forEach((signal) => {
      const handler = () => {
        if (exitRequested) {
          return;
        }
        exitRequested = true;
        process.exitCode = signal === 'SIGINT' ? 130 : 143;
        void (async () => {
          await closeResources(signal);
        })();
      };
      signalHandlers.set(signal, handler);
      process.once(signal, handler);
    });
  };

  const unregisterSignalHandlers = () => {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    signalHandlers.clear();
  };

  registerSignalHandlers();

  try {
    await withSpan(tracer, 'browser.start', async (span) => {
      span.setAttribute('pwopen.headed', options.headed);
      span.setAttribute('pwopen.sandbox', options.sandbox);
      browser = await chromium.launch({
        headless: !options.headed,
        chromiumSandbox: options.sandbox,
      });

      context = await browser.newContext({
        viewport: { width: config.viewportWidth, height: config.viewportHeight },
        userAgent: config.userAgent,
      });
    });
    if (!browser || !context) {
      throw new Error('Browser initialization failed.');
    }

    for (const url of urls) {
      if (exitRequested) {
        break;
      }

      if (!context) {
        throw new Error('Browser context is not initialized');
      }
      const page = await (context as BrowserContext).newPage();
      try {
        await withSpan(tracer, 'page.process', async (span) => {
          setUrlAttributes(span, url);
          await navigateWithRetries(page, url, tracer);
          await withSpan(tracer, 'page.render_wait', async () => {
            await waitForRenderSettled(page, tracer);
          });
          if (options.screenshot) {
            const screenshot = await withSpan(tracer, 'page.screenshot', async (shotSpan) => {
              shotSpan.setAttribute('pwopen.full_page', options.fullPage);
              return page.screenshot({
                type: 'png',
                fullPage: options.fullPage,
                scale: 'css',
              });
            });
            await withSpan(tracer, 'sixel.convert', async () => {
              await renderSixel(screenshot);
            });
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[WARN] Failed to open ${url}: ${message}`);
        failedCount += 1;
      } finally {
        try {
          await page.close();
        } catch (error) {
          console.warn(`[WARN] Failed to close page: ${String(error)}`);
        }
      }
    }
  } finally {
    unregisterSignalHandlers();
    await closeResources();
  }

  return failedCount;
}
