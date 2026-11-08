// Комментарии к постам Instagram: приём, хранение, ответы.
//
// Два источника, потому что ни один не надёжен в одиночку:
//  * вебхук Meta (поле comments) — мгновенно, но только если приложение на
//    него подписано и связь до сервера жива (7 ноября она пропадала на
//    три часа);
//  * обход последних постов раз в несколько минут — догоняет пропущенное.
// Повтор безопасен: ключ — id комментария.
//
// Ответить можно двумя способами:
//  * публично — ответ под комментарием (POST /<id>/replies);
//  * приватно — ОДНО сообщение автору в директ (recipient.comment_id),
//    Meta разрешает его в течение 7 дней после комментария. Дальше, если
//    человек ответил, это обычный диалог директа.
import { pool } from './store.js';
import { graphCall, credentials } from './graph.js';

const COMPANY_ID = process.env.DEFAULT_COMPANY_ID || '';
// Свежие комментарии приходят и под старыми постами: за 2 дня — под 27 разными.
const POSTS_TO_SYNC = Number(process.env.INSTAGRAM_COMMENTS_POSTS || 30);
const PER_POST_LIMIT = Number(process.env.INSTAGRAM_COMMENTS_PER_POST || 200);
const PRIVATE_REPLY_DAYS = 7;

let ownUsername = null;
async function myUsername() {
  if (ownUsername) return ownUsername;
  const c = await credentials().catch(() => null);
  ownUsername = (c?.username || '').toLowerCase() || null;
  return ownUsername;
}

/** Сохранить комментарий. Статус обработки при повторе не трогаем. */
export async function upsertComment(c) {
  if (!COMPANY_ID || !c?.comment_id || !c.media_id) return 0;
  const me = await myUsername();
  const fromMe = !!c.from_me || (!!me && (c.username || '').toLowerCase() === me);
  const r = await pool.query(
    `INSERT INTO instagram.comments
       (company_id, comment_id, media_id, parent_id, from_id, username, body, from_me, hidden, commented_at, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $8 THEN 'done' ELSE 'new' END)
     ON CONFLICT (company_id, comment_id) DO UPDATE SET
       body = EXCLUDED.body,
       username = COALESCE(EXCLUDED.username, instagram.comments.username),
       from_id = COALESCE(EXCLUDED.from_id, instagram.comments.from_id),
       hidden = EXCLUDED.hidden,
       updated_at = NOW()
     RETURNING (xmax = 0) AS inserted`,
    [COMPANY_ID, String(c.comment_id), String(c.media_id), c.parent_id ? String(c.parent_id) : null,
      c.from_id ? String(c.from_id) : null, c.username || null, String(c.text || ''), fromMe, !!c.hidden,
      c.timestamp ? new Date(c.timestamp) : new Date()],
  );
  // Наш ответ в ветке (в том числе написанный прямо в Instagram) закрывает
  // комментарий клиента: в «Новых» он больше не нужен.
  if (fromMe && c.parent_id) {
    await pool.query(
      `UPDATE instagram.comments SET status = CASE WHEN status = 'new' THEN 'done' ELSE status END,
              replied_at = COALESCE(replied_at, $3), updated_at = NOW()
        WHERE company_id = $1 AND comment_id = $2 AND NOT from_me`,
      [COMPANY_ID, String(c.parent_id), c.timestamp ? new Date(c.timestamp) : new Date()],
    ).catch(() => {});
  }
  return r.rows[0]?.inserted ? 1 : 0;
}

/**
 * Разбор вебхука: entry[].changes[] с field = 'comments'.
 * value: { id, text, from: { id, username }, media: { id }, parent_id? }
 */
export function parseCommentChanges(body) {
  const out = [];
  for (const e of body?.entry ?? []) {
    for (const ch of e.changes ?? []) {
      if (ch.field !== 'comments' || !ch.value) continue;
      const v = ch.value;
      out.push({
        comment_id: v.id, text: v.text, media_id: v.media?.id,
        parent_id: v.parent_id || null, from_id: v.from?.id, username: v.from?.username,
        timestamp: e.time ? new Date(Number(e.time) * 1000) : new Date(),
      });
    }
  }
  return out;
}

