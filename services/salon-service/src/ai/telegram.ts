/**
 * Уведомления менеджерам в Telegram о диалогах, требующих ответа.
 *
 * Зачем отдельный канал: всплывашка в админке живёт, только пока открыта
 * вкладка. Менеджер закрыл браузер — клиент ждёт ответа, и об этом никто
 * не знает. Telegram доходит до телефона.
 *
 * Почему группа с темами, а не личные сообщения: отвечает тот, кто
 * свободен, а в личке уведомление видит один человек и может быть занят.
 * В теме видно, разобран вопрос или нет.
 */
import { ProxyAgent, Agent } from 'undici';
import { pool } from '../db';

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || '';

// Telegram, как и Meta, недоступен с прямого выхода этого сервера — идём
// через тот же мост VLESS. Диспетчер задаём ЯВНО: в окружении контейнера
// стоят системные HTTPS_PROXY/http_proxy (прямой выход), и undici
// подхватил бы их молча, отправив запрос не туда.
const PROXY = process.env.INSTAGRAM_SOCKS_PROXY || '';
export const tgDispatcher = PROXY
  ? new ProxyAgent(PROXY)
  : new Agent({ connect: { timeout: 10_000 } });

/** Куда слать уведомления этого канала; null — некуда или выключено. */
export async function telegramTarget(channel: string): Promise<
  { chatId: string; threadId: number | null; token: string } | null
> {
  const r = await pool.query<{ chat_id: string; thread_id: number | null; token: string }>(
    `SELECT t.chat_id, t.thread_id, c.token
       FROM ai.telegram_targets t
       JOIN salons.integration_credentials c
         ON c.company_id = t.company_id AND c.provider = 'telegram'
      WHERE t.company_id = $1 AND t.channel = $2
        AND t.enabled AND t.chat_id IS NOT NULL AND c.token IS NOT NULL`,
    [COMPANY_ID, channel],
  );
  const row = r.rows[0];
  if (!row) return null;
  return { chatId: row.chat_id, threadId: row.thread_id, token: row.token };
}

/**
 * Отправить сообщение в группу. Возвращает причину отказа вместо броска:
 * сбой уведомления не должен ронять обработку входящего — сообщение
 * клиента уже сохранено, и терять его из-за недоступного Telegram нельзя.
 */
export async function sendTelegram(
  channel: string,
  text: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  let target;
  try {
    target = await telegramTarget(channel);
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
  if (!target) return { ok: false, reason: 'группа не настроена' };

  const body: Record<string, unknown> = {
    chat_id: target.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
  };
  // В супергруппе с темами без message_thread_id сообщение уходит в общую
  // ленту и теряется среди переписки сотрудников.
  if (target.threadId) body.message_thread_id = target.threadId;

  try {
    const r = await fetch(`https://api.telegram.org/bot${target.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
      dispatcher: tgDispatcher,
    } as RequestInit);
    const data = (await r.json()) as { ok?: boolean; description?: string };
    if (!r.ok || !data.ok) {
      return { ok: false, reason: data.description || `HTTP ${r.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

/** Экранирование для parse_mode=HTML: текст клиента произвольный. */
function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Уведомление «ассистент не взялся отвечать».
 * Текст вопроса обязателен: по одному имени непонятно, срочное это или нет,
 * и менеджеру пришлось бы открывать CRM, чтобы просто оценить важность.
 */
export async function notifyNeedsReply(opts: {
  channel: string;
  who: string;
  question: string;
  reason?: string | null;
  draft?: string | null;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const icon = opts.channel === 'whatsapp' ? '💬' : '📸';
  const lines = [
    `${icon} <b>Нужен ответ</b> — ${esc(opts.who)}`,
    '',
    esc(String(opts.question || '').slice(0, 400)),
  ];
  if (opts.reason) lines.push('', `<i>${esc(opts.reason)}</i>`);
  if (opts.draft) {
    lines.push('', '<b>Черновик ассистента:</b>', esc(opts.draft.slice(0, 600)));
  }
  return sendTelegram(opts.channel, lines.join('\n'));
}
