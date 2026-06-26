import type { PoolClient } from 'pg';
import pino from 'pino';
import { pool } from './db';
import { config } from './config';
import { sendMail } from './mailer';

const log = pino({ level: config.LOG_LEVEL });

export type NotificationChannel = 'wa' | 'email';

interface EnqueueInput {
  companyId: string;
  channel: NotificationChannel;
  recipient: string;
  kind: string;
  sourceId?: string | null;
  // wa → { message }, email → { subject, html }
  payload: Record<string, unknown>;
}

/**
 * Ставит уведомление в очередь. Принимает PoolClient, чтобы запись попала в ту же
 * транзакцию, что и бизнес-операция (например создание брони) — at-least-once.
 */
export async function enqueueNotification(
  client: PoolClient,
  input: EnqueueInput,
): Promise<void> {
  await client.query(
    `INSERT INTO bookings.notification_outbox
       (company_id, channel, recipient, payload, kind, source_id)
     VALUES ($1, $2, $3, $4::jsonb, $5, $6)`,
    [
      input.companyId,
      input.channel,
      input.recipient,
      JSON.stringify(input.payload),
      input.kind,
      input.sourceId ?? null,
    ],
  );
}

async function sendWa(phone: string, message: string): Promise<void> {
  const res = await fetch(`${config.WHATSAPP_SERVICE_URL}/api/whatsapp/send`, {
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
    throw new Error(`WA ${res.status}: ${body.slice(0, 200)}`);
  }
}

interface OutboxRow {
  id: string;
  channel: NotificationChannel;
  recipient: string;
  payload: { message?: string; subject?: string; html?: string };
  attempts: number;
  max_attempts: number;
}

async function deliver(row: OutboxRow): Promise<void> {
  if (row.channel === 'wa') {
    await sendWa(row.recipient, row.payload.message ?? '');
  } else {
    await sendMail({
      to: row.recipient,
      subject: row.payload.subject ?? '',
      html: row.payload.html ?? '',
    });
  }
}

// Экспоненциальный backoff: 1, 2, 4, 8, 16 минут
function backoffInterval(attempts: number): string {
  const minutes = Math.min(2 ** attempts, 16);
  return `${minutes} minutes`;
}

async function processBatch(batchSize: number): Promise<number> {
  const client = await pool.connect();
  let processed = 0;
  try {
    await client.query('BEGIN');
    const { rows } = await client.query<OutboxRow>(
      `SELECT id, channel, recipient, payload, attempts, max_attempts
       FROM bookings.notification_outbox
       WHERE status = 'pending' AND next_attempt_at <= NOW()
       ORDER BY id
       FOR UPDATE SKIP LOCKED
       LIMIT $1`,
      [batchSize],
    );

    for (const row of rows) {
      try {
        await deliver(row);
        await client.query(
          `UPDATE bookings.notification_outbox
           SET status = 'sent', sent_at = NOW(), attempts = attempts + 1
           WHERE id = $1`,
          [row.id],
        );
        processed++;
      } catch (e) {
        const attempts = row.attempts + 1;
        const err = (e as Error).message;
        if (attempts >= row.max_attempts) {
          await client.query(
            `UPDATE bookings.notification_outbox
             SET status = 'failed', attempts = $2, last_error = $3
             WHERE id = $1`,
            [row.id, attempts, err],
          );
          log.error({ id: row.id, channel: row.channel, attempts }, '[notif-outbox] giving up');
        } else {
          await client.query(
            `UPDATE bookings.notification_outbox
             SET attempts = $2, last_error = $3,
                 next_attempt_at = NOW() + ($4)::interval
             WHERE id = $1`,
            [row.id, attempts, err, backoffInterval(attempts)],
          );
          log.warn({ id: row.id, channel: row.channel, attempts, err }, '[notif-outbox] retry scheduled');
        }
      }
    }
    await client.query('COMMIT');
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    log.error({ err: (e as Error).message }, '[notif-outbox] batch error');
  } finally {
    client.release();
  }
  return processed;
}

export function startNotificationWorker(): void {
  if (!config.NOTIF_WORKER_ENABLED) {
    log.info('[notif-outbox] worker disabled');
    return;
  }
  const tick = () => {
    processBatch(config.NOTIF_WORKER_BATCH).catch((e) =>
      log.error({ err: (e as Error).message }, '[notif-outbox] tick error'),
    );
  };
  setInterval(tick, config.NOTIF_WORKER_INTERVAL_MS);
  log.info({ interval_ms: config.NOTIF_WORKER_INTERVAL_MS }, '[notif-outbox] worker started');
}
