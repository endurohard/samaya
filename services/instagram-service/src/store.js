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

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || '';

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
export function messageKey(threadId, item) {
  const h = crypto.createHash('sha1');
  h.update(`${threadId}|${item.from_me ? 1 : 0}|${item.stamp || ''}|${item.body || ''}`);
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
       unread     = EXCLUDED.unread,
       last_at    = GREATEST(COALESCE(EXCLUDED.last_at, instagram.threads.last_at),
                             COALESCE(instagram.threads.last_at, EXCLUDED.last_at)),
       last_body  = COALESCE(EXCLUDED.last_body, instagram.threads.last_body),
       updated_at = NOW()
     RETURNING client_id`,
    [
      t.thread_id, COMPANY_ID, t.username || null, t.full_name || null,
      t.avatar || null, Number(t.unread) || 0,
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
export async function saveMessages(threadId, items, clientId) {
  if (!COMPANY_ID || !items?.length) return { saved: 0 };
  let saved = 0;
  for (const it of items) {
    const igId = messageKey(threadId, it);
    const type = it.has_media ? (it.media_kind === 'voice' ? 'voice' : 'media') : 'text';
    const r = await pool.query(
      `INSERT INTO instagram.messages
         (ig_id, company_id, thread_id, client_id, from_me, body, msg_type, sent_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (ig_id) DO NOTHING`,
      [
        igId, COMPANY_ID, threadId, clientId || null,
        !!it.from_me, it.body || '', type, parseStamp(it.stamp),
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
export async function listThreads(limit = 100) {
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
