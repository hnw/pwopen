import { type Browser, type BrowserContext, chromium, type Frame, type Page } from 'playwright';

import type { RuntimeOptions } from '../types';
import { config } from './config';
import { renderSixel } from './sixel';

async function navigateWithRetries(page: Page, url: string): Promise<void> {
  const maxAttempts = Math.max(0, config.navigationRetries);

  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'load', timeout: config.timeoutMs });
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

async function waitForRenderSettled(page: Page): Promise<void> {
  const settleTimeout = Math.min(5000, config.timeoutMs);

  let sawNavigation = false;
  try {
    sawNavigation = await waitForMainFrameIdle(page, 200, settleTimeout);
  } catch (error) {
    console.warn(`[WARN] Navigation idle wait failed: ${String(error)}`);
  }

  if (sawNavigation) {
    try {
      await page.waitForLoadState('load', { timeout: settleTimeout });
    } catch (error) {
      console.warn(`[WARN] Page did not reach load state: ${String(error)}`);
    }
  }

  try {
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
  } catch (error) {
    console.warn(`[WARN] Render settle check failed: ${String(error)}`);
  }

  if (config.renderWaitMs > 0) {
    await page.waitForTimeout(config.renderWaitMs);
  }
}

export async function openUrls(urls: string[], options: RuntimeOptions): Promise<void> {
  if (urls.length === 0) {
    console.warn('[WARN] No valid URLs to open.');
    return;
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let closing = false;
  let exitRequested = false;

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
        void (async () => {
          await closeResources(signal);
          const exitCode = signal === 'SIGINT' ? 130 : 143;
          process.exit(exitCode);
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
    browser = await chromium.launch({
      headless: !options.headed,
      chromiumSandbox: options.sandbox,
    });

    context = await browser.newContext({
      viewport: { width: config.viewportWidth, height: config.viewportHeight },
      userAgent: config.userAgent,
    });

    if (!context) {
      throw new Error('Browser context not initialized.');
    }

    for (const url of urls) {
      if (exitRequested) {
        break;
      }

      const page = await context.newPage();
      try {
        await navigateWithRetries(page, url);
        await waitForRenderSettled(page);

        if (options.screenshot) {
          const screenshot = await page.screenshot({
            type: 'png',
            fullPage: options.fullPage,
            scale: 'css',
          });
          await renderSixel(screenshot);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[WARN] Failed to open ${url}: ${message}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    unregisterSignalHandlers();
    await closeResources();
  }
}
