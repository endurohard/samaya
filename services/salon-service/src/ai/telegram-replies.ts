/**
 * Приём ответов менеджера из Telegram.
 *
 * Менеджер отвечает реплаем на уведомление прямо в теме, и текст уходит
 * клиенту в Instagram. Без этого уведомление заставляет открыть CRM, найти
 * диалог и только там ответить — три действия вместо одного.
 *
 * Почему опрос, а не webhook: webhook требует публичного адреса, а у этого
 * сервера входящего HTTPS нет — внешний трафик идёт через чужой сервер.
 * Заводить ради ответов ещё один проброс незачем.
 *
 * ВАЖНО: очередь getUpdates одна на бота. Если её читают двое, события
 * достаются тому, кто успел первым, и часть ответов теряется. Поэтому
 * читатель ровно один — этот цикл.
 */
import { pool } from '../db';
import { tgDispatcher } from './telegram';

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || '';
const IG_URL = process.env.INSTAGRAM_SERVICE_URL || 'http://instagram-service:3010';
const IG_TOKEN = process.env.INSTAGRAM_INTERNAL_TOKEN || process.env.INTERNAL_TOKEN || '';
const WA_URL = process.env.WHATSAPP_SERVICE_URL || 'http://whatsapp-service:3008';
const WA_TOKEN = process.env.WHATSAPP_INTERNAL_TOKEN || process.env.INTERNAL_TOKEN || '';

/** Код быстрого шаблона: ответ менеджера из одних цифр. */
const SHORTCUT_RE = /^[0-9]{1,8}$/;

let timer: NodeJS.Timeout | null = null;

/** Запомнить, какому диалогу принадлежит уведомление. */
export async function rememberNotification(opts: {
  chatId: string;
  messageId: number;
  channel: string;
  threadKey: string;
  who: string | null;
}): Promise<void> {
  await pool.query(
    `INSERT INTO ai.telegram_outbox
       (company_id, chat_id, message_id, channel, thread_key, who)
     VALUES ($1::uuid, $2, $3, $4, $5, $6)
     ON CONFLICT (chat_id, message_id) DO NOTHING`,
    [COMPANY_ID, opts.chatId, opts.messageId, opts.channel, opts.threadKey, opts.who],
  );
}

async function token(): Promise<string | null> {
  const r = await pool.query<{ token: string }>(
    `SELECT token FROM salons.integration_credentials
      WHERE company_id = $1::uuid AND provider = 'telegram' AND token IS NOT NULL`,
    [COMPANY_ID],
  );
  return r.rows[0]?.token ?? null;
}

async function cursor(): Promise<number> {
  const r = await pool.query<{ offset_id: string }>(
    `SELECT offset_id FROM ai.telegram_cursor WHERE company_id = $1::uuid`,
    [COMPANY_ID],
  );
  return Number(r.rows[0]?.offset_id ?? 0);
}

async function setCursor(id: number): Promise<void> {
  await pool.query(
    `INSERT INTO ai.telegram_cursor (company_id, offset_id, updated_at)
     VALUES ($1::uuid, $2, now())
     ON CONFLICT (company_id) DO UPDATE SET offset_id = $2, updated_at = now()`,
    [COMPANY_ID, id],
  );
}

/**
 * Переслать фото/видео, отправленное менеджером реплаем в Telegram.
 *
 * Файл скачиваем у Telegram и отдаём instagram-service сырым телом — тот сам
 * положит его на диск и передаст Meta подписанной ссылкой.
 */
