import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  DEFAULT_COMPANY_ID: z.string().uuid().optional(),
  LOG_LEVEL: z.string().default('info'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('[config] Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const cfg = parsed.data;

// Fail-hard в production: запрещаем дефолтный JWT_SECRET из .env.example.
const DEFAULT_DEV_SECRET = 'please_change_me_in_production_with_a_64_byte_random_value';
if (cfg.NODE_ENV === 'production' && cfg.JWT_SECRET === DEFAULT_DEV_SECRET) {
  // eslint-disable-next-line no-console
  console.error('[config] FATAL: JWT_SECRET equals the default dev value in production. Refusing to start.');
  process.exit(1);
}

export const config = cfg;
