import { pool } from './db';
import { config } from './config';
import { HttpError } from './middleware';

// Палитра DIKIDI-like для аватаров клиентов (используется при создании,
// если не задан avatar_color явно).
const AVATAR_COLORS = [
  '#7c3aed', '#3b82f6', '#0ea5e9', '#06b6d4', '#10b981',
  '#84cc16', '#eab308', '#f59e0b', '#f97316', '#ef4444',
  '#ec4899', '#a855f7',
];

export function pickAvatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// Нормализуем телефон до цифр + ведущий + если он есть.
// '+7 (928) 188-98-54' → '+79281889854'
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

export type Segment =
  | 'all' | 'regular' | 'sleeping' | 'missing' | 'never' | 'new' | 'blocked' | 'deleted';

export interface ClientListItem {
  id: string;
  phone: string;
  full_name: string;
  birthday: string | null;
  gender: string | null;
  email: string | null;
  comment: string | null;
  source: string;
  avatar_color: string;
  bonus_balance: string;
  is_blocked: boolean;
  is_deleted: boolean;
  created_at: string;
  // Сводные показатели из bookings.bookings, считаются на лету
  total_visits: number;
  last_visit_at: string | null;
  total_paid: string;
  avg_check: string;
  segment: Exclude<Segment, 'all'>;
}

// CTE: считаем агрегаты по bookings.bookings для каждого клиента (по client_id ИЛИ
// по нормализованному phone — пока в bookings phone хранится «как есть»). Для MVP
// связываем по точному совпадению phone.
//
// Сегмент определяется по правилам:
//   blocked  — is_blocked = TRUE
//   deleted  — is_deleted = TRUE
//   never    — total_visits = 0
//   regular  — visits_in_regular_window >= CLIENT_REGULAR_VISITS
//   missing  — last_visit_at < NOW() - CLIENT_MISSING_DAYS
//   sleeping — last_visit_at < NOW() - CLIENT_SLEEPING_DAYS
//   new      — created_at >= NOW() - CLIENT_NEW_PERIOD_DAYS
//   иначе    — sleeping (fallback, бывает при visits=1 в окне)
//
// «new» имеет приоритет над sleeping/regular когда явно фильтруем по нему;
// в total для каждого клиента segment рассчитывается раз и используется как для
// возврата в списке, так и для счётчиков.
const STATS_CTE = `
  WITH stats AS (
    SELECT
      c.id AS client_id,
      COALESCE(s.total_visits, 0) AS total_visits,
      s.last_visit_at,
      COALESCE(s.total_paid, 0) AS total_paid,
      COALESCE(s.visits_in_regular_window, 0) AS visits_in_regular_window
    FROM clients.clients c
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS total_visits,
        MAX(b.starts_at) AS last_visit_at,
        SUM(b.total_price)::numeric AS total_paid,
        COUNT(*) FILTER (WHERE b.starts_at >= NOW() - CAST($1 AS interval))::int
          AS visits_in_regular_window
      FROM bookings.bookings b
      WHERE b.company_id = c.company_id
        AND b.status IN ('confirmed', 'completed')
        AND (
          b.client_id = c.id
          OR (b.client_id IS NULL AND b.client_phone = c.phone::text)
        )
    ) s ON TRUE
  )
`;

const SEGMENT_EXPR = `
  CASE
    WHEN c.is_deleted THEN 'deleted'
    WHEN c.is_blocked THEN 'blocked'
    WHEN s.total_visits = 0 AND c.created_at >= NOW() - CAST($4 AS interval) THEN 'new'
    WHEN s.total_visits = 0 THEN 'never'
    WHEN s.visits_in_regular_window >= $5::int THEN 'regular'
    WHEN s.last_visit_at < NOW() - CAST($3 AS interval) THEN 'missing'
    WHEN s.last_visit_at < NOW() - CAST($2 AS interval) THEN 'sleeping'
    WHEN c.created_at >= NOW() - CAST($4 AS interval) THEN 'new'
    ELSE 'regular'
  END
`;
// Параметры:
//   $1 = REGULAR_DAYS (окно подсчёта visits_in_regular_window — обычно совпадает со sleeping_days)
//   $2 = SLEEPING_DAYS
//   $3 = MISSING_DAYS
//   $4 = NEW_PERIOD_DAYS
//   $5 = REGULAR_VISITS

interface ListParams {
  companyId: string;
  segment: Segment;
  search?: string;
  limit: number;
  offset: number;
}

