import pino from 'pino';
import { pool } from './db';
import { config } from './config';
import { sendMail, buildReminderEmail, buildBirthdayEmail } from './mailer';

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
    headers: {
      'Content-Type': 'application/json',
      'X-Internal-Token': config.WHATSAPP_INTERNAL_TOKEN,
    },
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

// ── Birthday greetings ──────────────────────────────────────────────────────

async function processBirthdays(): Promise<void> {
  const companies = await pool.query<{
    company_id: string;
    timezone: string;
    wa_birthday: boolean;
    email_birthday: boolean;
    birthday_tpl: string | null;
    salon_name: string | null;
  }>(
    `SELECT cp.company_id,
            COALESCE(cp.timezone, 'Europe/Moscow') AS timezone,
            COALESCE((cp.settings_jsonb->'notifications'->>'birthday_wa')::boolean, FALSE)    AS wa_birthday,
            COALESCE((cp.settings_jsonb->'notifications'->>'birthday_email')::boolean, FALSE) AS email_birthday,
            cp.settings_jsonb->'notifications'->>'birthday_tpl' AS birthday_tpl,
            cp.name AS salon_name
     FROM salons.company_profile cp
     WHERE COALESCE((cp.settings_jsonb->'notifications'->>'birthday_wa')::boolean, FALSE)    = TRUE
        OR COALESCE((cp.settings_jsonb->'notifications'->>'birthday_email')::boolean, FALSE) = TRUE`,
  );
  if (companies.rows.length === 0) return;

  for (const company of companies.rows) {
    const { company_id, timezone, wa_birthday, email_birthday, birthday_tpl, salon_name } = company;

    // today in company timezone
    const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone }); // YYYY-MM-DD
    const [yyyy, mm, dd] = todayStr.split('-');

    const clients = await pool.query<{
      id: string;
      full_name: string;
      phone: string;
      email: string | null;
      birthday_last_sent: string | null;
    }>(
      `SELECT id, full_name, phone::text AS phone, email::text AS email, birthday_last_sent::text
       FROM clients.clients
       WHERE company_id = $1
         AND is_deleted = FALSE AND is_blocked = FALSE
         AND birthday IS NOT NULL
         AND EXTRACT(MONTH FROM birthday) = $2
         AND EXTRACT(DAY   FROM birthday) = $3
         AND (birthday_last_sent IS NULL
              OR EXTRACT(YEAR FROM birthday_last_sent) < $4::int)`,
      [company_id, mm, dd, yyyy],
    );

    for (const cl of clients.rows) {
      let sent = false;

      if (wa_birthday && cl.phone) {
        try {
          const tpl = birthday_tpl
            || 'С Днём рождения, {client_name}! 🎂 Мы рады видеть вас в нашем салоне. Приходите — ждём вас с удовольствием! 💅';
          const msg = tpl
            .replace(/\{client_name\}/g, cl.full_name)
            .replace(/\{salon_name\}/g, salon_name || 'Samaya');
          await sendWa(cl.phone, msg);
          sent = true;
        } catch (e) {
          log.warn({ client_id: cl.id, err: (e as Error).message }, '[birthday] WA FAIL');
        }
      }

      if (email_birthday && cl.email) {
        try {
          const { subject, html } = buildBirthdayEmail({
            clientName: cl.full_name,
            salonName: salon_name || 'Samaya',
            customText: birthday_tpl,
          });
          await sendMail({ to: cl.email, subject, html });
          sent = true;
        } catch (e) {
          log.warn({ client_id: cl.id, err: (e as Error).message }, '[birthday] email FAIL');
        }
      }

      if (sent) {
        await pool.query(
          `UPDATE clients.clients SET birthday_last_sent = $1 WHERE id = $2`,
          [todayStr, cl.id],
        );
        log.info({ client_id: cl.id, full_name: cl.full_name }, '[birthday] sent');
      }
    }
  }
}

export function startReminderScheduler(): void {
  setTimeout(() => {
    processReminders().catch((e) => log.error(e, '[reminders] tick error'));
    processBirthdays().catch((e) => log.error(e, '[birthday] tick error'));
    setInterval(() => {
      processReminders().catch((e) => log.error(e, '[reminders] tick error'));
    }, config.REMINDER_INTERVAL_MS);
    // Birthday check раз в час
    setInterval(() => {
      processBirthdays().catch((e) => log.error(e, '[birthday] tick error'));
    }, 60 * 60 * 1000);
  }, 60_000);

  log.info({ interval_ms: config.REMINDER_INTERVAL_MS }, '[reminders] scheduler started');
}
