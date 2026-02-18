import { z } from 'zod';

const configSchema = z.object({
  XAI_API_KEY: z.string().min(1, 'XAI_API_KEY is required'),
  X_API_BEARER_TOKEN: z.string().min(1).optional(),
  X_API_CLIENT_ID: z.string().optional(),
  X_API_CLIENT_SECRET: z.string().optional(),
  GROK_MODEL: z.string().default('grok-4-1-fast-reasoning'),
  GROK_TAGGING_MODEL: z.string().default('grok-3-mini'),
  X_RECON_DB_PATH: z.string().optional(),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map(i => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Missing or invalid environment variables:\n${missing}`);
  }

  _config = result.data;
  return _config;
}