const FIELDS = 'id,text,timestamp,username,from,hidden,parent_id';

/** Обойти последние посты и сохранить их комментарии вместе с ответами. */
export async function syncRecentComments({ posts = POSTS_TO_SYNC } = {}) {
  const res = { ok: true, posts: 0, comments: 0, inserted: 0, errors: [] };
  const media = await graphCall('GET', 'me/media', {
    query: { fields: 'id,caption,permalink,timestamp,comments_count,media_type,thumbnail_url', limit: String(posts) },
  });
  if (!media.ok) return { ...res, ok: false, errors: [media.error] };
  for (const m of media.data?.data ?? []) {
    res.posts++;
    await pool.query(
      `INSERT INTO instagram.media (company_id, media_id, caption, permalink, media_type, thumbnail_url, posted_at, comments_count, synced_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (company_id, media_id) DO UPDATE SET caption = EXCLUDED.caption, permalink = EXCLUDED.permalink,
         comments_count = EXCLUDED.comments_count, thumbnail_url = EXCLUDED.thumbnail_url, synced_at = NOW()`,
      [COMPANY_ID, m.id, m.caption || null, m.permalink || null, m.media_type || null, m.thumbnail_url || null,
        m.timestamp ? new Date(m.timestamp) : null, m.comments_count ?? null],
    ).catch(e => res.errors.push(`пост ${m.id}: ${e.message}`));
    if (!m.comments_count) continue;
    let after = null; let fetched = 0;
    do {
      const q = { fields: `${FIELDS},replies{${FIELDS}}`, limit: '50' };
      if (after) q.after = after;
      const r = await graphCall('GET', `${m.id}/comments`, { query: q });
      if (!r.ok) { res.errors.push(`комментарии ${m.id}: ${r.error}`); break; }
      for (const c of r.data?.data ?? []) {
        const rows = [c, ...(c.replies?.data ?? []).map(x => ({ ...x, parent_id: x.parent_id || c.id }))];
        for (const x of rows) {
          res.comments++;
          res.inserted += await upsertComment({
            comment_id: x.id, media_id: m.id, parent_id: x.parent_id || null, text: x.text,
            username: x.username || x.from?.username, from_id: x.from?.id, hidden: x.hidden, timestamp: x.timestamp,
          });
        }
        fetched++;
      }
      after = r.data?.paging?.next ? r.data?.paging?.cursors?.after : null;
    } while (after && fetched < PER_POST_LIMIT);
  }
  return res;
}

/** Список для CRM: комментарии клиентов с постом и нашими ответами. */
export async function listComments({ status = 'new', limit = 100, before = null } = {}) {
  const params = [COMPANY_ID, Math.min(Number(limit) || 100, 300)];
  let where = 'c.company_id = $1 AND NOT c.from_me';
  if (status && status !== 'all') { params.push(status); where += ` AND c.status = $${params.length}`; }
  if (before) { params.push(new Date(before)); where += ` AND c.commented_at < $${params.length}`; }
  const { rows } = await pool.query(
    `SELECT c.comment_id, c.media_id, c.parent_id, c.username, c.body, c.hidden, c.commented_at, c.status,
            c.replied_at, c.private_sent_at, c.handled_by,
            m.caption, m.permalink, m.thumbnail_url,
            (c.commented_at > NOW() - interval '${PRIVATE_REPLY_DAYS} days' AND c.private_sent_at IS NULL) AS can_private,
            COALESCE((SELECT json_agg(json_build_object('body', r.body, 'at', r.commented_at, 'by', r.handled_by) ORDER BY r.commented_at)
                        FROM instagram.comments r
                       WHERE r.company_id = c.company_id AND r.parent_id = c.comment_id AND r.from_me), '[]') AS our_replies
       FROM instagram.comments c
       LEFT JOIN instagram.media m ON m.company_id = c.company_id AND m.media_id = c.media_id
      WHERE ${where}
      ORDER BY c.commented_at DESC
      LIMIT $2`,
    params,
  );
  const counts = await pool.query(
    `SELECT status, count(*)::int n FROM instagram.comments WHERE company_id = $1 AND NOT from_me GROUP BY status`, [COMPANY_ID]);
  return { items: rows, counts: Object.fromEntries(counts.rows.map(r => [r.status, r.n])) };
}

