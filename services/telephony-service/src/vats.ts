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
  recording: string | null;
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

export async function getCall(id: string): Promise<VatsCall> {
  const res = await request(`/calls/${encodeURIComponent(id)}`);
  return (await res.json()) as VatsCall;
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
