import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';
import { loadServiceSnapshots, assertMaster } from '../services';

const router = Router();
router.use(authenticate);

// ===== List bookings =====
const listSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  master_id: z.string().uuid().optional(),
  status: z.enum(['pending', 'confirmed', 'completed', 'canceled', 'no_show']).optional(),
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
    if (q.status) {
      params.push(q.status);
      where += ` AND status = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT b.id, b.master_id, b.client_id, b.client_phone, b.client_name,
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
       ORDER BY b.starts_at`,
      params,
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

// ===== Get one =====
router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT b.*, b.total_price::float8 AS total_price,
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
          starts_at, ends_at, status, total_price, source, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'confirmed',$8,'admin',$9)
       RETURNING *, total_price::float8 AS total_price`,
      [
        companyId, input.master_id,
        input.client_id ?? null,
        input.client_phone ?? null,
        input.client_name ?? null,
        startsAt.toISOString(), endsAt.toISOString(),
        totalPrice,
        input.notes ?? null,
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

// ===== Complete =====
router.post('/:id/complete', requireRole(['owner', 'admin', 'master']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE bookings.bookings
       SET status = 'completed', completed_at = NOW()
       WHERE company_id = $1 AND id = $2 AND status IN ('confirmed', 'pending')
       RETURNING *, total_price::float8 AS total_price`,
      [req.auth!.company_id, req.params.id],
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
