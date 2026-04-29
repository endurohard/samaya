import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3005),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  DEFAULT_COMPANY_ID: z.string().uuid().optional(),
  DEFAULT_WAREHOUSE_ID: z.string().uuid().optional(),
  CONSUME_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(10_000),
  CONSUME_WORKER_BATCH: z.coerce.number().int().positive().default(20),
  CONSUME_WORKER_ENABLED: z.preprocess(
    (v) => v === undefined ? true : (v === 'true' || v === '1' || v === true),
    z.boolean(),
  ),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('[config] Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}
const cfg = parsed.data;
const DEFAULT_DEV_SECRET = 'please_change_me_in_production_with_a_64_byte_random_value';
if (cfg.NODE_ENV === 'production' && cfg.JWT_SECRET === DEFAULT_DEV_SECRET) {
  // eslint-disable-next-line no-console
  console.error('[config] FATAL: default JWT_SECRET in production');
  process.exit(1);
}
export const config = cfg;
