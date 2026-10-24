// Хранение переписки: тексты в БД, вложения на диске.
//
// Разделение сознательное: голосовые и фото из переписки за год — это
// гигабайты, в bytea они раздули бы базу и каждый ночной pg_dump. Записи
// разговоров телефонии хранятся так же (telephony/routes/calls.ts).
import pg from 'pg';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';

const MEDIA_DIR = process.env.WHATSAPP_MEDIA_DIR || '/data/media';
const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || '';

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
});

// Номер в вид, пригодный для сравнения: у WhatsApp это «79991234567@c.us», а в
// clients.clients телефоны лежат в разных форматах (+7…, 8…, со скобками).
export function digitsOf(raw) {
  let d = String(raw || '').replace(/[^0-9]/g, '');
  if (d.startsWith('8')) d = '7' + d.slice(1);
  return d;
}

// Клиент по номеру: сравнение по последним 10 цифрам — см. findClientId.
/**
 * Найти карточку клиента по номеру из WhatsApp.
 *
 * Сравнение по ПОСЛЕДНИМ 10 ЦИФРАМ, а не точным совпадением строки.
 * Причина: в карточках номер записан как придётся — «8 951…», «+7 951…»,
 * «951…», а WhatsApp всегда отдаёт «7951…». Точное сравнение не находило
 * такие карточки, и переписка с давним клиентом висела как неизвестный
 * номер, хотя карточка есть. Разовый импорт (clientPhoneIndex) всё это
 * время сравнивал правильно — две разные логики для одной задачи.
 *
 * Из нескольких совпадений берём самую раннюю карточку: на ней история и
 * деньги, а дубли (тот же человек заведён дважды) сливаются отдельно.
 */
async function findClientId(phoneDigits) {
  if (!COMPANY_ID) return null;
  const tail = String(phoneDigits || '').slice(-10);
  if (tail.length < 10) return null;
  const r = await pool.query(
    `SELECT id FROM clients.clients
      WHERE company_id = $1
        AND is_deleted = FALSE
        AND right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = $2
      ORDER BY created_at
      LIMIT 1`,
    [COMPANY_ID, tail],
  );
  return r.rows[0]?.id || null;
}

