// Хранение переписки Instagram: тексты в БД, вложения на диске.
//
// Разделение такое же, как в whatsapp-service/store.js, и по той же причине:
// фото и голосовые за год — гигабайты, которые иначе попадали бы в каждый
// ночной pg_dump.
//
// Главное отличие от WhatsApp: у собеседника нет телефона. Связать диалог с
// карточкой клиента автоматически не по чему, поэтому привязка живёт на
// уровне диалога (instagram.threads.client_id) и ставится один раз — руками
// администратором или по номеру, который человек сам написал в переписке.
import pg from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || '';
// Тот же том, что у вложений WhatsApp, но свой каталог: файлы на диске, а не
// в БД — переписка за год это гигабайты, которые иначе попадали бы в каждый
// ночной pg_dump.
const MEDIA_DIR = process.env.INSTAGRAM_MEDIA_DIR || '/data/media';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
});

// Устойчивый идентификатор сообщения.
//
// Своего id в DOM у сообщений Direct нет, а повторный обход диалога обязан
// давать те же ключи — иначе каждая проверка почты дублировала бы всю
// переписку. Хеш берём от диалога, направления, текста и временной подписи:
// этого достаточно, чтобы два разных сообщения не схлопнулись, а одно и то
// же при повторном чтении совпало.
//
// Секунды из метки ОТБРАСЫВАЕМ, оставляя минуту. Причина: эхо собственного
// сообщения Meta присылает дважды с разницей в доли секунды («16:22:54.890»
// и «16:22:55.419»), и посекундный ключ делал из них две записи — в
// переписке CRM каждый ответ бота двоился. Клиенту при этом уходило одно
// сообщение: дублировалась только история.
//
// Риск схлопывания двух РАЗНЫХ сообщений в одну минуту снимается текстом:
// он входит в хеш, а два одинаковых текста подряд в одну минуту — это и
// есть дубль.
export function messageKey(threadId, item) {
  const h = crypto.createHash('sha1');
  const minute = String(item.stamp || '').slice(0, 16); // YYYY-MM-DDTHH:MM
  h.update(`${threadId}|${item.from_me ? 1 : 0}|${minute}|${item.body || ''}`);
  return `${threadId}_${h.digest('hex').slice(0, 20)}`;
}

// Время сообщения. В разметке оно бывает ISO-меткой (<time datetime>), а
// бывает только человеческой подписью из aria-label («14 сент. 2026 г., 10:44»).
// Во втором случае точное время восстановить нельзя — ставим момент чтения,
// иначе сообщение провалится в 1970 год и исчезнет из ленты.
export function parseStamp(stamp) {
  const s = String(stamp || '').trim();
  if (!s) return new Date();
  const iso = Date.parse(s);
  if (!Number.isNaN(iso)) return new Date(iso);
  return new Date();
}

/**
 * Известен ли уже ник диалога.
 *
 * Нужна, чтобы не дёргать Meta за профилем на каждое сообщение: ник
 * запрашивается один раз, при первом входящем от нового собеседника.
 */
export async function threadHasName(threadId) {
  if (!COMPANY_ID) return true;
  const { rows } = await pool.query(
    `SELECT username FROM instagram.threads WHERE thread_id = $1`,
    [threadId],
  );
  return !!rows[0]?.username;
}

/**
 * Настройки канала: режим обкатки и список тестовых аккаунтов.
 *
 * Читаются из БД при каждом сообщении, а не из окружения: владелец
 * переключает режим в админке, и правка должна действовать сразу, без
 * перезапуска контейнера.
 */
export async function channelSettings(channel = 'instagram') {
  if (!COMPANY_ID) return { testMode: false, testUsers: [] };
  const { rows } = await pool.query(
    `SELECT test_mode, test_users FROM ai.channel_settings
      WHERE company_id = $1 AND channel = $2`,
    [COMPANY_ID, channel],
  );
  const r = rows[0];
  return {
    testMode: !!r?.test_mode,
    testUsers: (r?.test_users ?? []).map(s => String(s).replace(/^@/, '').toLowerCase()),
  };
}

