// Официальный путь к Instagram Direct: Graph API вместо браузера.
//
// Чем это лучше puppeteer-сессии, которая живёт в instagram.js:
// нет Chromium в контейнере, нет риска чекпоинта и блокировки за
// «подозрительную активность», сообщения приходят мгновенно по webhook, а
// не находятся обходом инбокса раз в 15 минут. Браузерный путь остаётся
// рабочим и нужен, пока Meta не одобрила Advanced Access: без него webhook
// доставляет только сообщения от людей с ролью в приложении.
//
// Токен сюда не передаётся параметром и не хранится в этом сервисе: он
// лежит в salons.integration_credentials и читается при каждой отправке.
// Причина — один источник правды: токен перевыпускают в админке, и
// закэшированная копия пережила бы перевыпуск и начала бы молча отказывать.
import crypto from 'crypto';
import { pool } from './store.js';

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || '';
// Строка, которую Meta присылает при подключении webhook. Её же владелец
// вписывает в кабинете приложения — она не секрет, а взаимная сверка.
const VERIFY_TOKEN = process.env.INSTAGRAM_VERIFY_TOKEN || '';
// Секрет приложения Meta. Нужен, чтобы проверять подпись входящих: без неё
// webhook-эндпоинт принимает что угодно от кого угодно.
const APP_SECRET = process.env.INSTAGRAM_APP_SECRET || '';
// Секрет ПРИЛОЖЕНИЯ INSTAGRAM — он свой, со страницы «API setup with
// Instagram login», и не совпадает с секретом основного приложения Meta.
// В варианте Instagram Login уведомления подписаны именно им: проверка
// чужим секретом даёт вечное «подпись не совпадает».
const IG_APP_SECRET = process.env.INSTAGRAM_IG_APP_SECRET || '';

const PROXY = process.env.INSTAGRAM_SOCKS_PROXY || '';

// Запросы к Meta идут через тот же VLESS-мост, что и браузер WhatsApp:
// прямого маршрута до graph.facebook.com с этого сервера нет (DNS отдаёт
// ENOTFOUND), а выход голландским адресом для российского аккаунта —
// повод для блокировки. Агент задаётся явно, потому что в окружении
// контейнера есть системные HTTPS_PROXY, и undici подхватывает их молча.
let dispatcher;
try {
  const { ProxyAgent, Agent } = await import('undici');
  dispatcher = PROXY ? new ProxyAgent(PROXY) : new Agent({ connect: { timeout: 10_000 } });
} catch (e) {
  // Молчать здесь нельзя: без undici запрос уходит напрямую, упирается в
  // ENOTFOUND и возвращается как «профиль не получен» — выглядит это как
  // пустой ответ Meta, а не как отсутствующая зависимость. Один раз на
  // таком молчании уже потеряли время.
  console.error('[IG] undici недоступен:', e.message,
    '— запросы к Meta пойдут без прокси и, скорее всего, не пройдут');
  dispatcher = undefined;
}

/** Учётные данные интеграции из общей таблицы. */
export async function credentials() {
  const { rows } = await pool.query(
    `SELECT token, meta FROM salons.integration_credentials
      WHERE company_id = $1 AND provider = 'instagram'`,
    [COMPANY_ID],
  );
  const row = rows[0];
  if (!row?.token) return null;
  const meta = row.meta || {};
  return {
    token: row.token,
    igId: meta.ig_id || null,
    host: meta.host || 'graph.facebook.com',
    version: meta.api_version || 'v23.0',
    username: meta.username || null,
  };
}

/**
 * Проверка подписи webhook.
 *
 * Meta подписывает тело запроса секретом приложения. Без проверки любой,
 * кто узнает адрес эндпоинта, сможет подбрасывать в CRM выдуманные
 * сообщения от имени клиентов — а эндпоинт по своей природе открыт наружу
 * без авторизации.
 *
 * Сравнение через timingSafeEqual: обычное === по строке утекает позицию
 * первого несовпавшего байта и позволяет подобрать подпись.
 */
export function verifySignature(rawBody, header) {
  // Два возможных секрета: у Instagram Login — секрет приложения Instagram,
  // у Facebook Login — секрет основного приложения. Какой именно подписал
  // уведомление, заранее не известно, поэтому проверяем оба и принимаем,
  // если совпал любой. Это не ослабляет защиту: подобрать нужно по-прежнему
  // полный HMAC, просто допустимых ключей два.
  const secrets = [IG_APP_SECRET, APP_SECRET].filter(Boolean);
  if (!secrets.length) {
    return { ok: false, reason: 'не задан ни INSTAGRAM_IG_APP_SECRET, ни INSTAGRAM_APP_SECRET' };
  }
  if (!header) return { ok: false, reason: 'нет заголовка подписи' };

  const got = String(header).replace(/^sha256=/, '');
  const a = Buffer.from(got, 'hex');
  for (const secret of secrets) {
    const want = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const b = Buffer.from(want, 'hex');
    // timingSafeEqual требует равной длины и не терпит мусорного заголовка.
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return { ok: true };
  }
  return { ok: false, reason: 'подпись не совпадает' };
}

/** Ответ на подключение webhook (GET-проверка от Meta). */
export function verifyChallenge(query) {
  if (!VERIFY_TOKEN) return { ok: false, reason: 'INSTAGRAM_VERIFY_TOKEN не задан' };
  if (query['hub.mode'] !== 'subscribe') return { ok: false, reason: 'неизвестный режим' };
  if (query['hub.verify_token'] !== VERIFY_TOKEN) return { ok: false, reason: 'токен проверки не совпадает' };
  return { ok: true, challenge: String(query['hub.challenge'] ?? '') };
}

