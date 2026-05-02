import pino from 'pino';
import { pool } from './db';
import { config } from './config';
import { sendMail, buildReminderEmail } from './mailer';

const log = pino({ level: config.LOG_LEVEL });

const DEFAULT_TPL_24H =
  'Привет, {client_name}! 🌸 Напоминаем: завтра в {time} у вас запись к мастеру {master_name}. Услуги: {services}. Ждём вас! 💅';
const DEFAULT_TPL_2H =
  'Напоминаем: через 2 часа ({time}) у вас запись к мастеру {master_name}. Услуги: {services}. До встречи! 🌸';

interface ReminderRow {
  id: string;
  company_id: string;
  client_phone: string | null;
  client_email: string | null;
  client_name: string | null;
  starts_at: string;
  master_name: string | null;
  services: string;
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

const REMINDER_QUERY = (window: string, sentAtCol: string) => `
  SELECT b.id, b.company_id,
         b.client_phone, b.client_name,
         b.starts_at::text AS starts_at,
         COALESCE(m.display_name, '') AS master_name,
         COALESCE(c.email::text, b.client_email) AS client_email,
         COALESCE(
           (SELECT string_agg(bs.service_name, ', ' ORDER BY bs.service_name)
            FROM bookings.booking_services bs WHERE bs.booking_id = b.id),
           ''
         ) AS services
  FROM bookings.bookings b
  LEFT JOIN salons.masters m ON m.id = b.master_id
  LEFT JOIN clients.clients c ON c.id = b.client_id
  WHERE b.company_id = $1
    AND b.status IN ('pending', 'confirmed')
    AND b.${sentAtCol} IS NULL
    AND b.starts_at BETWEEN NOW() + ${window}`;

async function processReminders(): Promise<void> {
  const companies = await pool.query<{
    company_id: string;
    timezone: string;
    wa_reminder: boolean;
    email_reminder: boolean;
    tpl_24h: string | null;
    tpl_2h: string | null;
  }>(
    `SELECT company_id,
            COALESCE(timezone, 'Europe/Moscow') AS timezone,
            COALESCE((settings_jsonb->'notifications'->>'wa_reminder')::boolean, FALSE)    AS wa_reminder,
            COALESCE((settings_jsonb->'notifications'->>'email_reminder')::boolean, FALSE)  AS email_reminder,
            settings_jsonb->'notifications'->>'wa_reminder_tpl_24h' AS tpl_24h,
            settings_jsonb->'notifications'->>'wa_reminder_tpl_2h'  AS tpl_2h
     FROM salons.company_profile
     WHERE COALESCE((settings_jsonb->'notifications'->>'wa_reminder')::boolean, FALSE) = TRUE
        OR COALESCE((settings_jsonb->'notifications'->>'email_reminder')::boolean, FALSE) = TRUE`,
  );

  if (companies.rows.length === 0) return;

  for (const company of companies.rows) {
    const { company_id, timezone, wa_reminder, email_reminder, tpl_24h, tpl_2h } = company;

    // ── 24h window ──
    const due24 = await pool.query<ReminderRow>(
      `SELECT b.id, b.company_id,
              b.client_phone, b.client_name,
              b.starts_at::text AS starts_at,
              COALESCE(m.display_name, '') AS master_name,
              COALESCE(c.email::text, '') AS client_email,
              COALESCE(
                (SELECT string_agg(bs.service_name, ', ' ORDER BY bs.service_name)
                 FROM bookings.booking_services bs WHERE bs.booking_id = b.id),
                ''
              ) AS services
       FROM bookings.bookings b
       LEFT JOIN salons.masters m ON m.id = b.master_id
       LEFT JOIN clients.clients c ON c.id = b.client_id
       WHERE b.company_id = $1
         AND b.status IN ('pending', 'confirmed')
         AND b.reminder_sent_at IS NULL
         AND b.starts_at BETWEEN NOW() + INTERVAL '23 hours' AND NOW() + INTERVAL '25 hours'`,
      [company_id],
    );

    for (const row of due24.rows) {
      let sent = false;
      if (wa_reminder && row.client_phone) {
        try {
          await sendWa(row.client_phone, fillTemplate(tpl_24h || DEFAULT_TPL_24H, row, timezone));
          sent = true;
        } catch (e) {
          log.error({ booking_id: row.id, err: (e as Error).message }, '[reminders] 24h WA FAIL');
        }
      }
      if (email_reminder && row.client_email) {
        try {
          const { subject, html } = buildReminderEmail({
            clientName: row.client_name || 'клиент',
            masterName: row.master_name || 'мастер',
            services: row.services,
            startsAt: row.starts_at,
            hoursAhead: 24,
            timezone,
          });
          await sendMail({ to: row.client_email, subject, html });
          sent = true;
        } catch (e) {
          log.error({ booking_id: row.id, err: (e as Error).message }, '[reminders] 24h email FAIL');
        }
      }
      if (sent) {
        await pool.query(`UPDATE bookings.bookings SET reminder_sent_at = NOW() WHERE id = $1`, [row.id]);
        log.info({ booking_id: row.id }, '[reminders] 24h sent');
      }
    }

    // ── 2h window ──
    const due2h = await pool.query<ReminderRow>(
      `SELECT b.id, b.company_id,
              b.client_phone, b.client_name,
              b.starts_at::text AS starts_at,
              COALESCE(m.display_name, '') AS master_name,
              COALESCE(c.email::text, '') AS client_email,
              COALESCE(
                (SELECT string_agg(bs.service_name, ', ' ORDER BY bs.service_name)
                 FROM bookings.booking_services bs WHERE bs.booking_id = b.id),
                ''
              ) AS services
       FROM bookings.bookings b
       LEFT JOIN salons.masters m ON m.id = b.master_id
       LEFT JOIN clients.clients c ON c.id = b.client_id
       WHERE b.company_id = $1
         AND b.status IN ('pending', 'confirmed')
         AND b.reminder_2h_sent_at IS NULL
         AND b.starts_at BETWEEN NOW() + INTERVAL '105 minutes' AND NOW() + INTERVAL '135 minutes'`,
      [company_id],
    );

    for (const row of due2h.rows) {
      let sent = false;
      if (wa_reminder && row.client_phone) {
        try {
          await sendWa(row.client_phone, fillTemplate(tpl_2h || DEFAULT_TPL_2H, row, timezone));
          sent = true;
        } catch (e) {
          log.error({ booking_id: row.id, err: (e as Error).message }, '[reminders] 2h WA FAIL');
        }
      }
      if (email_reminder && row.client_email) {
        try {
          const { subject, html } = buildReminderEmail({
            clientName: row.client_name || 'клиент',
            masterName: row.master_name || 'мастер',
            services: row.services,
            startsAt: row.starts_at,
            hoursAhead: 2,
            timezone,
          });
          await sendMail({ to: row.client_email, subject, html });
          sent = true;
        } catch (e) {
          log.error({ booking_id: row.id, err: (e as Error).message }, '[reminders] 2h email FAIL');
        }
      }
      if (sent) {
        await pool.query(`UPDATE bookings.bookings SET reminder_2h_sent_at = NOW() WHERE id = $1`, [row.id]);
        log.info({ booking_id: row.id }, '[reminders] 2h sent');
      }
    }
  }
}

export function startReminderScheduler(): void {
  setTimeout(() => {
    processReminders().catch((e) => log.error(e, '[reminders] tick error'));
    setInterval(() => {
      processReminders().catch((e) => log.error(e, '[reminders] tick error'));
    }, config.REMINDER_INTERVAL_MS);
  }, 60_000);

  log.info({ interval_ms: config.REMINDER_INTERVAL_MS }, '[reminders] scheduler started');
}
