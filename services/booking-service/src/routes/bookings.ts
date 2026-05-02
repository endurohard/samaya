import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';
import { loadServiceSnapshots, assertMaster } from '../services';
import { config } from '../config';
import { sendMail, buildReviewEmail } from '../mailer';

const router = Router();
router.use(authenticate);

// ===== List bookings =====
const listSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  master_id: z.string().uuid().optional(),
  client_phone: z.string().min(5).optional(),
  client_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'confirmed', 'completed', 'canceled', 'no_show']).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const params: unknown[] = [req.auth!.company_id, q.from, q.to];
    let where = `company_id = $1
      AND starts_at >= $2::date
      AND starts_at < ($3::date + INTERVAL '1 day')`;
    if (q.master_id) {
      params.push(q.master_id);
      where += ` AND master_id = $${params.length}`;
    }
    if (q.client_phone) {
      params.push(q.client_phone);
      where += ` AND client_phone = $${params.length}`;
    }
    if (q.client_id) {
      params.push(q.client_id);
      where += ` AND client_id = $${params.length}`;
    }
    if (q.status) {
      params.push(q.status);
      where += ` AND status = $${params.length}`;
    }
    const limitClause = q.limit ? ` LIMIT ${q.limit}` : '';

    const { rows } = await pool.query(
      `SELECT b.id, b.master_id, b.manager_id, b.client_id, b.client_phone, b.client_name,
              b.starts_at, b.ends_at, b.status, b.notes, b.total_price::float8 AS total_price,
              b.source, b.created_at, b.updated_at, b.canceled_at, b.completed_at,
              COALESCE(
                (SELECT json_agg(json_build_object(
                    'service_id', bs.service_id,
                    'service_name', bs.service_name,
                    'price', bs.price::float8,
                    'duration_minutes', bs.duration_minutes
                  ) ORDER BY bs.sort_order, bs.service_name)
                  FROM bookings.booking_services bs WHERE bs.booking_id = b.id),
                '[]'::json
              ) AS services
       FROM bookings.bookings b
       WHERE ${where}
       ORDER BY b.starts_at${limitClause}`,
      params,
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

// ===== Sales list (completed bookings) =====
const salesListSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  master_id: z.string().uuid().optional(),
  payment_method: z.enum(['cash', 'card', 'online']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

router.get('/sales', async (req, res, next) => {
  try {
    const q = salesListSchema.parse(req.query);
    const params: unknown[] = [req.auth!.company_id];
    let where = `b.company_id = $1 AND b.status = 'completed'`;
    if (q.from) { params.push(q.from); where += ` AND b.completed_at >= $${params.length}::date`; }
    if (q.to)   { params.push(q.to);   where += ` AND b.completed_at <  ($${params.length}::date + INTERVAL '1 day')`; }
    if (q.master_id) { params.push(q.master_id); where += ` AND b.master_id = $${params.length}`; }
    if (q.payment_method) { params.push(q.payment_method); where += ` AND b.payment_method = $${params.length}`; }
    params.push(q.limit);

    const { rows } = await pool.query(
      `SELECT b.id, b.master_id, b.client_id, b.client_name, b.client_phone,
              b.starts_at, b.ends_at, b.completed_at,
              b.total_price::float8 AS total_price,
              b.discount_pct::float8 AS discount_pct,
              b.discount_amount::float8 AS discount_amount,
              (b.total_price - b.discount_amount)::float8 AS paid_amount,
              b.payment_method, b.notes,
              COALESCE(
                (SELECT json_agg(json_build_object(
                    'service_name', bs.service_name,
                    'price', bs.price::float8
                  ) ORDER BY bs.sort_order)
                 FROM bookings.booking_services bs WHERE bs.booking_id = b.id),
                '[]'::json
              ) AS services
       FROM bookings.bookings b
       WHERE ${where}
       ORDER BY b.completed_at DESC
       LIMIT $${params.length}`,
      params,
    );

    const totals = rows.reduce(
      (acc, r) => ({ revenue: acc.revenue + r.paid_amount, count: acc.count + 1 }),
      { revenue: 0, count: 0 },
    );

    return res.json({ items: rows, totals });
  } catch (e) { return next(e); }
});

// ===== Analytics =====
const analyticsSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

router.get('/analytics', async (req, res, next) => {
  try {
    const q = analyticsSchema.parse(req.query);
    const companyId = req.auth!.company_id;

    const [kpiRes, byDayRes, byMasterRes, byServiceRes] = await Promise.all([
      // Overall KPIs
      pool.query(
        `SELECT
           COUNT(*) FILTER (WHERE status = 'completed') AS sales_count,
           COALESCE(SUM(total_price - discount_amount) FILTER (WHERE status = 'completed'), 0)::float8 AS revenue,
           COUNT(*) FILTER (WHERE status IN ('pending','confirmed')) AS active_count,
           COUNT(*) FILTER (WHERE status = 'canceled') AS canceled_count,
           COUNT(*) FILTER (WHERE status = 'no_show') AS no_show_count
         FROM bookings.bookings
         WHERE company_id = $1 AND starts_at::date BETWEEN $2::date AND $3::date`,
        [companyId, q.from, q.to],
      ),
      // Revenue by day
      pool.query(
        `SELECT starts_at::date AS day,
                COUNT(*) FILTER (WHERE status = 'completed') AS sales,
                COALESCE(SUM(total_price - discount_amount) FILTER (WHERE status = 'completed'), 0)::float8 AS revenue
         FROM bookings.bookings
         WHERE company_id = $1 AND starts_at::date BETWEEN $2::date AND $3::date
         GROUP BY day ORDER BY day`,
        [companyId, q.from, q.to],
      ),
      // Revenue by master
      pool.query(
        `SELECT b.master_id,
                COUNT(*) FILTER (WHERE b.status = 'completed') AS sales,
                COALESCE(SUM(b.total_price - b.discount_amount) FILTER (WHERE b.status = 'completed'), 0)::float8 AS revenue
         FROM bookings.bookings b
         WHERE b.company_id = $1 AND b.starts_at::date BETWEEN $2::date AND $3::date
         GROUP BY b.master_id
         ORDER BY revenue DESC LIMIT 20`,
        [companyId, q.from, q.to],
      ),
      // Top services
      pool.query(
        `SELECT bs.service_name,
                COUNT(*) AS bookings_count,
                COALESCE(SUM(bs.price), 0)::float8 AS revenue
         FROM bookings.booking_services bs
         JOIN bookings.bookings b ON b.id = bs.booking_id
         WHERE b.company_id = $1
           AND b.starts_at::date BETWEEN $2::date AND $3::date
           AND b.status = 'completed'
         GROUP BY bs.service_name
         ORDER BY revenue DESC LIMIT 10`,
        [companyId, q.from, q.to],
      ),
    ]);

    return res.json({
      kpi: kpiRes.rows[0],
      by_day: byDayRes.rows,
      by_master: byMasterRes.rows,
      top_services: byServiceRes.rows,
    });
  } catch (e) { return next(e); }
});

// ===== Retention analytics =====
router.get('/retention', async (req, res, next) => {
  try {
    const companyId = req.auth!.company_id;

    const summaryRes = await pool.query(
      `WITH combined AS (
         SELECT client_id, client_phone, client_name,
                COUNT(*) AS visits,
                MAX(completed_at) AS last_visit
         FROM bookings.bookings
         WHERE company_id = $1
           AND status = 'completed'
           AND (client_id IS NOT NULL OR client_phone IS NOT NULL)
         GROUP BY client_id, client_phone, client_name
       )
       SELECT
         COUNT(*)                                                                         AS total,
         COUNT(*) FILTER (WHERE visits = 1)                                              AS one_time,
         COUNT(*) FILTER (WHERE visits BETWEEN 2 AND 3)                                 AS two_three,
         COUNT(*) FILTER (WHERE visits >= 4)                                             AS loyal,
         COUNT(*) FILTER (WHERE last_visit < NOW() - INTERVAL '30 days')               AS at_risk_30,
         COUNT(*) FILTER (WHERE last_visit < NOW() - INTERVAL '60 days')               AS at_risk_60,
         COUNT(*) FILTER (WHERE last_visit < NOW() - INTERVAL '90 days')               AS at_risk_90,
         ROUND(AVG(visits)::numeric, 1)                                                  AS avg_visits,
         ROUND(
           COUNT(*) FILTER (WHERE visits > 1)::numeric / NULLIF(COUNT(*), 0) * 100, 1
         )                                                                                AS return_rate
       FROM combined`,
      [companyId],
    );

    const atRiskRes = await pool.query(
      `WITH combined AS (
         SELECT client_id, client_phone, client_name,
                COUNT(*) AS visits,
                MAX(completed_at) AS last_visit
         FROM bookings.bookings
         WHERE company_id = $1
           AND status = 'completed'
           AND (client_id IS NOT NULL OR client_phone IS NOT NULL)
         GROUP BY client_id, client_phone, client_name
       )
       SELECT client_id, client_phone, client_name,
              visits::int,
              last_visit,
              EXTRACT(DAYS FROM NOW() - last_visit)::int AS days_since
       FROM combined
       WHERE last_visit < NOW() - INTERVAL '30 days'
       ORDER BY last_visit ASC
       LIMIT 30`,
      [companyId],
    );

    return res.json({
      summary: summaryRes.rows[0],
      at_risk: atRiskRes.rows,
    });
  } catch (e) { return next(e); }
});

// ===== Master report =====
router.get('/analytics/masters', async (req, res, next) => {
  try {
    const q = analyticsSchema.parse(req.query);
    const companyId = req.auth!.company_id;

    const [mastersRes, servicesRes] = await Promise.all([
      pool.query(
        `SELECT
           b.master_id,
           m.display_name                                                              AS master_name,
           COUNT(*) FILTER (WHERE b.status = 'completed')::int                        AS visits,
           COUNT(*) FILTER (WHERE b.status = 'no_show')::int                          AS no_shows,
           COUNT(*) FILTER (WHERE b.status = 'canceled')::int                         AS cancels,
           COALESCE(SUM(b.total_price - b.discount_amount)
             FILTER (WHERE b.status = 'completed'), 0)::float8                        AS revenue,
           CASE WHEN COUNT(*) FILTER (WHERE b.status = 'completed') > 0
             THEN ROUND((SUM(b.total_price - b.discount_amount)
               FILTER (WHERE b.status = 'completed') /
               COUNT(*) FILTER (WHERE b.status = 'completed'))::numeric, 0)::float8
             ELSE 0 END                                                                AS avg_check,
           COUNT(DISTINCT b.client_id) FILTER (WHERE b.status = 'completed')::int     AS unique_clients,
           ROUND(AVG(r.rating)::numeric, 1)::float8                                   AS avg_rating,
           COUNT(r.id)::int                                                            AS review_count
         FROM bookings.bookings b
         LEFT JOIN salons.masters m ON m.id = b.master_id
         LEFT JOIN bookings.reviews r ON r.booking_id = b.id
         WHERE b.company_id = $1
           AND b.starts_at::date BETWEEN $2::date AND $3::date
         GROUP BY b.master_id, m.display_name
         ORDER BY revenue DESC`,
        [companyId, q.from, q.to],
      ),
      // Per-master service breakdown
      pool.query(
        `SELECT
           b.master_id,
           bs.service_name,
           COUNT(*)::int                         AS count,
           COALESCE(SUM(bs.price), 0)::float8   AS revenue
         FROM bookings.booking_services bs
         JOIN bookings.bookings b ON b.id = bs.booking_id
         WHERE b.company_id = $1
           AND b.starts_at::date BETWEEN $2::date AND $3::date
           AND b.status = 'completed'
         GROUP BY b.master_id, bs.service_name
         ORDER BY b.master_id, revenue DESC`,
        [companyId, q.from, q.to],
      ),
    ]);

    // Attach services to each master row
    const servicesByMaster: Record<string, typeof servicesRes.rows> = {};
    for (const s of servicesRes.rows) {
      if (!servicesByMaster[s.master_id]) servicesByMaster[s.master_id] = [];
      servicesByMaster[s.master_id].push(s);
    }
    const masters = mastersRes.rows.map((m) => ({
      ...m,
      services: servicesByMaster[m.master_id] ?? [],
    }));

    return res.json({ masters });
  } catch (e) { return next(e); }
});

// ===== Reviews list =====
router.get('/reviews', async (req, res, next) => {
  try {
    const companyId = req.auth!.company_id;
    const masterId = req.query.master_id as string | undefined;
    const rating = req.query.rating ? Number(req.query.rating) : undefined;
    const params: unknown[] = [companyId];
    let where = 'company_id = $1';
    if (masterId) { params.push(masterId); where += ` AND master_id = $${params.length}`; }
    if (rating) { params.push(rating); where += ` AND rating = $${params.length}`; }
    const { rows } = await pool.query(
      `SELECT id, booking_id, client_name, master_name, rating, comment,
              reply, replied_at, is_public, created_at
       FROM bookings.reviews WHERE ${where}
       ORDER BY created_at DESC LIMIT 200`,
      params,
    );
    const { rows: stats } = await pool.query(
      `SELECT COUNT(*)::int AS total,
              ROUND(AVG(rating)::numeric, 1)::float8 AS avg_rating,
              COUNT(*) FILTER (WHERE rating = 5)::int AS five_star,
              COUNT(*) FILTER (WHERE rating = 4)::int AS four_star,
              COUNT(*) FILTER (WHERE rating = 3)::int AS three_star,
              COUNT(*) FILTER (WHERE rating <= 2)::int AS low_star
       FROM bookings.reviews WHERE company_id = $1`,
      [companyId],
    );
    return res.json({ items: rows, stats: stats[0] });
  } catch (e) { return next(e); }
});

// ===== Reply to review =====
const replySchema = z.object({ reply: z.string().max(1000) });

router.patch('/reviews/:id/reply', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = replySchema.parse(req.body);
    const { rowCount } = await pool.query(
      `UPDATE bookings.reviews
       SET reply = $1, replied_at = NOW()
       WHERE company_id = $2 AND id = $3`,
      [input.reply.trim(), req.auth!.company_id, req.params.id],
    );
    if (!rowCount) return next(new HttpError(404, 'review not found'));
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

// ===== Get one =====
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.id, b.master_id, b.manager_id, b.client_id, b.client_phone, b.client_name,
              b.starts_at, b.ends_at, b.status, b.notes, b.source,
              b.created_at, b.updated_at, b.canceled_at, b.completed_at, b.cancel_reason,
              b.total_price::float8 AS total_price,
              COALESCE(
                (SELECT json_agg(json_build_object(
                    'service_id', bs.service_id,
                    'service_name', bs.service_name,
                    'price', bs.price::float8,
                    'duration_minutes', bs.duration_minutes
                  ) ORDER BY bs.sort_order)
                  FROM bookings.booking_services bs WHERE bs.booking_id = b.id),
                '[]'::json
              ) AS services
       FROM bookings.bookings b
       WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'booking not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

// ===== Create (admin/master) =====
const createSchema = z.object({
  master_id: z.string().uuid(),
  service_ids: z.array(z.string().uuid()).min(1),
  starts_at: z.string().datetime({ offset: true }),
  client_phone: z.string().min(5).optional(),
  client_name: z.string().max(200).optional(),
  client_id: z.string().uuid().optional(),
  notes: z.string().max(2000).optional(),
  manager_id: z.string().uuid().nullable().optional(),
}).refine((d) => d.client_phone || d.client_id, {
  message: 'client_phone or client_id required',
});

router.post('/', requireRole(['owner', 'admin', 'master']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = createSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    await client.query('BEGIN');

    await assertMaster(client, companyId, input.master_id);
    const services = await loadServiceSnapshots(client, companyId, input.service_ids);
    const totalDuration = services.reduce((acc, s) => acc + s.duration_minutes, 0);
    const totalPrice = services.reduce((acc, s) => acc + Number(s.price), 0);

    const startsAt = new Date(input.starts_at);
    const endsAt = new Date(startsAt.getTime() + totalDuration * 60_000);

    const ins = await client.query(
      `INSERT INTO bookings.bookings
         (company_id, master_id, client_id, client_phone, client_name,
          starts_at, ends_at, status, total_price, source, notes, manager_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,'admin',$9,$10)
       RETURNING *, total_price::float8 AS total_price`,
      [
        companyId, input.master_id,
        input.client_id ?? null,
        input.client_phone ?? null,
        input.client_name ?? null,
        startsAt.toISOString(), endsAt.toISOString(),
        totalPrice,
        input.notes ?? null,
        input.manager_id ?? null,
      ],
    );
    const booking = ins.rows[0];

    // Snapshot услуг
    const svcValues: string[] = [];
    const svcParams: unknown[] = [];
    services.forEach((s, i) => {
      const base = i * 5;
      svcValues.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
      svcParams.push(booking.id, s.id, s.name, s.price, s.duration_minutes);
    });
    await client.query(
      `INSERT INTO bookings.booking_services
         (booking_id, service_id, service_name, price, duration_minutes)
       VALUES ${svcValues.join(', ')}`,
      svcParams,
    );

    // Outbox event (в той же транзакции — at-least-once)
    await client.query(
      `INSERT INTO bookings.booking_events_outbox (event_type, booking_id, company_id, payload)
       VALUES ('booking.created', $1, $2, $3::jsonb)`,
      [booking.id, companyId, JSON.stringify({
        booking_id: booking.id,
        master_id: input.master_id,
        starts_at: booking.starts_at,
        ends_at: booking.ends_at,
        services: services.map((s) => ({ id: s.id, duration_minutes: s.duration_minutes })),
        source: 'admin',
      })],
    );

    await client.query('COMMIT');
    return res.status(201).json({
      ...booking,
      services: services.map((s) => ({
        service_id: s.id, service_name: s.name,
        price: s.price, duration_minutes: s.duration_minutes,
      })),
    });
  } catch (e: unknown) {
    await client.query('ROLLBACK');
    if ((e as { code?: string }).code === '23P01') {
      return next(new HttpError(409, 'time slot already taken', 'SLOT_TAKEN'));
    }
    return next(e);
  } finally {
    client.release();
  }
});

// ===== Update notes/status =====
const patchSchema = z.object({
  notes: z.string().max(2000).optional(),
  status: z.enum(['pending', 'confirmed']).optional(),
});

router.patch('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = patchSchema.parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [req.auth!.company_id, req.params.id];
    if (input.notes !== undefined) {
      values.push(input.notes);
      fields.push(`notes = $${values.length}`);
    }
    if (input.status !== undefined) {
      values.push(input.status);
      fields.push(`status = $${values.length}`);
    }
    if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
    const { rows } = await pool.query(
      `UPDATE bookings.bookings SET ${fields.join(', ')}
       WHERE company_id = $1 AND id = $2 RETURNING *, total_price::float8 AS total_price`,
      values,
    );
    if (!rows[0]) return next(new HttpError(404, 'booking not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

// ===== Cancel =====
const cancelSchema = z.object({
  cancel_reason: z.string().max(500).optional(),
});

router.post('/:id/cancel', requireRole(['owner', 'admin', 'master']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = cancelSchema.parse(req.body ?? {});
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE bookings.bookings
       SET status = 'canceled', canceled_at = NOW(), cancel_reason = $3
       WHERE company_id = $1 AND id = $2 AND status IN ('pending', 'confirmed')
       RETURNING *, total_price::float8 AS total_price`,
      [req.auth!.company_id, req.params.id, input.cancel_reason ?? null],
    );
    if (!upd.rows[0]) {
      await client.query('ROLLBACK');
      return next(new HttpError(404, 'booking not found or not cancellable'));
    }
    await client.query(
      `INSERT INTO bookings.booking_events_outbox (event_type, booking_id, company_id, payload)
       VALUES ('booking.canceled', $1, $2, $3::jsonb)`,
      [upd.rows[0].id, req.auth!.company_id, JSON.stringify({
        booking_id: upd.rows[0].id,
        canceled_by: req.auth!.sub,
        cancel_reason: input.cancel_reason ?? null,
      })],
    );
    await client.query('COMMIT');
    return res.json(upd.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

// ===== Complete (оформить продажу) =====
const completeSchema = z.object({
  payment_method: z.enum(['cash', 'card', 'online']).default('cash'),
  discount_pct: z.number().min(0).max(100).default(0),
  promo_code: z.string().optional(),
  bonus_spend: z.number().min(0).default(0),
  bonus_accrual: z.number().min(0).default(0),
});

router.post('/:id/complete', requireRole(['owner', 'admin', 'master']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = completeSchema.parse(req.body ?? {});
    await client.query('BEGIN');

    let promoId: string | null = null;
    let discountPct = input.discount_pct;
    if (input.promo_code) {
      const today = new Date().toISOString().slice(0, 10);
      const pr = await client.query(
        `SELECT id, discount_pct::float8 FROM bookings.promotions
         WHERE company_id = $1 AND code = $2 AND is_active = TRUE
           AND (valid_from IS NULL OR valid_from <= $3)
           AND (valid_to   IS NULL OR valid_to   >= $3)
           AND (max_uses   IS NULL OR used_count < max_uses)
         FOR UPDATE`,
        [req.auth!.company_id, input.promo_code.toUpperCase(), today],
      );
      if (pr.rows[0]) {
        promoId = pr.rows[0].id;
        discountPct = Math.max(discountPct, pr.rows[0].discount_pct);
        await client.query(
          `UPDATE bookings.promotions SET used_count = used_count + 1 WHERE id = $1`,
          [promoId],
        );
      }
    }

    const upd = await client.query(
      `UPDATE bookings.bookings
       SET status = 'completed', completed_at = NOW(),
           payment_method = $3,
           discount_pct = $4,
           discount_amount = ROUND(total_price * $4 / 100, 2),
           promo_id = $5,
           promo_code = $6,
           bonus_spend   = $7,
           bonus_accrual = $8
       WHERE company_id = $1 AND id = $2 AND status IN ('confirmed', 'pending')
       RETURNING *,
         total_price::float8 AS total_price,
         discount_amount::float8 AS discount_amount,
         bonus_spend::float8   AS bonus_spend,
         bonus_accrual::float8 AS bonus_accrual,
         (total_price - discount_amount - bonus_spend)::float8 AS paid_amount`,
      [
        req.auth!.company_id, req.params.id, input.payment_method, discountPct,
        promoId, input.promo_code?.toUpperCase() ?? null,
        input.bonus_spend, input.bonus_accrual,
      ],
    );
    if (!upd.rows[0]) {
      await client.query('ROLLBACK');
      return next(new HttpError(404, 'booking not found or not completable'));
    }
    await client.query(
      `INSERT INTO bookings.booking_events_outbox (event_type, booking_id, company_id, payload)
       VALUES ('booking.completed', $1, $2, $3::jsonb)`,
      [upd.rows[0].id, req.auth!.company_id, JSON.stringify({
        booking_id: upd.rows[0].id,
        completed_by: req.auth!.sub,
        payment_method: input.payment_method,
        discount_pct: discountPct,
        promo_code: input.promo_code ?? null,
      })],
    );
    await client.query('COMMIT');
    const booking = upd.rows[0];
    // Fire-and-forget review request via WA + email
    setImmediate(async () => {
      try {
        const [settingsRow, masterRow, clientRow] = await Promise.all([
          pool.query(`SELECT settings_jsonb FROM salons.company_profile WHERE company_id = $1`, [booking.company_id]),
          pool.query(`SELECT display_name FROM salons.masters WHERE id = $1`, [booking.master_id]),
          booking.client_id
            ? pool.query(`SELECT email::text AS email FROM clients.clients WHERE id = $1`, [booking.client_id])
            : Promise.resolve({ rows: [] }),
        ]);
        const notif = settingsRow.rows[0]?.settings_jsonb?.notifications ?? {};
        const masterName = masterRow.rows[0]?.display_name || 'мастер';
        const clientEmail = clientRow.rows[0]?.email || null;

        if (notif.wa_reminder && booking.client_phone) {
          try {
            const reviewUrl = `${config.FRONTEND_URL}/review.html?b=${booking.id}`;
            await fetch(`${config.WHATSAPP_SERVICE_URL}/api/whatsapp/send`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                phone: booking.client_phone,
                message: `Спасибо за визит! Будем рады вашему отзыву: ${reviewUrl}`,
              }),
            });
          } catch { /* ignore */ }
        }
        if (notif.email_reminder && clientEmail) {
          try {
            const { subject, html } = buildReviewEmail({
              clientName: booking.client_name || 'клиент',
              masterName,
              bookingId: booking.id,
              frontendUrl: config.FRONTEND_URL,
            });
            await sendMail({ to: clientEmail, subject, html });
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    });
    return res.json(booking);
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

// ===== Mark no_show =====
router.post('/:id/no-show', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `UPDATE bookings.bookings
       SET status = 'no_show'
       WHERE company_id = $1 AND id = $2 AND status IN ('confirmed', 'pending')
       RETURNING *, total_price::float8 AS total_price`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rows[0]) return next(new HttpError(404, 'booking not found'));
    return res.json(rows[0]);
  } catch (e) { return next(e); }
});

export default router;