// Вложение на диск: <MEDIA_DIR>/<номер>/<wa_id>.<ext>.
// Возвращает путь ОТНОСИТЕЛЬНО MEDIA_DIR, чтобы том можно было перемонтировать
// или перенести, не переписывая базу.
async function saveMedia(waId, phoneDigits, media) {
  const ext = (media.mimetype || '').split('/')[1]?.split(';')[0] || 'bin';
  const rel = path.join(phoneDigits, `${waId.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`);
  const abs = path.join(MEDIA_DIR, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const buf = Buffer.from(media.data, 'base64');
  // Пишем во временный файл и переименовываем: при обрыве в середине записи
  // на диске не останется «половины» файла, который потом отдадут клиенту.
  const tmp = `${abs}.tmp`;
  await fsp.writeFile(tmp, buf);
  await fsp.rename(tmp, abs);
  return { rel, size: buf.length };
}

/**
 * Сохранить сообщение. Идемпотентно: события приходят повторно при
 * переподключении сеанса, поэтому ON CONFLICT DO NOTHING по wa_id.
 */
export async function saveMessage(msg, media) {
  if (!COMPANY_ID) return null;
  const chatId = msg.fromMe ? msg.to : msg.from;
  // Групповые чаты (@g.us) и рассылки пропускаем: в CRM нужна переписка с
  // клиентами, а не вся активность номера.
  if (!chatId || !chatId.endsWith('@c.us')) return null;

  const phoneDigits = digitsOf(chatId.split('@')[0]);
  const clientId = await findClientId(phoneDigits);

  let mediaPath = null; let mediaSize = null;
  if (media?.data) {
    try {
      const saved = await saveMedia(msg.id._serialized, phoneDigits, media);
      mediaPath = saved.rel;
      mediaSize = saved.size;
    } catch (e) {
      // Файл не сохранился — сообщение всё равно пишем: текст и факт вложения
      // важнее, чем сам файл, и без записи мы бы потеряли и то и другое.
      console.error('[WA][media] save failed:', e.message);
    }
  }

  await pool.query(
    `INSERT INTO whatsapp.messages
       (wa_id, company_id, client_id, chat_id, phone_digits, from_me, body,
        msg_type, media_path, media_name, media_mime, media_size, ack, sent_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, to_timestamp($14))
     ON CONFLICT (wa_id) DO NOTHING`,
    [
      msg.id._serialized, COMPANY_ID, clientId, chatId, phoneDigits,
      !!msg.fromMe, msg.body || '', msg.type || 'chat',
      mediaPath, media?.filename || null, media?.mimetype || null, mediaSize,
      typeof msg.ack === 'number' ? msg.ack : 0,
      msg.timestamp || Math.floor(Date.now() / 1000),
    ],
  );
  return { clientId, phoneDigits, mediaPath };
}

// Статус доставки приходит отдельным событием уже после самого сообщения.
export async function updateAck(waId, ack) {
  await pool.query(
    `UPDATE whatsapp.messages SET ack = $2 WHERE wa_id = $1`,
    [waId, ack],
  );
}

// Сохранение сообщений, собранных со страницы (монитор чтения).
//
// Формат отличается от событий библиотеки: со страницы приходят дата и время в
// локальном виде («15.09.2026», «10:44»), а не epoch, и нет отдельного объекта
// вложения — только признак его наличия. Поэтому отдельная функция, а не
// подгон scraped-данных под saveMessage.
function parseStamp(date, time) {
  // Дата бывает относительной: «Сегодня», «Вчера» или день недели.
  const now = new Date();
  let d = now;
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(date || '').trim());
  if (m) {
    d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  } else if (/вчера/i.test(date || '')) {
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  } else {
    d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const t = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (t) d.setHours(Number(t[1]), Number(t[2]), 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Записать собранные со страницы сообщения одного чата.
 * Идемпотентно по wa_id: повторный обход того же чата не плодит дубли.
 * Возвращает, сколько записей добавлено новых.
 */
export async function saveScraped(phoneDigits, items) {
  if (!COMPANY_ID || !items?.length) return { saved: 0, clientId: null };
  const clientId = await findClientId(phoneDigits);
  const chatId = `${phoneDigits}@c.us`;
  let saved = 0;

  for (const it of items) {
    if (!it.wa_id) continue;
    const r = await pool.query(
      `INSERT INTO whatsapp.messages
         (wa_id, company_id, client_id, chat_id, phone_digits, from_me, body,
          msg_type, media_path, media_name, media_mime, media_size, ack, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NULL,NULL,NULL,NULL,$9, to_timestamp($10))
       ON CONFLICT (wa_id) DO NOTHING`,
      [
        it.wa_id, COMPANY_ID, clientId, chatId, phoneDigits,
        !!it.from_me, it.body || '',
        it.has_media ? 'media' : 'chat',
        0, parseStamp(it.date, it.time),
      ],
    );
    saved += r.rowCount;
  }

  // Переписка часто появляется раньше карточки: клиент звонит, ему отвечают, и
  // только потом заводят в CRM. Поэтому на каждом проходе досвязываем те
  // сообщения, что были записаны без client_id.
  let linked = 0;
  if (clientId) {
    const u = await pool.query(
      `UPDATE whatsapp.messages SET client_id = $1
        WHERE company_id = $2 AND phone_digits = $3 AND client_id IS NULL`,
      [clientId, COMPANY_ID, phoneDigits],
    );
    linked = u.rowCount;
  }
  return { saved, linked, clientId };
}

// Подпись автора у только что отправленного сообщения.
//
// Автора нельзя проставить прямо в saveScraped: та читает чат со страницы и
// не отличает «мы отправили это секунду назад» от старой исходящей реплики —
// при первом чтении чата подпись получили бы все прошлые сообщения разом.
// Поэтому ищем по тексту среди свежих исходящих без автора.
export async function markAuthor(phoneDigits, body, author) {
  if (!COMPANY_ID || !author?.id || !body) return 0;
  const r = await pool.query(
    `UPDATE whatsapp.messages SET author_id = $1, author_name = $2
      WHERE wa_id = (
        SELECT wa_id FROM whatsapp.messages
         WHERE company_id = $3 AND phone_digits = $4
           AND from_me = TRUE AND author_id IS NULL AND body = $5
           -- Окно в 10 минут: если текст повторяется (а «Добрый день» шлют
           -- часто), без ограничения по времени подпись села бы на реплику
           -- прошлой недели.
           AND sent_at > NOW() - INTERVAL '10 minutes'
         ORDER BY created_at DESC LIMIT 1
      )`,
    [author.id, author.name || null, COMPANY_ID, phoneDigits, body],
  );
  return r.rowCount;
}

// Имя сотрудника для подписи. Читаем в момент отправки и кладём копией
// в сообщение: джойн к users потерял бы подпись после увольнения.
export async function authorName(userId) {
  if (!userId) return null;
  const r = await pool.query(
    `SELECT NULLIF(TRIM(full_name), '') AS name FROM users.users WHERE id = $1`,
    [userId],
  );
  return r.rows[0]?.name || null;
}

// Номера клиентов компании в виде цифр, пригодных для сравнения с WhatsApp.
// Нормализация та же, что в digitsOf: иначе «+7 (999)…» из карточки и
// «7999…» из заголовка чата никогда не совпадут. Возвращает Map из
// последних 10 цифр в {id, name, digits} — так сходятся записи с кодом
// страны и без него.
export async function clientPhoneIndex() {
  const out = new Map();
  if (!COMPANY_ID) return out;
  const r = await pool.query(
    `SELECT id, full_name,
            regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') AS digits
       FROM clients.clients
      WHERE company_id = $1
        AND is_deleted = FALSE
        AND coalesce(phone, '') <> ''`,
    [COMPANY_ID],
  );
  for (const row of r.rows) {
    // Российские номера в базе встречаются и с ведущей 8, и с 7.
    let d = row.digits;
    if (d.startsWith('8')) d = '7' + d.slice(1);
    if (d.length < 10) continue;
    // Ключ — последние 10 цифр: так сходятся записи с кодом страны и без.
    out.set(d.slice(-10), { id: row.id, name: row.full_name, digits: d });
  }
  return out;
}

// Диалог с клиентом. Файлы отдаются отдельным роутом по id сообщения, поэтому
// здесь только метаданные вложения.
export async function listByClient(clientId, limit = 200) {
  const r = await pool.query(
    `SELECT wa_id, from_me, body, msg_type, media_name, media_mime, media_size,
            (media_path IS NOT NULL) AS has_media, ack, sent_at, author_name
       FROM whatsapp.messages
      WHERE client_id = $1
      ORDER BY sent_at DESC, created_at DESC
      LIMIT $2`,
    [clientId, limit],
  );
  return r.rows.reverse(); // в карточке читаем сверху вниз, как в мессенджере
}

// Новые входящие для уведомлений. Запрос идёт в базу, а не в окно WhatsApp:
// его вызывает браузер каждого менеджера, и трогать единственный сеанс на
// каждый такой опрос нельзя.
export async function newIncoming(since, limit = 20) {
  const r = await pool.query(
    `SELECT m.wa_id, m.client_id, m.phone_digits, m.body, m.msg_type,
            (m.media_path IS NOT NULL) AS has_media, m.sent_at, m.created_at,
            c.full_name AS client_name
       FROM whatsapp.messages m
       LEFT JOIN clients.clients c ON c.id = m.client_id
      WHERE m.company_id = $1
        AND m.from_me = false
        AND m.created_at > $2
      ORDER BY m.created_at
      LIMIT $3`,
    [COMPANY_ID, since, limit],
  );
  return r.rows;
}

// Сколько непрочитанных всего — для счётчика в меню.
export async function unreadCount(since) {
  const r = await pool.query(
    `SELECT count(*)::int AS n FROM whatsapp.messages
      WHERE company_id = $1 AND from_me = false AND created_at > $2`,
    [COMPANY_ID, since],
  );
  return r.rows[0]?.n || 0;
}

// Переписки без карточки клиента. Это входящие с номеров, которых нет в базе:
// человек написал в WhatsApp, но клиентом ещё не заведён.
export async function unlinkedChats(limit = 50) {
  const r = await pool.query(
    `SELECT phone_digits,
            count(*)::int AS messages,
            max(sent_at) AS last_at,
            (array_agg(body ORDER BY created_at DESC))[1] AS last_body
       FROM whatsapp.messages
      WHERE company_id = $1 AND client_id IS NULL
      GROUP BY phone_digits
      ORDER BY max(sent_at) DESC
      LIMIT $2`,
    [COMPANY_ID, limit],
  );
  return r.rows;
}

// Список чатов для вкладки «WhatsApp» в разделе «Сообщения»: по одному
// диалогу на номер, свежие сверху. Прочтений WhatsApp Web нам не отдаёт,
// поэтому «ждут ответа» считаем сами: входящие после нашего последнего
// исходящего. Для администратора это и есть смысл непрочитанного — клиенту
// ещё никто не ответил.
export async function listChats(limit = 100) {
  const r = await pool.query(
    `WITH last_out AS (
       SELECT phone_digits, max(sent_at) AS at
         FROM whatsapp.messages
        WHERE company_id = $1 AND from_me = true
        GROUP BY phone_digits
     )
     SELECT m.phone_digits,
            -- Берём найденную по номеру карточку, а не только сохранённый
            -- client_id: у старых строк он пуст, и без этого клик по чату
            -- не открывал бы карточку существующего клиента.
            coalesce(max(c.id::text)::uuid, max(m.client_id::text)::uuid) AS client_id,
            c.full_name AS client_name,
            max(m.sent_at) AS last_at,
            (array_agg(m.body ORDER BY m.sent_at DESC, m.created_at DESC))[1] AS last_body,
            (array_agg(m.from_me ORDER BY m.sent_at DESC, m.created_at DESC))[1] AS last_from_me,
            (array_agg((m.media_path IS NOT NULL) ORDER BY m.sent_at DESC, m.created_at DESC))[1] AS last_has_media,
            count(*) FILTER (WHERE m.from_me = false AND (lo.at IS NULL OR m.sent_at > lo.at))::int AS waiting
       FROM whatsapp.messages m
       LEFT JOIN last_out lo ON lo.phone_digits = m.phone_digits
       -- Связь ищем ещё и по номеру, а не только по сохранённому client_id:
       -- строки, записанные до того, как у человека появилась карточка,
       -- иначе навсегда остались бы «неизвестным номером», хотя карточка
       -- уже есть. Так список сам подтягивает имя задним числом.
       LEFT JOIN LATERAL (
         SELECT cl.id, cl.full_name
           FROM clients.clients cl
          WHERE cl.company_id = $1
            AND cl.is_deleted = FALSE
            AND right(regexp_replace(coalesce(cl.phone, ''), '[^0-9]', '', 'g'), 10)
                = right(m.phone_digits, 10)
          ORDER BY cl.created_at
          LIMIT 1
       ) c ON TRUE
      WHERE m.company_id = $1
      GROUP BY m.phone_digits, c.full_name
      ORDER BY max(m.sent_at) DESC
      LIMIT $2`,
    [COMPANY_ID, limit],
  );
  return r.rows;
}

// Переписка по номеру — для чата во вкладке «WhatsApp». По номеру, а не по
// клиенту: новые номера ещё не привязаны к карточке, а писать им нужно.
export async function listByPhone(phoneDigits, limit = 200) {
  const r = await pool.query(
    `SELECT wa_id, from_me, body, msg_type, media_name, media_mime, media_size,
            (media_path IS NOT NULL) AS has_media, ack, sent_at, author_name, client_id
       FROM whatsapp.messages
      WHERE company_id = $1 AND phone_digits = $2
      ORDER BY sent_at DESC, created_at DESC
      LIMIT $3`,
    [COMPANY_ID, phoneDigits, limit],
  );
  return r.rows.reverse();
}

export async function mediaOf(waId) {
  const r = await pool.query(
    `SELECT media_path, media_name, media_mime FROM whatsapp.messages
      WHERE wa_id = $1 AND media_path IS NOT NULL`,
    [waId],
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

// Связывание задним числом: клиента завели уже после переписки.
export async function linkClientByPhone(clientId, phoneDigits) {
  const r = await pool.query(
    `UPDATE whatsapp.messages
        SET client_id = $1
      WHERE company_id = $2 AND phone_digits = $3 AND client_id IS NULL`,
    [clientId, COMPANY_ID, phoneDigits],
  );
  return r.rowCount;
}

/**
 * Привязать к карточкам всю переписку, где связь не проставлена.
 *
 * Зачем отдельно от findClientId: строки сохраняются в момент сообщения, и
 * если карточки тогда не было (или номер в ней записан через 8, а не 7),
 * client_id остался пустым навсегда. Человек заводит карточку позже, но
 * старая переписка так и висит «неизвестным номером».
 *
 * Сопоставление по последним 10 цифрам — то же правило, что везде.
 * Берём самую раннюю карточку: на ней история и деньги.
 *
 * Идемпотентна: трогает только строки с пустым client_id, поэтому её
 * безопасно звать при каждом старте сервиса.
 */
export async function linkKnownContacts() {
  if (!COMPANY_ID) return 0;
  const r = await pool.query(
    `UPDATE whatsapp.messages m
        SET client_id = c.id
       FROM LATERAL (
         SELECT cl.id
           FROM clients.clients cl
          WHERE cl.company_id = $1
            AND cl.is_deleted = FALSE
            AND right(regexp_replace(coalesce(cl.phone, ''), '[^0-9]', '', 'g'), 10)
                = right(m.phone_digits, 10)
          ORDER BY cl.created_at
          LIMIT 1
       ) c
      WHERE m.company_id = $1
        AND m.client_id IS NULL
        AND length(m.phone_digits) >= 10`,
    [COMPANY_ID],
  );
  return r.rowCount;
}
