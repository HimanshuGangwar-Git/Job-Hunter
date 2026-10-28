import { z } from 'zod';

const boolFromString = (defaultValue: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((value) => (value === undefined ? defaultValue : value === 'true' || value === '1'));

const csv = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const optionalString = z
  .string()
  .optional()
  .transform((value) => (value && value.trim() !== '' ? value.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  STORAGE_DIR: z.string().default('./storage'),

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default('claude-sonnet-5-5'),

  // Public, documented job-board APIs for company career pages.
  GREENHOUSE_BOARDS: csv,
  LEVER_COMPANIES: csv,
  RSS_FEEDS: csv,

  // Licensed or partner feeds only. Each must return the Job Hunter JSON feed format (see README).
  LINKEDIN_FEED_URL: optionalString,
  INDEED_FEED_URL: optionalString,
  NAUKRI_FEED_URL: optionalString,
  INTERNSHALA_FEED_URL: optionalString,
  APNA_FEED_URL: optionalString,
  JOBHAI_FEED_URL: optionalString,
  LICENSED_FEED_API_KEY: optionalString,

  ENABLE_MOCK_SOURCE: boolFromString(false),
  SCHEDULER_ENABLED: boolFromString(true),
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1000).default(60_000),
});

export type AppConfig = z.infer<typeof schema> & {
  isProduction: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    throw new Error(`Invalid configuration: ${details}`);
  }
  const config = parsed.data;
  return { ...config, isProduction: config.NODE_ENV === 'production' };
}