/** Ник диалога, если он уже сохранён. */
export async function threadUsername(threadId) {
  if (!COMPANY_ID) return null;
  const { rows } = await pool.query(
    `SELECT username FROM instagram.threads WHERE thread_id = $1`,
    [threadId],
  );
  return rows[0]?.username || null;
}

/**
 * Создать или обновить диалог. Возвращает текущую привязку к клиенту:
 * сообщения этого диалога должны получить тот же client_id.
 */
export async function upsertThread(t) {
  if (!COMPANY_ID) return null;
  const r = await pool.query(
    `INSERT INTO instagram.threads
       (thread_id, company_id, username, full_name, avatar_url, unread, last_at, last_body)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (thread_id) DO UPDATE SET
       -- COALESCE, а не прямое присваивание: обход списка диалогов не всегда
       -- видит ник (строка виртуализирована, в DOM только аватар), и без
       -- защиты уже известное имя затиралось бы на NULL.
       username   = COALESCE(EXCLUDED.username, instagram.threads.username),
       full_name  = COALESCE(EXCLUDED.full_name, instagram.threads.full_name),
       avatar_url = COALESCE(EXCLUDED.avatar_url, instagram.threads.avatar_url),
       -- NULL означает «не трогать счётчик»: догрузка имён обновляет только
       -- профиль, и обнулять непрочитанные при этом нельзя.
       unread     = COALESCE(EXCLUDED.unread, instagram.threads.unread),
       last_at    = GREATEST(COALESCE(EXCLUDED.last_at, instagram.threads.last_at),
                             COALESCE(instagram.threads.last_at, EXCLUDED.last_at)),
       last_body  = COALESCE(EXCLUDED.last_body, instagram.threads.last_body),
       updated_at = NOW()
     RETURNING client_id`,
    [
      t.thread_id, COMPANY_ID, t.username || null, t.full_name || null,
      t.avatar || null,
      // Отличаем «не передали» от нуля: Number(null)||0 превращал бы
      // отсутствие значения в 0 и сбрасывал счётчик непрочитанных.
      t.unread === undefined || t.unread === null ? null : Number(t.unread) || 0,
      t.last_at || null, t.last_body || null,
    ],
  );
  return r.rows[0]?.client_id || null;
}

/**
 * Записать прочитанные со страницы сообщения диалога.
 * Идемпотентно по ig_id: повторный обход не плодит дубли.
 * Возвращает, сколько записей добавлено новых.
 */
/**
 * Скачать вложение по ссылке Meta и положить на диск.
 *
 * Ссылки на медиа в Instagram ВРЕМЕННЫЕ — живут считанные часы. Поэтому файл
 * забираем сразу при приёме сообщения: отложить «до открытия в админке»
 * нельзя, к тому моменту ссылка уже протухнет и фото будет потеряно
 * безвозвратно.
 *
 * Возвращает { rel, size, mime } или null, если скачать не вышло: вложение не
 * повод терять само сообщение, оно сохранится и без файла.
 */
// Диспетчер для скачивания вложений. Создаётся один раз: новый ProxyAgent на
// каждый файл открывал бы отдельное соединение к мосту.
//
// Прокси берём из INSTAGRAM_SOCKS_PROXY — той же переменной, что graph.js.
// Системные HTTP(S)_PROXY в контейнере указывают на 127.0.0.1:1080, то есть
// на localhost САМОГО контейнера, где ничего не слушает: по ним скачивание
// падало с «fetch failed». Мост живёт на host.docker.internal.
let mediaDispatcher;
let mediaDispatcherReady = false;
async function dispatcherFor() {
  if (mediaDispatcherReady) return mediaDispatcher;
  mediaDispatcherReady = true;
  try {
    const { ProxyAgent, Agent } = await import('undici');
    const proxy = process.env.INSTAGRAM_SOCKS_PROXY || '';
    mediaDispatcher = proxy
      ? new ProxyAgent(proxy)
      : new Agent({ connect: { timeout: 10_000 } });
  } catch (e) {
    console.error('[IG][медиа] undici недоступен:', e.message);
    mediaDispatcher = undefined;
  }
  return mediaDispatcher;
}