// Преобразуем number → 'N days' для подстановки как interval-параметра.
const days = (n: number) => `${n} days`;

export async function listClients(p: ListParams) {
  const baseParams: unknown[] = [
    days(config.CLIENT_REGULAR_DAYS),
    days(config.CLIENT_SLEEPING_DAYS),
    days(config.CLIENT_MISSING_DAYS),
    days(config.CLIENT_NEW_PERIOD_DAYS),
    config.CLIENT_REGULAR_VISITS,
    p.companyId,
  ];
  const where: string[] = [`c.company_id = $6`];
  const params: unknown[] = [...baseParams];

  // По умолчанию скрываем удалённых, если не запрошен явный сегмент 'deleted'/'all'
  if (p.segment !== 'deleted' && p.segment !== 'all') {
    where.push(`c.is_deleted = FALSE`);
  }
  if (p.segment !== 'all' && p.segment !== 'deleted') {
    where.push(`(${SEGMENT_EXPR}) = $${params.length + 1}`);
    params.push(p.segment);
  } else if (p.segment === 'deleted') {
    where.push(`c.is_deleted = TRUE`);
  }

  if (p.search && p.search.trim()) {
    const q = `%${p.search.trim().replace(/[%_]/g, (m) => '\\' + m)}%`;
    where.push(`(c.full_name ILIKE $${params.length + 1} OR c.phone::text ILIKE $${params.length + 1})`);
    params.push(q);
  }

  params.push(p.limit, p.offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const sql = `
    ${STATS_CTE}
    SELECT
      c.id, c.phone::text AS phone, c.full_name, c.birthday, c.gender, c.email::text AS email,
      c.comment, c.source, c.avatar_color, c.bonus_balance,
      c.balance::float8 AS balance, c.is_blocked, c.is_deleted,
      c.created_at,
      s.total_visits,
      s.last_visit_at,
      s.total_paid,
      CASE WHEN s.total_visits > 0 THEN s.total_paid / s.total_visits ELSE 0 END AS avg_check,
      ${SEGMENT_EXPR} AS segment
    FROM clients.clients c
    JOIN stats s ON s.client_id = c.id
    WHERE ${where.join(' AND ')}
    ORDER BY c.full_name ASC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  // В count-запросе при segment=all параметры $2..$5 могут не использоваться явно —
  // Postgres тогда не выводит их типы и падает на Parse. Добавляем тривиальное no-op
  // условие, чтобы каждый параметр получил контекст типа.
  const countSql = `
    ${STATS_CTE}
    SELECT COUNT(*)::int AS cnt
    FROM clients.clients c
    JOIN stats s ON s.client_id = c.id
    WHERE ${where.join(' AND ')}
      AND (${SEGMENT_EXPR}) IS NOT NULL
  `;
  // count не использует limit/offset
  const countParams = params.slice(0, params.length - 2);

  const [rows, total] = await Promise.all([
    pool.query(sql, params),
    pool.query(countSql, countParams),
  ]);

  return {
    items: rows.rows as ClientListItem[],
    total: total.rows[0].cnt as number,
  };
}

export async function segmentCounts(companyId: string) {
  const sql = `
    ${STATS_CTE}
    SELECT
      ${SEGMENT_EXPR} AS segment,
      COUNT(*) FILTER (WHERE c.is_deleted = FALSE)::int AS cnt
    FROM clients.clients c
    JOIN stats s ON s.client_id = c.id
    WHERE c.company_id = $6
    GROUP BY 1
  `;
  const params: unknown[] = [
    days(config.CLIENT_REGULAR_DAYS),
    days(config.CLIENT_SLEEPING_DAYS),
    days(config.CLIENT_MISSING_DAYS),
    days(config.CLIENT_NEW_PERIOD_DAYS),
    config.CLIENT_REGULAR_VISITS,
    companyId,
  ];

  const [segs, deleted, total] = await Promise.all([
    pool.query(sql, params),
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM clients.clients WHERE company_id = $1 AND is_deleted = TRUE`,
      [companyId],
    ),
    pool.query(
      `SELECT COUNT(*)::int AS cnt FROM clients.clients WHERE company_id = $1 AND is_deleted = FALSE`,
      [companyId],
    ),
  ]);

  const counts: Record<string, number> = {
    all: total.rows[0].cnt,
    regular: 0, sleeping: 0, missing: 0, never: 0, new: 0, blocked: 0,
    deleted: deleted.rows[0].cnt,
  };
  for (const r of segs.rows) {
    counts[r.segment as string] = r.cnt;
  }
  return counts;
}

