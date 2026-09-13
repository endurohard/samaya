import type { Logger } from 'pino';
import { config } from './config';
import { pool } from './db';
import { listCalls, listEmployees, listTickets, type VatsCall, type VatsTicket } from './vats';

// Зеркалирование журнала звонков из ВАТС.
//
// Синхронизация всегда перечитывает последние сутки, а не «то, что после
// курсора»: запись разговора появляется через несколько секунд после отбоя, и
// длительность со статусом доуточняются уже после первого появления звонка в
// выдаче. Upsert по uuid делает повторное чтение безвредным.

const companyId = config.DEFAULT_COMPANY_ID;

/** Последние 10 цифр номера — единственная форма, в которой сходятся +7…, 8… и 7…. */
function digits(n: string | null): string | null {
  if (!n) return null;
  const d = n.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d : null;
}

async function upsertCalls(calls: VatsCall[]): Promise<number> {
  if (!calls.length) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const c of calls) {
      await client.query(
        `INSERT INTO telephony.calls
           (id, company_id, started_at, direction, client_number, client_digits,
            client_name_vats, line, extension, duration_sec, status, has_recording, handled_by, synced_at)
         VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
         ON CONFLICT (id) DO UPDATE SET
           duration_sec = EXCLUDED.duration_sec,
           status = EXCLUDED.status,
           has_recording = EXCLUDED.has_recording,
           handled_by = COALESCE(EXCLUDED.handled_by, telephony.calls.handled_by),
           client_name_vats = COALESCE(EXCLUDED.client_name_vats, telephony.calls.client_name_vats),
           -- Ответивший на входящий может прийти позже (из событий), поэтому
           -- не затираем уже известный внутренний номер пустым значением.
           extension = COALESCE(EXCLUDED.extension, telephony.calls.extension),
           line = COALESCE(EXCLUDED.line, telephony.calls.line),
           synced_at = NOW()`,
        [
          c.id, companyId, c.at, c.direction, c.client_number, digits(c.client_number),
          c.client_name, c.line, c.employee, Math.max(0, Number(c.duration) || 0),
          c.status, Boolean(c.recording), c.handled_by ?? null,
        ],
      );
    }
    await client.query('COMMIT');
    return calls.length;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { /* соединение уже мертво */ });
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Связи звонка с нашими данными считаем на своей стороне пачкой, а не при
 * вставке каждой строки: сотрудник может быть привязан к номеру позже, а
 * клиент — заведён после звонка, и тогда старые строки тоже должны подтянуться.
 */
/**
 * Заявка из ВАТС → наша таблица. Одна и та же функция для синхронизации и для
 * события ai_ticket: событие приходит первым и неполным, синхронизация
 * доуточняет; статус сходится в обе стороны (последнее слово за ВАТС, кроме
 * нашей отметки handled_at — она только наша).
 */
export async function upsertTicket(t: VatsTicket): Promise<void> {
  await pool.query(
    `INSERT INTO telephony.ai_tickets
       (id, company_id, created_at, kind, status, client_number, client_digits, client_name,
        when_text, service, specialist, comment, summary, call_id, has_recording, synced_at)
     VALUES ($1, $2, $3::timestamptz, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
     ON CONFLICT (id) DO UPDATE SET
       status = EXCLUDED.status,
       client_name = COALESCE(EXCLUDED.client_name, telephony.ai_tickets.client_name),
       when_text = COALESCE(EXCLUDED.when_text, telephony.ai_tickets.when_text),
       service = COALESCE(EXCLUDED.service, telephony.ai_tickets.service),
       specialist = COALESCE(EXCLUDED.specialist, telephony.ai_tickets.specialist),
       comment = COALESCE(EXCLUDED.comment, telephony.ai_tickets.comment),
       summary = COALESCE(EXCLUDED.summary, telephony.ai_tickets.summary),
       call_id = COALESCE(EXCLUDED.call_id, telephony.ai_tickets.call_id),
       has_recording = telephony.ai_tickets.has_recording OR EXCLUDED.has_recording,
       synced_at = NOW()`,
    [
      t.id, companyId, t.created_at, t.kind, t.status, t.client_number, digits(t.client_number),
      t.client_name, t.when_text, t.service, t.specialist, t.comment, t.summary, t.call_id,
      Boolean(t.recording),
    ],
  );
}

async function syncTickets(log: Logger): Promise<void> {
  // То же окно перекрытия, что у журнала: статус заявки может поменяться в
  // портале или Telegram, и мы должны это увидеть.
  const from = new Date(Date.now() - Math.max(config.SYNC_OVERLAP_HOURS, 24 * 7) * 3600_000);
  let offset = 0;
  let total = 0;
  for (;;) {
    const page = await listTickets({ from: from.toISOString(), limit: config.SYNC_PAGE_SIZE, offset });
    for (const t of page) await upsertTicket(t);
    total += page.length;
    if (page.length < config.SYNC_PAGE_SIZE) break;
    offset += page.length;
    if (offset > config.SYNC_PAGE_SIZE * 20) break;
  }
  await pool.query(
    `UPDATE telephony.ai_tickets t
        SET client_id = cl.id
       FROM clients.clients cl
      WHERE cl.company_id = t.company_id
        AND telephony.phone_digits(cl.phone) = t.client_digits
        AND t.client_digits IS NOT NULL
        AND t.client_id IS DISTINCT FROM cl.id`,
  );
  log.info({ count: total }, '[sync] ai tickets');
}

