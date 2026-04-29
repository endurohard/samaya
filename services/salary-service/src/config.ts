import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3007),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  DEFAULT_COMPANY_ID: z.string().uuid().optional(),
  // Cross-service URLs (внутри docker-сети). Salary-service читает completed bookings
  // и пишет payouts как expense в finance.
  BOOKING_SERVICE_URL: z.string().url().default('http://booking-service:3003'),
  FINANCE_SERVICE_URL: z.string().url().default('http://finance-service:3006'),
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
