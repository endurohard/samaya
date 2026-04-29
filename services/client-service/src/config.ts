import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3004),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  DEFAULT_COMPANY_ID: z.string().uuid().optional(),
  LOG_LEVEL: z.string().default('info'),
  // Параметры сегментации (DIKIDI: постоянные = 2+ за 3 мес; спящие = 3-6 мес; пропавшие = >6 мес)
  CLIENT_REGULAR_VISITS: z.coerce.number().int().positive().default(2),
  CLIENT_REGULAR_DAYS: z.coerce.number().int().positive().default(90),     // 3 месяца
  CLIENT_SLEEPING_DAYS: z.coerce.number().int().positive().default(90),
  CLIENT_MISSING_DAYS: z.coerce.number().int().positive().default(180),    // 6 месяцев
  CLIENT_NEW_PERIOD_DAYS: z.coerce.number().int().positive().default(7),   // окно для "Новые"
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('[config] Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