/**
 * Разобрать уведомление Meta в плоский список сообщений.
 *
 * Формат webhook вложенный и необязательный почти во всём, поэтому разбор
 * вынесен отдельно: так его видно целиком и можно проверить без сети.
 *
 * is_echo помечает сообщения, отправленные нами же (в том числе с телефона
 * администратора) — их надо сохранять в историю, но не отвечать на них.
 */
export function parseWebhook(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    // Два формата одного события.
    //
    // Живой Direct приходит как entry[].messaging[] — так описано в
    // документации Messenger Platform, и так шлёт Instagram в бою.
    //
    // Но кнопка «Отправить на сервер» в кабинете Meta шлёт формат подписок
    // Graph API: entry[].changes[] с field: "messages", а само событие
    // лежит в changes[].value. Без второй ветки тестовое событие молча
    // проходит мимо: сервис отвечает 200, в логах пусто, и выглядит это
    // как будто webhook не работает.
    const events = [
      ...(entry.messaging ?? []),
      ...(entry.changes ?? [])
        .filter(c => c.field === 'messages' && c.value)
        .map(c => c.value),
    ];
    for (const m of events) {
      const msg = m.message;
      if (!msg) continue;
      // Удаление сообщения клиентом: отдельное событие, не текст.
      if (msg.is_deleted) continue;

      const fromMe = !!msg.is_echo;
      // Для входящего собеседник — отправитель, для нашего эха — получатель.
      const peer = fromMe ? m.recipient?.id : m.sender?.id;
      if (!peer) continue;

      const attachments = msg.attachments ?? [];
      out.push({
        mid: msg.mid || null,
        threadId: String(peer),
        fromMe,
        text: msg.text || '',
        // Тип по первому вложению: смешанные сообщения Direct не присылает.
        type: attachments.length ? (attachments[0].type || 'media') : 'text',
        mediaUrl: attachments[0]?.payload?.url || null,
        unsupported: !!msg.is_unsupported,
        at: m.timestamp ? new Date(Number(m.timestamp)) : new Date(),
      });
    }
  }
  return out;
}

/**
 * Отправить сообщение в Direct.
 *
 * Отвечать можно только в течение 24 часов с последнего сообщения клиента
 * (правило Meta). Поэтому ошибку 10/551 переводим в понятный текст: иначе
 * администратор видит код и не понимает, что ответ просто опоздал.
 */
export async function sendMessage(recipientIgsid, text) {
  const cred = await credentials();
  if (!cred) return { ok: false, error: 'токен Instagram не сохранён (Настройки → Интеграции)' };
  // Для Instagram Login id не нужен — он зашит в токен (путь /me/messages).
  if (!cred.igId && !cred.host.includes('graph.instagram.com')) {
    return { ok: false, error: 'в интеграции не записан id аккаунта Instagram' };
  }

  // Путь зависит от варианта подключения:
  //   Instagram Login  -> graph.instagram.com/<ver>/me/messages
  //   Facebook Login   -> graph.facebook.com/<ver>/<ig-id>/messages
  // У Instagram Login идентификатор аккаунта берётся из самого токена, и
  // подстановка igId в путь даёт ошибку «Unsupported post request».
  const viaInstagramLogin = cred.host.includes('graph.instagram.com');
  const target = viaInstagramLogin ? 'me' : cred.igId;
  const url = `https://${cred.host}/${cred.version}/${target}/messages`;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${cred.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: String(recipientIgsid) },
        message: { text: String(text).slice(0, 1000) },
      }),
      signal: AbortSignal.timeout(20_000),
      dispatcher,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = body?.error || {};
      const code = err.code;
      let msg = err.message || `HTTP ${r.status}`;
      if (code === 10 || err.error_subcode === 2534022) {
        msg = 'прошло больше 24 часов с сообщения клиента — Instagram не принимает ответ';
      } else if (code === 190) {
        msg = 'токен недействителен или истёк — обновите его в Настройках';
      }
      return { ok: false, error: msg, code };
    }
    return { ok: true, messageId: body.message_id || null };
  } catch (e) {
    return { ok: false, error: `сеть: ${e.message}` };
  }
}

/**
 * Профиль собеседника по его IGSID.
 *
 * Webhook присылает только идентификатор, без ника и имени — поэтому в
 * списке диалогов строка выглядит как «без имени». Ник запрашивается
 * отдельным вызовом и кладётся в карточку диалога один раз.
 *
 * Ошибку не поднимаем наверх: без ника переписка всё равно работает, а
 * падение здесь сорвало бы сохранение самого сообщения.
 */
export async function fetchProfile(igsid) {
  const cred = await credentials();
  if (!cred) return null;
  const url = `https://${cred.host}/${cred.version}/${igsid}`
    + `?fields=name,username,profile_pic&access_token=${encodeURIComponent(cred.token)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15_000), dispatcher });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn(`[IG] профиль ${igsid}: HTTP ${r.status} ${t.slice(0, 120)}`);
      return null;
    }
    const b = await r.json();
    return {
      username: b.username || null,
      fullName: b.name || null,
      avatarUrl: b.profile_pic || null,
    };
  } catch (e) {
    // Причину пишем: «ник не подтянулся» без объяснения выглядит как
    // отказ Meta, хотя чаще это сеть или отсутствующий прокси.
    console.warn(`[IG] профиль ${igsid} не получен:`, e.message);
    return null;
  }
}

export function webhookStatus() {
  return {
    verify_token_set: !!VERIFY_TOKEN,
    app_secret_set: !!APP_SECRET,
    company_id_set: !!COMPANY_ID,
  };
}
