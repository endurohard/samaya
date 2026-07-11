import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3002),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  DEFAULT_COMPANY_ID: z.string().uuid().optional(),
  LOG_LEVEL: z.string().default('info'),
  // Каталог для загруженных медиа (видео-превью услуг). Тот же volume монтируется
  // read-only в nginx фронта и раздаётся как /media/*.
  MEDIA_DIR: z.string().default('/data/media'),
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