export interface CreateClientInput {
  company_id: string;
  phone: string;
  full_name: string;
  birthday?: string | null;
  gender?: 'male' | 'female' | null;
  email?: string | null;
  comment?: string | null;
  source?: string;
}

export async function createClient(input: CreateClientInput) {
  const phone = normalizePhone(input.phone);
  if (phone.replace(/\D/g, '').length < 10) {
    throw new HttpError(400, 'invalid_phone', 'phone must contain at least 10 digits');
  }
  const color = pickAvatarColor(phone);
  try {
    const r = await pool.query(
      `INSERT INTO clients.clients
         (company_id, phone, full_name, birthday, gender, email, comment, source, avatar_color)
       VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8, 'admin'), $9)
       RETURNING id`,
      [
        input.company_id, phone, input.full_name.trim(),
        input.birthday ?? null, input.gender ?? null, input.email ?? null,
        input.comment ?? null, input.source ?? null, color,
      ],
    );
    return r.rows[0].id as string;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HttpError(409, 'phone_exists', 'client with such phone already exists');
    }
    throw err;
  }
}

export interface UpdateClientInput {
  full_name?: string;
  phone?: string;
  birthday?: string | null;
  gender?: 'male' | 'female' | null;
  email?: string | null;
  comment?: string | null;
  is_blocked?: boolean;
  bonus_balance?: number;
}

export async function updateClient(companyId: string, id: string, patch: UpdateClientInput) {
  const fields: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => {
    params.push(val);
    fields.push(`${col} = $${params.length}`);
  };
  if (patch.full_name !== undefined) push('full_name', patch.full_name.trim());
  if (patch.phone !== undefined) push('phone', normalizePhone(patch.phone));
  if (patch.birthday !== undefined) push('birthday', patch.birthday);
  if (patch.gender !== undefined) push('gender', patch.gender);
  if (patch.email !== undefined) push('email', patch.email);
  if (patch.comment !== undefined) push('comment', patch.comment);
  if (patch.is_blocked !== undefined) push('is_blocked', patch.is_blocked);
  if (patch.bonus_balance !== undefined) push('bonus_balance', patch.bonus_balance);

  if (!fields.length) return;
  params.push(companyId, id);
  try {
    const r = await pool.query(
      `UPDATE clients.clients SET ${fields.join(', ')}
       WHERE company_id = $${params.length - 1} AND id = $${params.length}`,
      params,
    );
    if (r.rowCount === 0) throw new HttpError(404, 'not_found');
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new HttpError(409, 'phone_exists');
    }
    throw err;
  }
}

export async function softDelete(companyId: string, id: string) {
  const r = await pool.query(
    `UPDATE clients.clients SET is_deleted = TRUE WHERE company_id = $1 AND id = $2`,
    [companyId, id],
  );
  if (r.rowCount === 0) throw new HttpError(404, 'not_found');
}

export async function restore(companyId: string, id: string) {
  const r = await pool.query(
    `UPDATE clients.clients SET is_deleted = FALSE WHERE company_id = $1 AND id = $2`,
    [companyId, id],
  );
  if (r.rowCount === 0) throw new HttpError(404, 'not_found');
}

export async function getClient(companyId: string, id: string) {
  const r = await pool.query(
    `${STATS_CTE}
     SELECT
       c.id, c.phone::text AS phone, c.full_name, c.birthday, c.gender, c.email::text AS email,
       c.comment, c.source, c.avatar_color, c.bonus_balance,
       c.balance::float8 AS balance, c.is_blocked, c.is_deleted,
       c.upload_token, c.created_at,
       s.total_visits, s.last_visit_at, s.total_paid,
       CASE WHEN s.total_visits > 0 THEN s.total_paid / s.total_visits ELSE 0 END AS avg_check,
       ${SEGMENT_EXPR} AS segment
     FROM clients.clients c
     JOIN stats s ON s.client_id = c.id
     WHERE c.company_id = $6 AND c.id = $7`,
    [
      days(config.CLIENT_REGULAR_DAYS), days(config.CLIENT_SLEEPING_DAYS),
      days(config.CLIENT_MISSING_DAYS), days(config.CLIENT_NEW_PERIOD_DAYS),
      config.CLIENT_REGULAR_VISITS, companyId, id,
    ],
  );
  if (!r.rows[0]) throw new HttpError(404, 'not_found');
  return r.rows[0] as ClientListItem;
}
