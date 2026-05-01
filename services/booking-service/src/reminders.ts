import pino from 'pino';
import { pool } from './db';
import { config } from './config';

const log = pino({ level: config.LOG_LEVEL });

const DEFAULT_TPL_24H =
  'Привет, {client_name}! 🌸 Напоминаем: завтра в {time} у вас запись к мастеру {master_name}. Услуги: {services}. Ждём вас! 💅';
const DEFAULT_TPL_2H =
  'Напоминаем: через 2 часа ({time}) у вас запись к мастеру {master_name}. Услуги: {services}. До встречи! 🌸';

interface ReminderRow {
  id: string;
  company_id: string;
  client_phone: string | null;
  client_name: string | null;
  starts_at: string;
  master_name: string | null;
  services: string;
  wa_reminder: boolean;
  tpl_24h: string | null;
  tpl_2h: string | null;
}

function fillTemplate(tpl: string, row: ReminderRow, tz: string): string {
  const d = new Date(row.starts_at);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  return tpl
    .replace(/\{client_name\}/g, row.client_name || 'клиент')
    .replace(/\{master_name\}/g, row.master_name || 'мастер')
    .replace(/\{services\}/g, row.services || '')
    .replace(/\{time\}/g, time);
}

async function sendWa(phone: string, message: string): Promise<void> {
  const url = `${config.WHATSAPP_SERVICE_URL}/api/whatsapp/send`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, message }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`WA send failed ${res.status}: ${body}`);
  }
}

async function processReminders(): Promise<void> {
  // Load all companies with wa_reminder enabled
  const companies = await pool.query<{ company_id: string; timezone: string; tpl_24h: string | null; tpl_2h: string | null }>(
    `SELECT company_id, COALESCE(timezone, 'Europe/Moscow') AS timezone,
            settings_jsonb->'notifications'->>'wa_reminder_tpl_24h' AS tpl_24h,
            settings_jsonb->'notifications'->>'wa_reminder_tpl_2h'  AS tpl_2h
     FROM salons.company_profile
     WHERE (settings_jsonb->'notifications'->>'wa_reminder')::boolean = TRUE`,
  );

  if (companies.rows.length === 0) return;

  for (const company of companies.rows) {
    const { company_id, timezone, tpl_24h, tpl_2h } = company;

    // ── 24h window: starts_at BETWEEN now+23h AND now+25h, reminder_sent_at IS NULL ──
    const due24 = await pool.query<ReminderRow>(
      `SELECT b.id, b.company_id,
              b.client_phone, b.client_name,
              b.starts_at::text AS starts_at,
              m.full_name AS master_name,
              COALESCE(
                (SELECT string_agg(bs.service_name, ', ' ORDER BY bs.service_name)
                 FROM bookings.booking_services bs WHERE bs.booking_id = b.id),
                ''
              ) AS services,
              TRUE AS wa_reminder,
              NULL::text AS tpl_24h, NULL::text AS tpl_2h
       FROM bookings.bookings b
       LEFT JOIN salons.masters m ON m.id = b.master_id
       WHERE b.company_id = $1
         AND b.status IN ('pending', 'confirmed')
         AND b.client_phone IS NOT NULL
         AND b.reminder_sent_at IS NULL
         AND b.starts_at BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours'`,
      [company_id],
    );

    for (const row of due24.rows) {
      try {
        const text = fillTemplate(tpl_24h || DEFAULT_TPL_24H, row, timezone);
        await sendWa(row.client_phone!, text);
        await pool.query(
          `UPDATE bookings.bookings SET reminder_sent_at = NOW() WHERE id = $1`,
          [row.id],
        );
        log.info({ booking_id: row.id, phone: row.client_phone }, '[reminders] 24h sent');
      } catch (err: unknown) {
        log.error({ booking_id: row.id, err: (err as Error).message }, '[reminders] 24h FAIL');
      }
    }

    // ── 2h window: starts_at BETWEEN now+1h45m AND now+2h15m, reminder_2h_sent_at IS NULL ──
    const due2h = await pool.query<ReminderRow>(
      `SELECT b.id, b.company_id,
              b.client_phone, b.client_name,
              b.starts_at::text AS starts_at,
              m.full_name AS master_name,
              COALESCE(
                (SELECT string_agg(bs.service_name, ', ' ORDER BY bs.service_name)
                 FROM bookings.booking_services bs WHERE bs.booking_id = b.id),
                ''
              ) AS services,
              TRUE AS wa_reminder,
              NULL::text AS tpl_24h, NULL::text AS tpl_2h
       FROM bookings.bookings b
       LEFT JOIN salons.masters m ON m.id = b.master_id
       WHERE b.company_id = $1
         AND b.status IN ('pending', 'confirmed')
         AND b.client_phone IS NOT NULL
         AND b.reminder_2h_sent_at IS NULL
         AND b.starts_at BETWEEN NOW() + INTERVAL '105 minutes' AND NOW() + INTERVAL '135 minutes'`,
      [company_id],
    );

    for (const row of due2h.rows) {
      try {
        const text = fillTemplate(tpl_2h || DEFAULT_TPL_2H, row, timezone);
        await sendWa(row.client_phone!, text);
        await pool.query(
          `UPDATE bookings.bookings SET reminder_2h_sent_at = NOW() WHERE id = $1`,
          [row.id],
        );
        log.info({ booking_id: row.id, phone: row.client_phone }, '[reminders] 2h sent');
      } catch (err: unknown) {
        log.error({ booking_id: row.id, err: (err as Error).message }, '[reminders] 2h FAIL');
      }
    }
  }
}

export function startReminderScheduler(): void {
  // First tick after 1 minute (let service fully start)
  setTimeout(() => {
    processReminders().catch((e) => log.error(e, '[reminders] tick error'));
    setInterval(() => {
      processReminders().catch((e) => log.error(e, '[reminders] tick error'));
    }, config.REMINDER_INTERVAL_MS);
  }, 60_000);

  log.info({ interval_ms: config.REMINDER_INTERVAL_MS }, '[reminders] scheduler started');
}
