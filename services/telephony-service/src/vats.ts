import { ProxyAgent, setGlobalDispatcher } from 'undici';
import { config } from './config';

// fetch в Node не смотрит на переменные окружения с прокси — диспетчер нужно
// задать явно, иначе запрос уйдёт напрямую и упрётся в отсутствие маршрута.
if (config.VATS_PROXY_URL) {
  setGlobalDispatcher(new ProxyAgent(config.VATS_PROXY_URL));
}

// Клиент публичного API ВАТС. Все запросы — с ключом организации в заголовке;
// ключ никогда не уходит в URL, чтобы не оседать в логах nginx и Kong.

export interface VatsCall {
  id: string;
  at: string;                 // ISO, UTC
  direction: 'inbound' | 'outbound';
  client_number: string | null;
  client_name: string | null;
  line: string | null;
  employee: string | null;    // внутренний номер: кто звонил (исходящий) / кто ответил (входящий)
  employee_name: string | null;
  duration: number;           // секунды разговора
  status: 'answered' | 'missed' | 'cancelled';
  handled_by: 'employee' | 'ai' | null; // кто реально говорил с клиентом
  recording: string | null;
}

/** Заявка AI-оператора — то, что он понял из разговора. */
export interface VatsTicket {
  id: string;
  created_at: string;
  kind: 'booking' | 'order' | 'callback' | 'question' | 'request' | string;
  status: 'new' | 'confirmed' | 'done' | 'cancelled';
  client_number: string | null;
  client_name: string | null;
  when_text: string | null;
  service: string | null;
  specialist: string | null;
  comment: string | null;
  summary: string | null;
  call_id: string | null;
  recording: string | null;
}

/** Разговор с AI-оператором по звонку: резюме, заявка, расшифровка. */
export interface VatsCallAi {
  summary: string | null;
  replies: number;
  ticket: VatsTicket | null;
  transcript: { role: 'user' | 'assistant' | string; text: string; at: string }[];
}

export interface VatsEmployee {
  extension: string;
  name: string | null;
  enabled: boolean;
}

export class VatsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${config.VATS_BASE_URL}${path}`, {
    ...init,
    headers: {
      'X-Api-Key': config.VATS_API_KEY,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(config.VATS_TIMEOUT_MS),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new VatsError(res.status, `${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res;
}

export async function listCalls(params: {
  from?: string; to?: string; limit?: number; offset?: number;
  employee?: string; direction?: string; number?: string;
}): Promise<VatsCall[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const res = await request(`/calls?${qs.toString()}`);
  const body = (await res.json()) as { calls?: VatsCall[] };
  return body.calls ?? [];
}

export async function getCall(id: string): Promise<VatsCall & { ai: VatsCallAi | null }> {
  const res = await request(`/calls/${encodeURIComponent(id)}`);
  return (await res.json()) as VatsCall & { ai: VatsCallAi | null };
}

export async function listTickets(params: {
  from?: string; to?: string; status?: string; limit?: number; offset?: number;
}): Promise<VatsTicket[]> {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const res = await request(`/tickets?${qs.toString()}`);
  const body = (await res.json()) as { tickets?: VatsTicket[] };
  return body.tickets ?? [];
}

// Статус заявки общий: закрыли у нас — закрыто в портале и в Telegram-группе,
// иначе администратору пришлось бы закрывать одно и то же дважды.
export async function setTicketStatus(id: string, status: VatsTicket['status']): Promise<void> {
  await request(`/tickets/${encodeURIComponent(id)}/handled`, {
    method: 'POST',
    body: JSON.stringify({ status }),
  });
}

export async function listEmployees(): Promise<VatsEmployee[]> {
  const res = await request('/employees');
  const body = (await res.json()) as { employees?: VatsEmployee[] };
  return body.employees ?? [];
}

// Имя уходит в ВАТС, чтобы employee_name приходил готовым во всех звонках и
// показывался на экранах телефонов — иначе сопоставлять пришлось бы на каждом
// экране, и в самой ВАТС номера остались бы безымянными.
export async function setEmployeeName(extension: string, name: string): Promise<void> {
  await request(`/employees/${encodeURIComponent(extension)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  });
}

// Запись отдаётся потоком: ВАТС перекодирует wav в mp3 на лету, длина заранее
// неизвестна. Читаем целиком — дальше файл ложится в кэш, и уже оттуда браузер
// получает его с перемоткой.
export async function fetchRecording(callId: string): Promise<Buffer> {
  const res = await request(`/calls/${encodeURIComponent(callId)}/recording`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new VatsError(502, 'empty recording');
  return buf;
}
