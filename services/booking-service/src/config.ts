import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3003),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  DEFAULT_COMPANY_ID: z.string().uuid().optional(),
  // Часовой пояс компании для перевода (work_date, start_time/end_time) в UTC.
  // Format: '+03:00', '-05:00'. Для samaya — Europe/Moscow.
  COMPANY_TZ_OFFSET: z.string().regex(/^[+-]\d{2}:\d{2}$/).default('+03:00'),
  SLOT_STEP_MINUTES: z.coerce.number().int().positive().default(15),
  LOG_LEVEL: z.string().default('info'),
  WHATSAPP_SERVICE_URL: z.string().url().default('http://whatsapp-service:3008'),
  // Интервал проверки напоминаний (мс). По умолчанию 10 минут.
  REMINDER_INTERVAL_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  // Базовый URL фронтенда для генерации ссылки на отзыв
  FRONTEND_URL: z.string().url().default('http://localhost:3010'),
  // SMTP (Mailhog for dev)
  SMTP_HOST: z.string().default('samaya-mailhog'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: z.coerce.boolean().default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().email().default('noreply@samaya.pro'),
  SMTP_FROM_NAME: z.string().default('Samaya'),
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