async function fetchMedia(igId, threadId, url) {
  try {
    const dispatcher = await dispatcherFor();
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000), dispatcher });
    if (!r.ok) {
      console.warn(`[IG][медиа] ${igId}: Meta ответила ${r.status}`);
      return null;
    }
    const mime = (r.headers.get('content-type') || '').split(';')[0].trim() || 'application/octet-stream';
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length) return null;

    const EXT = {
      'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
      'video/mp4': 'mp4', 'video/quicktime': 'mov',
      'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
    };
    const ext = EXT[mime] || 'bin';
    const safeThread = String(threadId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const rel = path.join(safeThread, `${String(igId).replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`);
    const abs = path.join(MEDIA_DIR, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });

    // Пишем во временный файл и переименовываем: при обрыве в середине записи
    // на диске не останется «половины» файла, который потом отдадут клиенту.
    const tmp = `${abs}.tmp`;
    await fsp.writeFile(tmp, buf);
    await fsp.rename(tmp, abs);
    console.log(`[IG][медиа] сохранено ${rel} (${Math.round(buf.length / 1024)} КБ)`);
    return { rel, size: buf.length, mime };
  } catch (e) {
    console.warn(`[IG][медиа] ${igId}: ${e.message}`);
    return null;
  }
}

/**
 * Сохранить исходящее вложение на диск.
 *
 * Возвращает относительный путь. Каталог outbox отдельный: по нему же
 * ограничен публичный доступ (см. signedMediaPath), чтобы подписанной ссылкой
 * нельзя было вытащить входящую переписку клиентов.
 */
