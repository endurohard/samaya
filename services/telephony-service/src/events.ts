import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import { io as ioClient, type Socket } from 'socket.io-client';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { config } from './config';
import { pool } from './db';
import { runSyncOnce, upsertTicket } from './sync';
import type { VatsTicket } from './vats';

// События звонков живьём из ВАТС.
//
// Подписка исходящая (socket.io из сервиса наружу): ничего публичного не
// открываем, ключ организации не покидает сервис. Из событий берём то, чего
// нет в журнале — у кого звонит и кто ответил, — и раздаём в браузеры
// администраторов через SSE (см. routes/stream.ts), чтобы карточка клиента
// всплывала параллельно со звонком.

/** Событие в том виде, как его отдаёт портал ВАТС. */
export interface VatsEvent {
  id: string;
  // handled — не из ВАТС: администратор нажал «Обработано», карточку гасим у всех
  type: 'incoming' | 'accepted' | 'ringing' | 'answered' | 'employee_ended' | 'ended' | 'dialing' | 'ai_ticket' | 'handled';
  call_id: string;
  direction: 'inbound' | 'outbound';
  domain: string;
  client_number: string | null;
  client_name: string | null;
  line: string | null;
  employee: string | null;
  hangup_cause?: string;
  duration?: number;
  recording?: boolean;
  // только у ai_ticket: заявка, которую AI-оператор оформил после разговора
  ticket?: Pick<VatsTicket, 'id' | 'kind' | 'status' | 'when_text' | 'service' | 'specialist' | 'comment' | 'summary'>;
  at: string;
}

/** То же событие, дополненное тем, что знаем сами: клиент из базы и сотрудник по номеру. */
export interface LiveEvent extends VatsEvent {
  client_id: string | null;
  client_known_name: string | null;
  master_id: string | null;
  master_name: string | null;
  // отметка администратора: кто звонил — по этому звонку или запомненная за номером
  caller_kind: 'client' | 'staff' | null;
}

export const bus = new EventEmitter();
bus.setMaxListeners(0);

// Идущие сейчас звонки: браузер, открывший поток посреди разговора (обновили
// страницу), получает их сразу и рисует карточку, не дожидаясь следующего.
interface ActiveCall { started: LiveEvent; answered: LiveEvent | null; since: number }
const active = new Map<string, ActiveCall>();
const ACTIVE_TTL_MS = 60 * 60_000;

// Звонки, по которым нажали «Обработано»: их события в браузеры больше не идут
// и в activeCalls они не возвращаются — иначе карточка всплывала бы заново при
// каждом переподключении потока и на каждом «звонит» у следующего сотрудника.
const handled = new Map<string, number>();

function trackActive(ev: LiveEvent): void {
  if (ev.direction !== 'inbound' || !ev.call_id || ev.type === 'ai_ticket' || ev.type === 'handled') return;
  if (ev.type === 'ended') { active.delete(ev.call_id); return; }
  if (handled.has(ev.call_id)) return;
  const cur = active.get(ev.call_id);
  if (ev.type === 'incoming' || ev.type === 'accepted' || ev.type === 'ringing') {
    if (!cur) active.set(ev.call_id, { started: ev, answered: null, since: Date.now() });
    // «звонит» уточняет, у кого именно — запоминаем последнего
    else if (ev.type === 'ringing' && !cur.answered) cur.started = { ...cur.started, ...ev };
  } else if (ev.type === 'answered' && cur) {
    cur.answered = ev;
  }
  // потерянный «завершён» не должен оставлять звонок висеть вечно
  for (const [id, c] of active) if (Date.now() - c.since > ACTIVE_TTL_MS) active.delete(id);
  for (const [id, at] of handled) if (Date.now() - at > ACTIVE_TTL_MS) handled.delete(id);
}

/**
 * «Обработано»: звонок больше не активен, всем открытым потокам уходит событие
 * handled — карточка закрывается и у коллег. Сам звонок ещё может идти:
 * «ответили»/«завершён» по нему в браузеры уже не попадут.
 */
export function markHandled(callId: string): void {
  active.delete(callId);
  handled.set(callId, Date.now());
  const ev: LiveEvent = {
    id: `handled:${callId}:${Date.now()}`, type: 'handled', call_id: callId, direction: 'inbound',
    domain: '', client_number: null, client_name: null, line: null, employee: null, at: new Date().toISOString(),
    client_id: null, client_known_name: null, master_id: null, master_name: null, caller_kind: null,
  };
  bus.emit('call', ev);
}

