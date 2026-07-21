import { z } from 'zod';

// z.coerce.boolean() трактует ЛЮБУЮ непустую строку (включая "false") как true.
// Этот хелпер корректно парсит строковые env-флаги.
const boolFromEnv = (def: boolean) =>
  z.preprocess(
    (v) => (v === undefined ? def : v === true || v === 'true' || v === '1'),
    z.boolean(),
  );

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
  FINANCE_SERVICE_URL: z.string().url().default('http://finance-service:3006'),
  // Внутренний токен для service-to-service вызовов whatsapp-service
  WHATSAPP_INTERNAL_TOKEN: z.string().default('dev_internal_token'),
  // Интервал проверки напоминаний (мс). По умолчанию 10 минут.
  REMINDER_INTERVAL_MS: z.coerce.number().int().positive().default(10 * 60 * 1000),
  // Воркер очереди уведомлений (notification_outbox)
  NOTIF_WORKER_ENABLED: boolFromEnv(true),
  NOTIF_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(15_000),
  NOTIF_WORKER_BATCH: z.coerce.number().int().positive().default(20),
  // Базовый URL фронтенда для генерации ссылки на отзыв
  FRONTEND_URL: z.string().url().default('http://localhost:3010'),
  // SMTP (Mailhog for dev)
  SMTP_HOST: z.string().default('samaya-mailhog'),
  SMTP_PORT: z.coerce.number().int().positive().default(1025),
  SMTP_SECURE: boolFromEnv(false),
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
if (cfg.NODE_ENV === 'production' && cfg.WHATSAPP_INTERNAL_TOKEN === 'dev_internal_token') {
  // eslint-disable-next-line no-console
  console.error('[config] FATAL: default WHATSAPP_INTERNAL_TOKEN in production');
  process.exit(1);
}

export const config = cfg;
