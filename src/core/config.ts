import { z } from 'zod';

const EnvSchema = z
  .object({
    PWOPEN_TIMEOUT_MS: z.string().optional(),
    PWOPEN_VIEWPORT_WIDTH: z.string().optional(),
    PWOPEN_VIEWPORT_HEIGHT: z.string().optional(),
    PWOPEN_USER_AGENT: z.string().optional(),
    PWOPEN_NAVIGATION_RETRIES: z.string().optional(),
    PWOPEN_RENDER_WAIT_MS: z.string().optional(),
  })
  .passthrough();

const ConfigSchema = z.object({
  timeoutMs: z.coerce.number().int().positive().default(15000),
  viewportWidth: z.coerce.number().int().positive().default(1280),
  viewportHeight: z.coerce.number().int().positive().default(720),
  userAgent: z.string().trim().min(1).optional(),
  navigationRetries: z.coerce.number().int().nonnegative().default(0),
  renderWaitMs: z.coerce.number().int().nonnegative().default(200),
});

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join('.') || 'config';
      return `${path}: ${issue.message}`;
    })
    .join(', ');
}

export type AppConfig = z.infer<typeof ConfigSchema>;

export const config: AppConfig = (() => {
  const env = EnvSchema.parse(process.env);
  const parsed = ConfigSchema.safeParse({
    timeoutMs: env.PWOPEN_TIMEOUT_MS,
    viewportWidth: env.PWOPEN_VIEWPORT_WIDTH,
    viewportHeight: env.PWOPEN_VIEWPORT_HEIGHT,
    userAgent: env.PWOPEN_USER_AGENT,
    navigationRetries: env.PWOPEN_NAVIGATION_RETRIES,
    renderWaitMs: env.PWOPEN_RENDER_WAIT_MS,
  });

  if (!parsed.success) {
    throw new Error(`Invalid configuration: ${formatZodError(parsed.error)}`);
  }

  return parsed.data;
})();