async function deliverMedia(
  tok: string, channel: string, threadKey: string, fileId: string, mime: string,
): Promise<string | null> {
  if (channel !== 'instagram') return 'канал пока не поддержан';
  try {
    // getFile отдаёт путь, по которому файл качается с api.telegram.org.
    const meta = await fetch(`https://api.telegram.org/bot${tok}/getFile?file_id=${encodeURIComponent(fileId)}`,
      { signal: AbortSignal.timeout(20_000), dispatcher: tgDispatcher } as RequestInit);
    const mj = await meta.json() as { ok?: boolean; result?: { file_path?: string } };
    if (!mj.ok || !mj.result?.file_path) return 'Telegram не отдал файл';

    const fileRes = await fetch(`https://api.telegram.org/file/bot${tok}/${mj.result.file_path}`,
      { signal: AbortSignal.timeout(60_000), dispatcher: tgDispatcher } as RequestInit);
    if (!fileRes.ok) return `Telegram ответил ${fileRes.status}`;
    const buf = Buffer.from(await fileRes.arrayBuffer());

    const r = await fetch(
      `${IG_URL}/api/instagram/send-media?thread_id=${encodeURIComponent(threadKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': mime, 'X-Internal-Token': IG_TOKEN },
        body: buf,
        signal: AbortSignal.timeout(90_000),
      },
    );
    if (!r.ok) {
      const b = await r.text().catch(() => '');
      return `сервис Instagram ответил ${r.status}: ${b.slice(0, 160)}`;
    }
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** Отправить ответ менеджера в канал клиента. */
async function deliver(channel: string, threadKey: string, text: string): Promise<string | null> {
  const wa = channel === 'whatsapp';
  if (channel !== 'instagram' && !wa) return 'канал пока не поддержан';
  try {
    const r = await fetch(
      wa ? `${WA_URL}/api/whatsapp/send` : `${IG_URL}/api/instagram/send`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Именно X-Internal-Token: authenticate в сервисах каналов ждёт
          // внутренний токен в этом заголовке, а Bearer разбирает как JWT
          // пользователя и отвечает 401 unauthorized.
          'X-Internal-Token': wa ? WA_TOKEN : IG_TOKEN,
        },
        body: JSON.stringify(wa
          ? { phone: threadKey, message: text }
          : { thread_id: threadKey, message: text }),
        signal: AbortSignal.timeout(25_000),
      },
    );
    if (!r.ok) {
      const b = await r.text().catch(() => '');
      return `сервис ${wa ? 'WhatsApp' : 'Instagram'} ответил ${r.status}: ${b.slice(0, 120)}`;
    }
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/**
 * Отправить быстрый шаблон по коду, набранному менеджером в Telegram.
 *
 * Зовём эндпоинт КАНАЛА, а не собираем текст здесь: у шаблона могут быть
 * фотографии, и канал уже умеет слать их несколькими сообщениями подряд.
 * Вторая реализация той же сборки разошлась бы с первой при первой правке.
 */
async function deliverShortcut(
  channel: string, threadKey: string, code: string,
): Promise<{ why: string | null; title?: string; sent?: number }> {
  const wa = channel === 'whatsapp';
  if (channel !== 'instagram' && !wa) return { why: 'канал пока не поддержан' };
  try {
    const r = await fetch(
      wa ? `${WA_URL}/api/whatsapp/send-shortcut` : `${IG_URL}/api/instagram/send-shortcut`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Internal-Token': wa ? WA_TOKEN : IG_TOKEN,
        },
        body: JSON.stringify(wa
          ? { phone: threadKey, code }
          : { thread_id: threadKey, code }),
        signal: AbortSignal.timeout(90_000), // шаблон с фото уходит дольше
      },
    );
    const b = await r.json().catch(() => ({})) as { error?: string; title?: string; sent?: number };
    if (!r.ok) return { why: b.error || `сервис ответил ${r.status}` };
    return { why: null, title: b.title, sent: b.sent };
  } catch (e) {
    return { why: (e as Error).message };
  }
}

/** Подтвердить менеджеру, что ответ ушёл (или не ушёл). */
async function react(tok: string, chatId: string, messageId: number, ok: boolean, why?: string) {
  const body = ok
    ? { chat_id: chatId, message_id: messageId, reaction: [{ type: 'emoji', emoji: '👍' }] }
    : null;
  try {
    if (body) {
      await fetch(`https://api.telegram.org/bot${tok}/setMessageReaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
        dispatcher: tgDispatcher,
      } as RequestInit);
      return;
    }
    // Неудачу реакцией не передать: менеджер решит, что ответ ушёл.
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        reply_to_message_id: messageId,
        text: `⚠️ Не отправлено: ${why || 'неизвестная причина'}`,
      }),
      signal: AbortSignal.timeout(10_000),
      dispatcher: tgDispatcher,
    } as RequestInit);
  } catch { /* подтверждение — не повод ронять цикл */ }
}

