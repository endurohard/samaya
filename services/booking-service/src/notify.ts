import { pool } from './db';
import { config } from './config';
import { sendMail, buildMasterNotifyEmail } from './mailer';
import pino from 'pino';

const log = pino({ level: config.LOG_LEVEL });

export async function notifyMasterNewBooking(opts: {
  companyId: string;
  masterId: string;
  clientName: string;
  services: string;
  startsAt: string | Date;
}): Promise<void> {
  try {
    const [masterRow, settingsRow] = await Promise.all([
      pool.query(
        `SELECT display_name, phone::text AS phone, email::text AS email
         FROM salons.masters WHERE id = $1`,
        [opts.masterId],
      ),
      pool.query(
        `SELECT COALESCE(timezone, 'Europe/Moscow') AS timezone,
                COALESCE((settings_jsonb->'notifications'->>'notify_master_wa')::boolean, FALSE)    AS wa,
                COALESCE((settings_jsonb->'notifications'->>'notify_master_email')::boolean, FALSE) AS email
         FROM salons.company_profile WHERE company_id = $1`,
        [opts.companyId],
      ),
    ]);

    const master = masterRow.rows[0];
    if (!master) return;

    const settings = settingsRow.rows[0];
    if (!settings || (!settings.wa && !settings.email)) return;

    const { subject, html } = buildMasterNotifyEmail({
      masterName: master.display_name,
      clientName: opts.clientName,
      services: opts.services,
      startsAt: opts.startsAt,
      timezone: settings.timezone,
    });

    if (settings.wa && master.phone) {
      try {
        const d = new Date(opts.startsAt).toLocaleString('ru-RU', {
          day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
          timeZone: settings.timezone,
        });
        const text = `📅 Новая запись!\nКлиент: ${opts.clientName}\nДата: ${d}\nУслуги: ${opts.services}`;
        await fetch(`${config.WHATSAPP_SERVICE_URL}/api/whatsapp/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: master.phone, message: text }),
          signal: AbortSignal.timeout(10_000),
        });
      } catch (e) {
        log.warn({ err: (e as Error).message, master_id: opts.masterId }, '[notify] master WA failed');
      }
    }

    if (settings.email && master.email) {
      try {
        await sendMail({ to: master.email, subject, html });
      } catch (e) {
        log.warn({ err: (e as Error).message, master_id: opts.masterId }, '[notify] master email failed');
      }
    }
  } catch (e) {
    log.error({ err: (e as Error).message }, '[notify] notifyMasterNewBooking error');
  }
}
