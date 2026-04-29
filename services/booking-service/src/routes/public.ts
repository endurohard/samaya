import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { config } from '../config';
import { HttpError } from '../middleware';
import { loadServiceSnapshots, assertMaster } from '../services';

const router = Router();

const createSchema = z.object({
  company_id: z.string().uuid().optional(),
  master_id: z.string().uuid(),
  service_ids: z.array(z.string().uuid()).min(1),
  starts_at: z.string().datetime({ offset: true }),
  client_phone: z.string().min(5).max(50),
  client_name: z.string().min(1).max(200),
  notes: z.string().max(1000).optional(),
});

router.post('/create', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = createSchema.parse(req.body);
    const companyId = input.company_id ?? config.DEFAULT_COMPANY_ID;
    if (!companyId) throw new HttpError(400, 'company_id required (no default configured)');

    await client.query('BEGIN');
    await assertMaster(client, companyId, input.master_id);
    const services = await loadServiceSnapshots(client, companyId, input.service_ids);
    const totalDuration = services.reduce((acc, s) => acc + s.duration_minutes, 0);
    const totalPrice = services.reduce((acc, s) => acc + Number(s.price), 0);

    const startsAt = new Date(input.starts_at);
    const endsAt = new Date(startsAt.getTime() + totalDuration * 60_000);

    const ins = await client.query(
      `INSERT INTO bookings.bookings
         (company_id, master_id, client_phone, client_name,
          starts_at, ends_at, status, total_price, source, notes)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,'public_widget',$8)
       RETURNING id, starts_at, ends_at, status, total_price::float8 AS total_price`,
      [
        companyId, input.master_id,
        input.client_phone, input.client_name,
        startsAt.toISOString(), endsAt.toISOString(),
        totalPrice, input.notes ?? null,
      ],
    );
    const booking = ins.rows[0];

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

    await client.query(
      `INSERT INTO bookings.booking_events_outbox (event_type, booking_id, company_id, payload)
       VALUES ('booking.created', $1, $2, $3::jsonb)`,
      [booking.id, companyId, JSON.stringify({
        booking_id: booking.id,
        master_id: input.master_id,
        starts_at: booking.starts_at,
        ends_at: booking.ends_at,
        services: services.map((s) => ({ id: s.id, duration_minutes: s.duration_minutes })),
        source: 'public_widget',
      })],
    );

    await client.query('COMMIT');
    return res.status(201).json({
      booking_id: booking.id,
      status: booking.status,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      total_price: booking.total_price,
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

export default router;