/** Короткая реплика менеджеру в ту же тему. */
async function note(tok: string, chatId: string, messageId: number, text: string) {
  try {
    await fetch(`https://api.telegram.org/bot${tok}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, reply_to_message_id: messageId, text }),
      signal: AbortSignal.timeout(10_000),
      dispatcher: tgDispatcher,
    } as RequestInit);
  } catch { /* подтверждение — не повод ронять цикл */ }
}

async function tick(): Promise<void> {
  const tok = await token();
  if (!tok) return;

  const offset = await cursor();
  let body: { ok?: boolean; result?: any[] };
  try {
    const r = await fetch(
      `https://api.telegram.org/bot${tok}/getUpdates?timeout=0&limit=50`
      + (offset ? `&offset=${offset}` : ''),
      { signal: AbortSignal.timeout(20_000), dispatcher: tgDispatcher } as RequestInit,
    );
    body = await r.json() as { ok?: boolean; result?: any[] };
  } catch {
    return; // сеть моргнула — попробуем на следующем тике
  }
  if (!body.ok || !body.result?.length) return;

  let last = offset;
  for (const u of body.result) {
    last = Math.max(last, Number(u.update_id) + 1);

    // Попутно запоминаем группы и темы: очередь читает только этот цикл,
    // поэтому кнопка «Определить» в админке берёт данные отсюда. Иначе
    // новые темы не появлялись бы в списке никогда.
    const any = u.message || u.channel_post || u.my_chat_member || u.chat_member;
    if (any?.chat) {
      const threadId = any.is_topic_message ? (any.message_thread_id ?? 0) : 0;
      await pool.query(
        `INSERT INTO ai.telegram_seen
           (company_id, chat_id, thread_id, chat_title, topic_name, last_text, seen_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, now())
         ON CONFLICT (company_id, chat_id, thread_id) DO UPDATE SET
           chat_title = EXCLUDED.chat_title,
           topic_name = COALESCE(EXCLUDED.topic_name, ai.telegram_seen.topic_name),
           last_text  = COALESCE(NULLIF(EXCLUDED.last_text, ''), ai.telegram_seen.last_text),
           seen_at    = now()`,
        [
          COMPANY_ID, String(any.chat.id), threadId,
          any.chat.title || any.chat.username || 'без названия',
          any.forum_topic_created?.name ?? any.reply_to_message?.forum_topic_created?.name ?? null,
          String(any.text || any.caption || '').slice(0, 60),
        ],
      ).catch(() => {});
    }

    const m = u.message;
    // Реплай без текста и без вложения разбирать нечего.
    if (!m?.reply_to_message) continue;
    const hasMedia = !!(m.photo?.length || m.video || m.document);
    if (!m.text && !m.caption && !hasMedia) continue;

    const r = await pool.query<{ channel: string; thread_key: string; who: string | null }>(
      `SELECT channel, thread_key, who FROM ai.telegram_outbox
        WHERE chat_id = $1 AND message_id = $2`,
      [String(m.chat.id), Number(m.reply_to_message.message_id)],
    );
    const link = r.rows[0];
    // Реплай на обычное сообщение в теме — не наше дело: сотрудники
    // переписываются между собой, и вмешиваться туда нельзя.
    if (!link) continue;

    let why: string | null = null;
    let shortcutNote: string | null = null;
    if (hasMedia) {
      // Фото Telegram отдаёт в нескольких размерах — берём последний,
      // он самый крупный.
      const photo = m.photo?.length ? m.photo[m.photo.length - 1] : null;
      const fileId = photo?.file_id || m.video?.file_id || m.document?.file_id;
      const mime = photo
        ? 'image/jpeg'
        : (m.video?.mime_type || m.document?.mime_type || 'application/octet-stream');
      why = await deliverMedia(tok, link.channel, link.thread_key, fileId, mime);
      // Подпись к фото уходит отдельным сообщением: Instagram не принимает
      // текст и вложение одним запросом.
      const caption = m.caption?.trim();
      if (!why && caption) why = await deliver(link.channel, link.thread_key, caption);
    } else if (SHORTCUT_RE.test(m.text.trim())) {
      // Ответ из одних цифр — это код быстрого шаблона, а не текст клиенту.
      // Обычное сообщение клиенту из одних цифр не состоит, поэтому
      // распознаём смело; промах виден по ответу бота в теме.
      const code = m.text.trim();
      const out = await deliverShortcut(link.channel, link.thread_key, code);
      why = out.why;
      if (!why) shortcutNote = `шаблон «${out.title ?? code}»`;
    } else {
      why = await deliver(link.channel, link.thread_key, m.text);
    }

    await react(tok, String(m.chat.id), Number(m.message_id), !why, why ?? undefined);
    // О шаблоне сообщаем отдельной репликой: по одному «👍» менеджер не
    // поймёт, какой именно текст ушёл клиенту, а отозвать его нельзя.
    if (!why && shortcutNote) {
      await note(tok, String(m.chat.id), Number(m.message_id), `✅ Отправлен ${shortcutNote}`);
    }
    console.log(why
      ? `[tg] ответ в ${link.who || link.thread_key} НЕ отправлен: ${why}`
      : `[tg] ответ отправлен в ${link.who || link.thread_key}${hasMedia ? ' (вложение)' : ''}${shortcutNote ? ' — ' + shortcutNote : ''}`);
  }
  if (last !== offset) await setCursor(last);
}

/** Запустить опрос. Вызывается один раз при старте сервиса. */
export function startTelegramPolling(): void {
  if (timer) return;
  // 5 секунд: менеджер ждёт отправки сразу, а запрос дешёвый — очередь
  // пуста почти всегда.
  timer = setInterval(() => { void tick().catch(() => {}); }, 5000);
  console.log('[tg] опрос ответов менеджеров запущен');
}