/** Уже обработан — событие ВАТС по нему карточку не должно поднимать. */
export function isHandled(callId: string): boolean {
  return handled.has(callId);
}

/** Идущие звонки в порядке появления: сначала событие начала, затем ответ, если был. */
export function activeCalls(): LiveEvent[] {
  const out: LiveEvent[] = [];
  for (const c of active.values()) { out.push(c.started); if (c.answered) out.push(c.answered); }
  return out;
}

const companyId = config.DEFAULT_COMPANY_ID;

function digits(n: string | null): string | null {
  if (!n) return null;
  const d = n.replace(/\D/g, '').slice(-10);
  return d.length === 10 ? d : null;
}

async function enrich(ev: VatsEvent): Promise<LiveEvent> {
  const live: LiveEvent = { ...ev, client_id: null, client_known_name: null, master_id: null, master_name: null, caller_kind: null };
  const d = digits(ev.client_number);
  if (ev.call_id) {
    // Отметка по этому звонку (в т.ч. после рестарта сервиса, когда память пуста).
    const { rows } = await pool.query<{ caller_kind: 'client' | 'staff' | null; processed_at: string | null }>(
      'SELECT caller_kind, processed_at FROM telephony.call_marks WHERE call_id = $1 AND company_id = $2',
      [ev.call_id, companyId],
    );
    if (rows[0]?.caller_kind) live.caller_kind = rows[0].caller_kind;
    if (rows[0]?.processed_at && !handled.has(ev.call_id)) handled.set(ev.call_id, Date.now());
  }
  if (d && !live.caller_kind) {
    // «Сотрудник» помним за номером: мастер звонит с личного телефона не один раз.
    const { rows } = await pool.query<{ caller_kind: 'client' | 'staff' }>(
      `SELECT caller_kind FROM telephony.call_marks
        WHERE company_id = $1 AND client_digits = $2 AND caller_kind IS NOT NULL
        ORDER BY updated_at DESC LIMIT 1`,
      [companyId, d],
    );
    if (rows[0]) live.caller_kind = rows[0].caller_kind;
  }
  if (d) {
    const { rows } = await pool.query<{ id: string; full_name: string | null }>(
      `SELECT id, full_name FROM clients.clients
        WHERE company_id = $1 AND telephony.phone_digits(phone) = $2
        ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
      [companyId, d],
    );
    if (rows[0]) { live.client_id = rows[0].id; live.client_known_name = rows[0].full_name; }
  }
  if (ev.employee) {
    const { rows } = await pool.query<{ master_id: string | null; display_name: string | null }>(
      `SELECT l.master_id, m.display_name
         FROM telephony.extension_links l
         LEFT JOIN salons.masters m ON m.id = l.master_id
        WHERE l.company_id = $1 AND l.extension = $2`,
      [companyId, ev.employee],
    );
    if (rows[0]) { live.master_id = rows[0].master_id; live.master_name = rows[0].display_name; }
  }
  return live;
}

let syncTimer: NodeJS.Timeout | null = null;

/**
 * Журнал подтягиваем через несколько секунд после отбоя, не дожидаясь цикла
 * синхронизации: администратор, закрыв карточку, сразу видит звонок в списке.
 * Задержка — чтобы запись разговора успела появиться в ВАТС; повторные отбои
 * за это время просто сдвигают таймер.
 */
function scheduleSync(log: Logger): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncTimer = null;
    runSyncOnce(log).catch((e) => log.warn({ err: e }, '[events] sync after call failed'));
  }, 12_000);
  syncTimer.unref();
}

async function handle(ev: VatsEvent, log: Logger): Promise<void> {
  if (!ev?.id || !ev.type) return;
  // Портал шлёт ai_ticket по последней заявке каждые 10 с, каждый раз с новым
  // id события и даже когда заявка давно закрыта (на проде — тысячи повторов в
  // сутки). Дедупликация по id тут не спасает: сравниваем со своей копией
  // заявки и повтор с тем же статусом не пишем и не показываем. Карточка
  // поднимается один раз — когда заявка для нас новая и открыта; закрытие
  // извне (Telegram, портал) доводим до браузеров как «обработано».
  let ticketPrev: string | null | undefined;
  if (ev.type === 'ai_ticket') {
    if (!ev.ticket?.id) return;
    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM telephony.ai_tickets WHERE company_id = $1 AND id = $2',
      [companyId, ev.ticket.id],
    );
    ticketPrev = rows[0]?.status ?? null;
    if (ticketPrev === ev.ticket.status) return;
  }
  // Идемпотентность по id события: при переподключении портал может отдать
  // событие повторно, второй раз карточку не показываем.
  const ins = await pool.query(
    `INSERT INTO telephony.call_events
       (id, company_id, call_id, type, extension, client_digits, occurred_at, payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8)
     ON CONFLICT (id) DO NOTHING`,
    [ev.id, companyId, ev.call_id || null, ev.type, ev.employee, digits(ev.client_number), ev.at, JSON.stringify(ev)],
  );
  if (!ins.rowCount) return;

  // Кто ответил на входящий — самое ценное в событиях: в журнале этого может не
  // быть, а звонка в calls на этот момент может ещё не существовать (тогда его
  // проставит синхронизация, которая теперь тоже получает employee).
  if (ev.type === 'answered' && ev.direction === 'inbound' && ev.employee && ev.call_id) {
    await pool.query(
      `UPDATE telephony.calls c
          SET extension = $2,
              master_id = (SELECT master_id FROM telephony.extension_links
                            WHERE company_id = c.company_id AND extension = $2)
        WHERE c.id = $1`,
      [ev.call_id, ev.employee],
    );
  }
  if (ev.type === 'ended') scheduleSync(log);

  // Заявка AI-оператора: кладём сразу, не дожидаясь синхронизации — карточка
  // у администратора и список заявок должны совпадать с тем, что в Telegram.
  if (ev.type === 'ai_ticket' && ev.ticket) {
    await upsertTicket({
      ...ev.ticket, created_at: ev.at, client_number: ev.client_number, client_name: ev.client_name,
      call_id: ev.call_id, recording: null,
    });
  }

  if (ev.type === 'ai_ticket' && ev.ticket) {
    const open = ev.ticket.status === 'new' || ev.ticket.status === 'confirmed';
    // Заявку закрыли не у нас — карточку надо убрать, а не перерисовать.
    if (!open) {
      if (ticketPrev != null) markHandled(ev.call_id || ev.ticket.id);
      return;
    }
  }

  const live = await enrich(ev);
  trackActive(live);
  // Открытую заявку AI-оператора показываем и по обработанному звонку — она
  // приходит уже после разговора и это отдельная работа для администратора;
  // остальное по обработанному звонку карточку поднимать не должно.
  if (live.call_id && handled.has(live.call_id) && live.type !== 'ai_ticket') return;
  bus.emit('call', live);
}

let socket: Socket | null = null;

export function startEvents(log: Logger): void {
  const origin = new URL(config.VATS_BASE_URL).origin;
  // undici-прокси для fetch на websocket не распространяется — у socket.io свой
  // транспорт, ему нужен собственный agent. Мост egress-proxy пропускает CONNECT
  // как есть, поэтому тот же адрес прокси подходит и здесь.
  const agent = config.VATS_PROXY_URL ? new HttpsProxyAgent(config.VATS_PROXY_URL) : undefined;

  socket = ioClient(origin, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { eventKey: config.VATS_API_KEY },
    reconnection: true,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 30_000,
    timeout: 15_000,
    // типы engine.io описывают agent как string|boolean, фактически принимается http.Agent
    agent: agent as unknown as string | undefined,
  });

  socket.on('ready', () => {
    socket!.emit('subscribe-events', config.VATS_API_KEY, (r: { ok: boolean; domain?: string; error?: string }) => {
      if (r?.ok) log.info({ domain: r.domain }, '[events] subscribed to VATS call events');
      else log.error({ error: r?.error }, '[events] VATS subscription refused');
    });
  });
  socket.on('call', (ev: VatsEvent) => {
    handle(ev, log).catch((e) => log.error({ err: e, event: ev?.id }, '[events] handle failed'));
  });
  socket.on('connect_error', (e) => log.warn({ err: e.message }, '[events] VATS socket connect error'));
  socket.on('disconnect', (reason) => log.warn({ reason }, '[events] VATS socket disconnected'));
}

export function stopEvents(): void {
  socket?.close();
  socket = null;
}

/** Состояние подписки для /status и мониторинга. */
export function eventsStatus(): { connected: boolean } {
  return { connected: Boolean(socket?.connected) };
}