async function getComment(id) {
  const { rows } = await pool.query(
    'SELECT * FROM instagram.comments WHERE company_id = $1 AND comment_id = $2', [COMPANY_ID, String(id)]);
  return rows[0] || null;
}

/** Публичный ответ под комментарием. */
export async function replyPublic(id, text, who) {
  const c = await getComment(id);
  if (!c) return { ok: false, error: 'комментарий не найден' };
  const msg = String(text || '').trim().slice(0, 2000);
  if (!msg) return { ok: false, error: 'пустой ответ' };
  // Ответ на ответ Instagram не поддерживает — отвечаем в ветку родителя.
  const target = c.parent_id || c.comment_id;
  const r = await graphCall('POST', `${target}/replies`, { query: { message: msg } });
  if (!r.ok) return r;
  await upsertComment({ comment_id: r.data?.id || `local-${Date.now()}`, media_id: c.media_id, parent_id: target,
    text: msg, from_me: true, timestamp: new Date() });
  await pool.query(
    `UPDATE instagram.comments SET handled_by = $3 WHERE company_id = $1 AND comment_id = $2 AND from_me`,
    [COMPANY_ID, r.data?.id || '', who || null]).catch(() => {});
  await pool.query(
    `UPDATE instagram.comments SET replied_at = NOW(), status = 'done', handled_by = COALESCE($3, handled_by), updated_at = NOW()
      WHERE company_id = $1 AND comment_id = $2`, [COMPANY_ID, c.comment_id, who || null]);
  return { ok: true, id: r.data?.id || null };
}

/** Приватный ответ автору в директ — один раз, в течение 7 дней. */
export async function replyPrivate(id, text, who) {
  const c = await getComment(id);
  if (!c) return { ok: false, error: 'комментарий не найден' };
  if (c.private_sent_at) return { ok: false, error: 'в директ по этому комментарию уже писали — Instagram разрешает только одно сообщение' };
  if (Date.now() - new Date(c.commented_at).getTime() > PRIVATE_REPLY_DAYS * 86400_000) {
    return { ok: false, error: 'прошло больше 7 дней с комментария — Instagram не даст написать в директ' };
  }
  const msg = String(text || '').trim().slice(0, 1000);
  if (!msg) return { ok: false, error: 'пустое сообщение' };
  const r = await graphCall('POST', 'me/messages', {
    body: { recipient: { comment_id: c.comment_id }, message: { text: msg } },
  });
  if (!r.ok) return r;
  await pool.query(
    `UPDATE instagram.comments SET private_sent_at = NOW(), status = 'done', handled_by = COALESCE($3, handled_by), updated_at = NOW()
      WHERE company_id = $1 AND comment_id = $2`, [COMPANY_ID, c.comment_id, who || null]);
  return { ok: true, message_id: r.data?.message_id || null, recipient_id: r.data?.recipient_id || null };
}

/** Скрыть или показать комментарий. */
export async function setHidden(id, hide, who) {
  const c = await getComment(id);
  if (!c) return { ok: false, error: 'комментарий не найден' };
  const r = await graphCall('POST', c.comment_id, { query: { hide: hide ? 'true' : 'false' } });
  if (!r.ok) return r;
  await pool.query(
    `UPDATE instagram.comments SET hidden = $3, status = CASE WHEN $3 THEN 'done' ELSE status END,
            handled_by = COALESCE($4, handled_by), updated_at = NOW()
      WHERE company_id = $1 AND comment_id = $2`, [COMPANY_ID, c.comment_id, !!hide, who || null]);
  return { ok: true };
}

/** Отметить без ответа: «обработан» или «не требует ответа». */
export async function setStatus(id, status, who) {
  if (!['new', 'done', 'ignored'].includes(status)) return { ok: false, error: 'неизвестный статус' };
  const r = await pool.query(
    `UPDATE instagram.comments SET status = $3, handled_by = COALESCE($4, handled_by), updated_at = NOW()
      WHERE company_id = $1 AND comment_id = $2`, [COMPANY_ID, String(id), status, who || null]);
  return r.rowCount ? { ok: true } : { ok: false, error: 'комментарий не найден' };
}
