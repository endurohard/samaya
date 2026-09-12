import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3009),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 chars'),
  DEFAULT_COMPANY_ID: z.string().uuid(),
  LOG_LEVEL: z.string().default('info'),

  // ВАТС: ключ организации выпускается в портале (Интеграции → «Ключи для
  // страницы»). Живёт только здесь — в браузер не отдаётся никогда.
  VATS_BASE_URL: z.string().url().default('https://vats05.ru/api/public'),
  VATS_API_KEY: z.string().min(8),
  VATS_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  // Там, где у контейнеров нет прямого выхода в интернет, наружу ходим через
  // мост до прокси хоста (см. egress-proxy). Пусто — идём напрямую.
  VATS_PROXY_URL: z.string().url().optional().or(z.literal('').transform(() => undefined)),

  // Синхронизация журнала. Окно перекрытия — не оптимизация, а необходимость:
  // запись разговора появляется в ВАТС через несколько секунд после отбоя, а
  // длительность и статус доуточняются, поэтому последние сутки перечитываем
  // каждый раз. Upsert по uuid делает это безопасным.
  SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(180_000),
  SYNC_OVERLAP_HOURS: z.coerce.number().int().positive().default(24),
  SYNC_INITIAL_DAYS: z.coerce.number().int().positive().default(90),
  SYNC_PAGE_SIZE: z.coerce.number().int().positive().max(500).default(500),

  // Кэш записей разговоров.
  RECORDINGS_DIR: z.string().default('/data/recordings'),
  RECORDINGS_TTL_DAYS: z.coerce.number().int().positive().default(30),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('[config] Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