export async function saveOutgoingMedia(buf, mime) {
  const EXT = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/quicktime': 'mov',
    'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
  };
  const ext = EXT[mime] || 'bin';
  const rel = path.join('outbox', `${Date.now()}_${crypto.randomUUID().slice(0, 8)}.${ext}`);
  const abs = path.join(MEDIA_DIR, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.tmp`;
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, abs);
  return { rel, size: buf.length, mime };
}

// Секрет подписи публичных ссылок. Своего не заводим: JWT_SECRET уже есть у
// сервиса и обязателен при старте.
const MEDIA_SIGN_SECRET = process.env.JWT_SECRET || '';

/**
 * Подписать путь к файлу для публичной отдачи.
 *
 * Meta скачивает вложение САМА, безымянным запросом — отдать его под токеном
 * нельзя. Поэтому ссылка подписывается и живёт ограниченное время: столько,
 * чтобы Meta успела забрать файл, и не дольше.
 */
export function signMediaPath(rel, ttlSec = 900) {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const sig = crypto.createHmac('sha256', MEDIA_SIGN_SECRET)
    .update(`${rel}|${exp}`).digest('hex').slice(0, 32);
  return { token: Buffer.from(`${rel}|${exp}|${sig}`).toString('base64url') };
}

/**
 * Проверить подпись и вернуть абсолютный путь к файлу.
 * null — подпись неверна, срок истёк, файл вне outbox или его нет.
 */
export function signedMediaPath(token) {
  try {
    const raw = Buffer.from(String(token), 'base64url').toString('utf8');
    const [rel, expStr, sig] = raw.split('|');
    if (!rel || !expStr || !sig) return null;
    if (Number(expStr) < Math.floor(Date.now() / 1000)) return null;

    const expect = crypto.createHmac('sha256', MEDIA_SIGN_SECRET)
      .update(`${rel}|${expStr}`).digest('hex').slice(0, 32);
    // timingSafeEqual: сравнение подписи посимвольно даёт возможность её
    // подобрать по времени ответа.
    const a = Buffer.from(sig);
    const b = Buffer.from(expect);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    // Публично отдаём ТОЛЬКО исходящие: иначе подписанной ссылкой можно было
    // бы вытащить фото, присланные клиентами.
    if (!rel.startsWith('outbox/')) return null;

    const abs = path.join(MEDIA_DIR, rel);
    if (!abs.startsWith(path.resolve(MEDIA_DIR))) return null;
    if (!fs.existsSync(abs)) return null;
    return abs;
  } catch {
    return null;
  }
}

/**
 * Файл вложения по ig_id — для выдачи в админке и сохранения в архив.
 */
export async function mediaOf(igId) {
  const r = await pool.query(
    `SELECT media_path, media_name, media_mime FROM instagram.messages
      WHERE ig_id = $1 AND media_path IS NOT NULL`,
    [igId],
  );
  if (!r.rows[0]) return null;
  const abs = path.join(MEDIA_DIR, r.rows[0].media_path);
  // Защита от выхода за пределы каталога: media_path приходит из базы, но
  // путь всё равно проверяем — сложенный из внешних данных он мог бы увести
  // чтение в /etc.
  if (!abs.startsWith(path.resolve(MEDIA_DIR))) return null;
  if (!fs.existsSync(abs)) return null;
  return { abs, name: r.rows[0].media_name, mime: r.rows[0].media_mime };
}

export async function saveMessages(threadId, items, clientId) {
  if (!COMPANY_ID || !items?.length) return { saved: 0 };
  let saved = 0;
  for (const it of items) {
    const igId = messageKey(threadId, it);
    const type = it.has_media ? (it.media_kind === 'voice' ? 'voice' : 'media') : 'text';

    // Файл качаем ДО вставки: ссылки Meta живут часы, и откладывать нельзя.
    // Скачиваем только для новых сообщений — проверяем наличие заранее, иначе
    // повторный обход диалога тянул бы те же файлы на каждом проходе.
    //
    // local_media — файл, который мы сами только что отправили: он уже лежит
    // на диске, перекачивать его из Meta незачем.
    let media = it.local_media || null;
    if (!media && it.media_url && /^https?:/i.test(it.media_url)) {
      const { rowCount } = await pool.query(
        `SELECT 1 FROM instagram.messages WHERE ig_id = $1`, [igId]);
      if (!rowCount) media = await fetchMedia(igId, threadId, it.media_url);
    }

    const r = await pool.query(
      `INSERT INTO instagram.messages
         (ig_id, company_id, thread_id, client_id, from_me, body, msg_type, sent_at,
          media_path, media_name, media_mime, media_size)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (ig_id) DO NOTHING`,
      [
        igId, COMPANY_ID, threadId, clientId || null,
        !!it.from_me, it.body || '', type, parseStamp(it.stamp),
        media?.rel || null,
        media ? path.basename(media.rel) : null,
        media?.mime || null,
        media?.size || null,
      ],
    );
    saved += r.rowCount;
  }
  return { saved };
}

// Привязать диалог к карточке клиента. Проставляем и во все его сообщения:
// переписка обычно появляется раньше карточки — человек пишет в Direct, и
// только потом его заводят в CRM.
export async function linkThreadToClient(threadId, clientId) {
  const a = await pool.query(
    `UPDATE instagram.threads SET client_id = $2, updated_at = NOW()
      WHERE thread_id = $1 AND company_id = $3`,
    [threadId, clientId, COMPANY_ID],
  );
  const b = await pool.query(
    `UPDATE instagram.messages SET client_id = $2
      WHERE thread_id = $1 AND company_id = $3`,
    [threadId, clientId, COMPANY_ID],
  );
  return { thread: a.rowCount, messages: b.rowCount };
}

// Список диалогов для интерфейса.
/**
 * Диалоги для списка в админке.
 *
 * q — строка поиска: имя из карточки клиента, @ник, видимое имя в Instagram
 * или текст последнего сообщения. Искать ОБЯЗАТЕЛЬНО в базе, а не в уже
 * загруженном списке: диалогов 3000+, а на экран отдаётся сотня последних,
 * и нужный собеседник запросто лежит на 215-м месте — именно так «поиск не
 * находил» существующий диалог.
 *
 * При поиске лимит поднимаем: отобранных по условию строк немного, а
 * обрезать результат на сотне — снова прятать то, что человек ищет.
 */
export async function listThreads(limit = 100, q = '') {
  const term = String(q || '').trim();
  if (!term) {
    const r = await pool.query(
      `SELECT t.thread_id, t.username, t.full_name, t.avatar_url, t.unread,
              t.last_at, t.last_body, t.client_id, c.full_name AS client_name
         FROM instagram.threads t
         LEFT JOIN clients.clients c ON c.id = t.client_id
        WHERE t.company_id = $1
        ORDER BY t.last_at DESC NULLS LAST
        LIMIT $2`,
      [COMPANY_ID, limit],
    );
    return r.rows;
  }

  // Ищем без учёта регистра по всем четырём полям. Ведущую «@» отбрасываем:
  // человек набирает «@madina.dii__», а в базе хранится «madina.dii__».
  //
  // ESCAPE обязателен: в никах Instagram часто есть «_», а для LIKE это
  // «любой символ». Без экранирования «madina.dii__» совпало бы и с
  // «madina.diiXY», и поиск возвращал бы лишнее.
  const like = '%' + term.replace(/^@+/, '').replace(/[\\%_]/g, (c) => '\\' + c) + '%';
  const r = await pool.query(
    `SELECT t.thread_id, t.username, t.full_name, t.avatar_url, t.unread,
            t.last_at, t.last_body, t.client_id, c.full_name AS client_name
       FROM instagram.threads t
       LEFT JOIN clients.clients c ON c.id = t.client_id
      WHERE t.company_id = $1
        AND (t.username ILIKE $2 ESCAPE '\\' OR t.full_name ILIKE $2 ESCAPE '\\'
             OR c.full_name ILIKE $2 ESCAPE '\\' OR t.last_body ILIKE $2 ESCAPE '\\')
      ORDER BY t.last_at DESC NULLS LAST
      LIMIT $3`,
    [COMPANY_ID, like, Math.max(limit, 300)],
  );
  return r.rows;
}

/**
 * Поиск диалогов по содержимому переписки — основа ручного отбора получателей.
 *
 * terms — список условий; диалог подходит, когда КАЖДОЕ выполнено хотя бы
 * одним сообщением. Внутри условия варианты перечисляются через «|».
 * Пример: ['липосакц|лл', 'ног|бедр|галифе'] — «спрашивал про липосакцию»
 * И «называл ноги», причём в разных сообщениях одного диалога: человек пишет
 * «ЛЛ» в одной реплике, а зону — в следующей.
 *
 * only_incoming по умолчанию включён, и это принципиально: в наших исходящих
 * лежит прайс, где перечислены все зоны сразу, — по нему в выборку попадёт
 * каждый, кому прайс вообще отправляли, а не тот, кто спрашивал.
 *
 * Отдаём ещё и позицию в инбоксе: у сохранённых сообщений время недостоверно
 * (Instagram отдаёт «2 ч» вместо даты), а порядок вычитки повторяет порядок
 * инбокса — свежие диалоги сверху. Это оценка давности, а не дата.
 */
export async function searchThreads({ terms = [], onlyIncoming = true, limit = 300, from = null, to = null } = {}) {
  if (!COMPANY_ID) return [];
  const clean = terms
    .map(t => String(t || '').trim())
    .filter(Boolean);
  if (!clean.length) return [];

  // Период обращения: условие должно встретиться в сообщении клиента,
  // написанном в эти даты. Так отбирают «кто спрашивал про ЛЛ в сентябре»,
  // а не всех за всю историю. $2/$3 — границы, NULL = без ограничения.
  const params = [COMPANY_ID, from || null, to || null];
  const period = `AND ($2::timestamptz IS NULL OR m.sent_at >= $2::timestamptz)
         AND ($3::timestamptz IS NULL OR m.sent_at < $3::timestamptz)`;
  const conds = [];
  for (const term of clean) {
    // Варианты условия → один регэксп. Экранируем служебные символы: человек
    // пишет в фильтр «ног (галифе)», и скобки не должны ломать запрос.
    //
    // Каждый вариант привязываем к НАЧАЛУ слова (\m). Без этого «лл» находит
    // «миллион», а «ног» — «многое»: подстрока внутри слова даёт мусор, из-за
    // которого список получателей нельзя доверять. Конец слова намеренно
    // свободен, чтобы «липосакц» ловил все падежи («липосакция», «липосакции»).
    const rx = term
      .split('|')
      .map(v => v.trim())
      .filter(Boolean)
      // «ё» приводим к «е» с обеих сторон: клиент пишет «бёдра», фильтр — «бедр».
      .map(v => v.replace(/ё/gi, 'е'))
      .map(v => '\\m' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
    if (!rx) continue;
    params.push(rx);
    conds.push(`EXISTS (
      SELECT 1 FROM instagram.messages m
       WHERE m.thread_id = t.thread_id
         AND m.company_id = t.company_id
         ${onlyIncoming ? 'AND m.from_me = FALSE' : ''}
         ${period}
         AND translate(m.body, 'Ёё', 'Ее') ~* $${params.length})`);
  }
  if (!conds.length) return [];

  params.push(limit);
  const r = await pool.query(
    `WITH pos AS (
       SELECT thread_id, row_number() OVER (ORDER BY created_at) AS inbox_pos
         FROM instagram.threads WHERE company_id = $1
     )
     SELECT t.thread_id, t.username, t.full_name, t.client_id,
            c.full_name AS client_name, c.phone::text AS client_phone,
            p.inbox_pos,
            (SELECT count(*)::int FROM instagram.messages m
              WHERE m.thread_id = t.thread_id) AS msgs,
            (SELECT left(regexp_replace(m.body, '\\s+', ' ', 'g'), 160)
               FROM instagram.messages m
              WHERE m.thread_id = t.thread_id AND m.from_me = FALSE
                AND translate(m.body, 'Ёё', 'Ее') ~* $4 ${period}
              ORDER BY m.created_at LIMIT 1) AS matched_phrase,
            -- Цитата по ПОСЛЕДНЕМУ условию (обычно это зона: ноги, живот).
            -- Без неё в списке видна только фраза по первому условию, и строка
            -- «сколько стоит липосакция живота?» выглядит попаданием не по теме,
            -- хотя про ноги человек спросил следующим сообщением.
            ${conds.length > 1 ? `(SELECT left(regexp_replace(m.body, '\\\\s+', ' ', 'g'), 160)
               FROM instagram.messages m
              WHERE m.thread_id = t.thread_id AND m.from_me = FALSE
                AND translate(m.body, 'Ёё', 'Ее') ~* $${3 + conds.length} ${period}
              ORDER BY m.created_at LIMIT 1)` : 'NULL'} AS matched_zone,
            -- когда клиент последний раз писал по теме (в пределах периода)
            (SELECT max(m.sent_at) FROM instagram.messages m
              WHERE m.thread_id = t.thread_id AND m.from_me = FALSE
                AND translate(m.body, 'Ёё', 'Ее') ~* $4 ${period}) AS asked_at
       FROM instagram.threads t
       JOIN pos p ON p.thread_id = t.thread_id
       LEFT JOIN clients.clients c ON c.id = t.client_id
      WHERE t.company_id = $1
        AND ${conds.join(' AND ')}
      ORDER BY asked_at DESC NULLS LAST, p.inbox_pos
      LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

/**
 * Уже отправляли этот текст в диалог?
 *
 * Защита от повторной отправки: кампанию могут запустить второй раз после
 * обрыва, и человек не должен получить одно и то же предложение дважды.
 * Сравниваем по первым 120 знакам — хвост может отличаться подстановкой имени.
 */
export async function alreadySent(threadId, message) {
  if (!COMPANY_ID) return false;
  const head = String(message || '').trim().slice(0, 120);
  if (!head) return false;
  const r = await pool.query(
    `SELECT 1 FROM instagram.messages
      WHERE company_id = $1 AND thread_id = $2 AND from_me = TRUE
        AND left(body, 120) = $3
      LIMIT 1`,
    [COMPANY_ID, threadId, head],
  );
  return r.rowCount > 0;
}

/**
 * Писали ли мы в этот диалог после момента `since`.
 *
 * Нужно вместо сравнения текстов: в кампании каждый получатель получает
 * свой вариант сообщения, поэтому «такой же текст уже уходил» больше не
 * работает как защита от повтора при перезапуске. Признак повтора теперь
 * временной — «мы уже писали этому человеку в рамках текущей кампании».
 */
export async function sentSince(threadId, sinceIso) {
  if (!COMPANY_ID || !sinceIso) return false;
  const r = await pool.query(
    `SELECT 1 FROM instagram.messages
      WHERE company_id = $1 AND thread_id = $2 AND from_me = TRUE
        AND sent_at >= $3::timestamptz
      LIMIT 1`,
    [COMPANY_ID, threadId, sinceIso],
  );
  return r.rowCount > 0;
}

export async function listThreadMessages(threadId, limit = 200) {
  const r = await pool.query(
    `SELECT ig_id, from_me, body, msg_type, media_name, media_mime,
            (media_path IS NOT NULL) AS has_media, sent_at, author_name
       FROM instagram.messages
      WHERE thread_id = $1
      ORDER BY sent_at DESC, created_at DESC
      LIMIT $2`,
    [threadId, limit],
  );
  return r.rows.reverse(); // в карточке читаем сверху вниз, как в мессенджере
}

// Переписка в карточке клиента — все его диалоги Instagram одной лентой.
export async function listByClient(clientId, limit = 200) {
  const r = await pool.query(
    `SELECT m.ig_id, m.thread_id, m.from_me, m.body, m.msg_type,
            (m.media_path IS NOT NULL) AS has_media, m.sent_at, m.author_name,
            t.username
       FROM instagram.messages m
       JOIN instagram.threads t ON t.thread_id = m.thread_id
      WHERE m.client_id = $1
      ORDER BY m.sent_at DESC, m.created_at DESC
      LIMIT $2`,
    [clientId, limit],
  );
  return r.rows.reverse();
}

// Новые входящие для уведомлений. Отбор по created_at (когда мы узнали), а не
// по sent_at: сообщение могло быть написано час назад, но прочитано нами
// только сейчас — по sent_at оно бы не попало в выборку и уведомление
// потерялось.
export async function newIncoming(since, limit = 20) {
  const r = await pool.query(
    `SELECT m.ig_id, m.thread_id, m.client_id, m.body, m.msg_type,
            (m.media_path IS NOT NULL) AS has_media, m.sent_at, m.created_at,
            t.username, t.full_name AS ig_name, c.full_name AS client_name
       FROM instagram.messages m
       JOIN instagram.threads t ON t.thread_id = m.thread_id
       LEFT JOIN clients.clients c ON c.id = m.client_id
      WHERE m.company_id = $1 AND m.from_me = FALSE AND m.created_at > $2
      ORDER BY m.created_at
      LIMIT $3`,
    [COMPANY_ID, since, limit],
  );
  return r.rows;
}

export async function unreadCount(since) {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM instagram.messages
      WHERE company_id = $1 AND from_me = FALSE AND created_at > $2`,
    [COMPANY_ID, since],
  );
  return r.rows[0]?.n || 0;
}

// Подпись автора у только что отправленного сообщения.
//
// Автора нельзя проставить в saveMessages: та читает диалог целиком и не
// отличает «мы отправили это секунду назад» от старой исходящей реплики —
// при первом чтении подпись получили бы все прошлые сообщения разом.
export async function markAuthor(threadId, body, author) {
  if (!COMPANY_ID || !author?.id || !body) return 0;
  const r = await pool.query(
    `UPDATE instagram.messages SET author_id = $1, author_name = $2
      WHERE ig_id = (
        SELECT ig_id FROM instagram.messages
         WHERE company_id = $3 AND thread_id = $4
           AND from_me = TRUE AND author_id IS NULL AND body = $5
           -- Окно в 10 минут: «Добрый день» шлют часто, и без ограничения по
           -- времени подпись села бы на реплику прошлой недели.
           AND sent_at > NOW() - INTERVAL '10 minutes'
         ORDER BY created_at DESC LIMIT 1
      )`,
    [author.id, author.name || null, COMPANY_ID, threadId, body],
  );
  return r.rowCount;
}

export async function authorName(userId) {
  if (!userId) return null;
  const r = await pool.query(
    `SELECT NULLIF(TRIM(full_name), '') AS name FROM users.users WHERE id = $1`,
    [userId],
  );
  return r.rows[0]?.name || null;
}

// Клиент по номеру телефона. Единственный автоматический путь связывания:
// человек сам написал номер в переписке.
export async function findClientByPhone(phoneDigits) {
  if (!COMPANY_ID || !phoneDigits) return null;
  const r = await pool.query(
    `SELECT id, full_name FROM clients.clients
      WHERE company_id = $1
        AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = $2
      LIMIT 1`,
    [COMPANY_ID, phoneDigits],
  );
  return r.rows[0] || null;
}

// ── Черновики ИИ-ответчика ──

export async function saveDraft(threadId, draft, safe) {
  const r = await pool.query(
    `UPDATE instagram.threads
        SET ai_draft = $2, ai_draft_at = NOW(), ai_safe = $3, updated_at = NOW()
      WHERE thread_id = $1 AND company_id = $4`,
    [threadId, draft, safe, COMPANY_ID],
  );
  return r.rowCount;
}

// Черновик снимается сразу после отправки: оставленный, он покажется
// администратору второй раз, и клиент получит тот же текст дважды.
export async function clearDraft(threadId) {
  await pool.query(
    `UPDATE instagram.threads
        SET ai_draft = NULL, ai_draft_at = NULL, ai_safe = NULL, updated_at = NOW()
      WHERE thread_id = $1 AND company_id = $2`,
    [threadId, COMPANY_ID],
  );
}

export async function getDraft(threadId) {
  const r = await pool.query(
    `SELECT ai_draft, ai_draft_at, ai_safe FROM instagram.threads
      WHERE thread_id = $1 AND company_id = $2`,
    [threadId, COMPANY_ID],
  );
  return r.rows[0] || null;
}

// Диалоги с готовым черновиком — очередь на проверку администратором.
export async function pendingDrafts(limit = 50) {
  const r = await pool.query(
    `SELECT t.thread_id, t.username, t.full_name, t.ai_draft, t.ai_draft_at,
            t.ai_safe, t.last_body, t.last_at, t.client_id, c.full_name AS client_name
       FROM instagram.threads t
       LEFT JOIN clients.clients c ON c.id = t.client_id
      WHERE t.company_id = $1 AND t.ai_draft IS NOT NULL
      ORDER BY t.ai_draft_at DESC
      LIMIT $2`,
    [COMPANY_ID, limit],
  );
  return r.rows;
}
