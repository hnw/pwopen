import {
  type Span,
  type SpanOptions,
  SpanStatusCode,
  trace,
  type Tracer,
} from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

const SERVICE_NAME = 'pwopen';

export type Telemetry = {
  tracer: Tracer;
  shutdown: () => Promise<void>;
  enabled: boolean;
};

function normalizeOtlpEndpoint(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/g, '');
  if (!trimmed) {
    return trimmed;
  }

  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/g, '');
    if (path === '' || path === '/') {
      url.pathname = '/v1/traces';
      return url.toString();
    }
    if (path === '/v1/traces') {
      url.pathname = '/v1/traces';
      return url.toString();
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

export function initTelemetry(): Telemetry {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) {
    return {
      tracer: trace.getTracer(SERVICE_NAME),
      shutdown: async () => undefined,
      enabled: false,
    };
  }

  const resource = new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: SERVICE_NAME,
  });

  const provider = new NodeTracerProvider({ resource });
  const exporter = new OTLPTraceExporter({
    url: normalizeOtlpEndpoint(endpoint),
  });
  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();

  const tracer = trace.getTracer(SERVICE_NAME);
  let shuttingDown: Promise<void> | null = null;

  const shutdown = async () => {
    if (!shuttingDown) {
      shuttingDown = provider.shutdown().catch((error) => {
        console.warn(`[WARN] Telemetry shutdown failed: ${String(error)}`);
      });
    }
    await shuttingDown;
  };

  return { tracer, shutdown, enabled: true };
}

const recordErrorAttributes = (span: Span, error: unknown): void => {
  if (error instanceof Error) {
    const type = error.name || 'Error';
    span.setAttribute('exception.type', type);
    span.setAttribute('exception.message', error.message);
    return;
  }

  const message = String(error);
  span.setAttribute('exception.type', typeof error);
  span.setAttribute('exception.message', message);
};

function recordSpanError(span: Span, error: unknown): void {
  recordErrorAttributes(span, error);
  if (error instanceof Error) {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return;
  }
  span.recordException(String(error));
  span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
}

export async function withSpan<T>(
  tracer: Tracer,
  name: string,
  fn: (span: Span) => Promise<T>,
  options?: SpanOptions,
): Promise<T> {
  return tracer.startActiveSpan(name, options ?? {}, async (span) => {
    try {
      return await fn(span);
    } catch (error) {
      recordSpanError(span, error);
      throw error;
    } finally {
      span.end();
    }
  });
}