async function linkCalls(): Promise<void> {
  await pool.query(
    `UPDATE telephony.calls c
        SET master_id = l.master_id
       FROM telephony.extension_links l
      WHERE l.company_id = c.company_id
        AND l.extension = c.extension
        AND c.master_id IS DISTINCT FROM l.master_id`,
    [],
  );
  await pool.query(
    `UPDATE telephony.calls c
        SET client_id = cl.id
       FROM clients.clients cl
      WHERE cl.company_id = c.company_id
        AND telephony.phone_digits(cl.phone) = c.client_digits
        AND c.client_digits IS NOT NULL
        AND c.client_id IS DISTINCT FROM cl.id`,
    [],
  );
}

/** Номера из ВАТС: строка заводится на каждый, даже непривязанный. */
export async function syncExtensions(log: Logger): Promise<void> {
  const employees = await listEmployees();
  for (const e of employees) {
    await pool.query(
      `INSERT INTO telephony.extension_links (company_id, extension, vats_name, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, extension) DO UPDATE SET
         vats_name = EXCLUDED.vats_name,
         enabled = EXCLUDED.enabled,
         updated_at = NOW()`,
      [companyId, e.extension, e.name, e.enabled],
    );
  }
  log.info({ count: employees.length }, '[sync] extensions');
}

export async function syncCalls(log: Logger): Promise<{ fetched: number }> {
  const { rows } = await pool.query<{ synced_until: Date | null }>(
    'SELECT synced_until FROM telephony.sync_state WHERE company_id = $1', [companyId],
  );
  const now = new Date();
  const overlapMs = config.SYNC_OVERLAP_HOURS * 3600_000;
  const from = rows[0]?.synced_until
    ? new Date(Math.max(rows[0].synced_until.getTime() - overlapMs, now.getTime() - config.SYNC_INITIAL_DAYS * 86400_000))
    : new Date(now.getTime() - config.SYNC_INITIAL_DAYS * 86400_000);

  let offset = 0;
  let fetched = 0;
  // Страницы идут от новых к старым; ограничение API — 500 на страницу.
  for (;;) {
    const page = await listCalls({
      from: from.toISOString(),
      to: now.toISOString(),
      limit: config.SYNC_PAGE_SIZE,
      offset,
    });
    if (!page.length) break;
    fetched += await upsertCalls(page);
    if (page.length < config.SYNC_PAGE_SIZE) break;
    offset += page.length;
    // Предохранитель от бесконечного листания, если API вдруг перестанет
    // уважать offset: 50 страниц — это 25 000 звонков, больше месяца работы.
    if (offset > config.SYNC_PAGE_SIZE * 50) {
      log.warn({ offset }, '[sync] прервал листание: слишком много страниц');
      break;
    }
  }

  await linkCalls();

  await pool.query(
    `INSERT INTO telephony.sync_state (company_id, synced_until, last_ok_at, last_error, last_error_at, calls_total)
     VALUES ($1, $2, NOW(), NULL, NULL, (SELECT COUNT(*) FROM telephony.calls WHERE company_id = $1))
     ON CONFLICT (company_id) DO UPDATE SET
       synced_until = EXCLUDED.synced_until,
       last_ok_at = NOW(),
       last_error = NULL,
       last_error_at = NULL,
       calls_total = EXCLUDED.calls_total`,
    [companyId, now.toISOString()],
  );

  log.info({ fetched, from: from.toISOString() }, '[sync] calls');
  return { fetched };
}

async function recordFailure(message: string): Promise<void> {
  await pool.query(
    `INSERT INTO telephony.sync_state (company_id, last_error, last_error_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (company_id) DO UPDATE SET last_error = EXCLUDED.last_error, last_error_at = NOW()`,
    [companyId, message.slice(0, 300)],
  ).catch(() => { /* журнал ошибки не должен ронять воркер */ });
}

export async function runSyncOnce(log: Logger): Promise<void> {
  try {
    await syncExtensions(log);
    await syncCalls(log);
    await syncTickets(log);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error({ err: msg }, '[sync] failed');
    await recordFailure(msg);
  }
}

/** Воркер: первый проход сразу после старта, дальше по интервалу. */
export function startSyncWorker(log: Logger): NodeJS.Timeout {
  void runSyncOnce(log);
  const timer = setInterval(() => void runSyncOnce(log), config.SYNC_INTERVAL_MS);
  timer.unref();
  return timer;
}
