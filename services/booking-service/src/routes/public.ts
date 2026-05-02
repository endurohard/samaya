import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { config } from '../config';
import { HttpError } from '../middleware';
import { loadServiceSnapshots, assertMaster } from '../services';
import { sendMail, buildConfirmationEmail } from '../mailer';

const router = Router();

const createSchema = z.object({
  company_id: z.string().uuid().optional(),
  master_id: z.string().uuid(),
  service_ids: z.array(z.string().uuid()).min(1),
  starts_at: z.string().datetime({ offset: true }),
  client_phone: z.string().min(5).max(50),
  client_name: z.string().min(1).max(200),
  client_email: z.string().email().optional(),
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

    // Fire-and-forget: confirmation email to client + alert to admin
    setImmediate(async () => {
      try {
        const [masterRow, settingsRow] = await Promise.all([
          pool.query(`SELECT display_name FROM salons.masters WHERE id = $1`, [input.master_id]),
          pool.query(
            `SELECT u.email::text AS owner_email,
                    cp.settings_jsonb->'notifications'->>'email_reminder' AS email_remind
             FROM salons.company_profile cp
             JOIN users.users u ON u.company_id = cp.company_id AND u.role = 'owner'
             WHERE cp.company_id = $1
             LIMIT 1`,
            [companyId],
          ),
        ]);
        const masterName = masterRow.rows[0]?.display_name || 'мастер';
        const servicesList = services.map((s) => s.name).join(', ');

        // Confirmation to client
        if (input.client_email) {
          try {
            const { subject, html } = buildConfirmationEmail({
              clientName: input.client_name,
              masterName,
              services: servicesList,
              startsAt: booking.starts_at,
              totalPrice: booking.total_price,
            });
            await sendMail({ to: input.client_email, subject, html });
          } catch { /* ignore */ }
        }

        // New booking alert to owner (always if owner has email)
        const ownerEmail = settingsRow.rows[0]?.owner_email;
        if (ownerEmail) {
          try {
            const d = new Date(booking.starts_at).toLocaleString('ru-RU', {
              day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
              timeZone: 'Europe/Moscow',
            });
            await sendMail({
              to: ownerEmail,
              subject: `Новая запись: ${input.client_name}, ${d}`,
              html: `<p style="font-family:sans-serif">
                <b>Новая запись через виджет</b><br><br>
                Клиент: <b>${input.client_name}</b> (${input.client_phone})<br>
                Дата: <b>${d}</b><br>
                Мастер: <b>${masterName}</b><br>
                Услуги: ${servicesList}<br>
                Сумма: <b>${booking.total_price} ₽</b>
              </p>`,
            });
          } catch { /* ignore */ }
        }
      } catch { /* ignore */ }
    });

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

// ===== Review: get booking info (no auth, booking_id acts as token) =====
router.get('/review-info/:booking_id', async (req, res, next) => {
  try {
    const bookingId = req.params.booking_id;
    if (!/^[0-9a-f-]{36}$/.test(bookingId)) return res.status(400).json({ error: 'invalid id' });

    const { rows } = await pool.query(
      `SELECT b.id, b.status, b.starts_at, b.client_name,
              b.master_id,
              COALESCE(m.display_name, b.master_id::text) AS master_name,
              COALESCE(
                (SELECT json_agg(service_name ORDER BY sort_order, service_name)
                 FROM bookings.booking_services WHERE booking_id = b.id),
                '[]'::json
              ) AS services,
              EXISTS(SELECT 1 FROM bookings.reviews WHERE booking_id = b.id) AS already_reviewed
       FROM bookings.bookings b
       LEFT JOIN salons.masters m ON m.id = b.master_id
       WHERE b.id = $1`,
      [bookingId],
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found' });
    const b = rows[0];
    if (b.status !== 'completed') return res.status(409).json({ error: 'not_completed', status: b.status });
    return res.json(b);
  } catch (e) { return next(e); }
});

// ===== Review: submit (no auth) =====
const reviewSchema = z.object({
  booking_id: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().max(2000).optional(),
});

router.post('/review', async (req, res, next) => {
  try {
    const input = reviewSchema.parse(req.body);

    const { rows: bRows } = await pool.query(
      `SELECT b.id, b.company_id, b.client_id, b.client_name, b.master_id,
              COALESCE(m.display_name, b.master_id::text) AS master_name,
              b.status
       FROM bookings.bookings b
       LEFT JOIN salons.masters m ON m.id = b.master_id
       WHERE b.id = $1`,
      [input.booking_id],
    );
    if (!bRows[0]) return res.status(404).json({ error: 'not_found' });
    const b = bRows[0];
    if (b.status !== 'completed') return res.status(409).json({ error: 'not_completed' });

    const { rows } = await pool.query(
      `INSERT INTO bookings.reviews
         (booking_id, company_id, client_id, client_name, master_id, master_name, rating, comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (booking_id) DO NOTHING
       RETURNING id`,
      [
        b.id, b.company_id, b.client_id ?? null, b.client_name ?? null,
        b.master_id ?? null, b.master_name ?? null,
        input.rating, input.comment ?? null,
      ],
    );
    if (!rows[0]) return res.status(409).json({ error: 'already_reviewed' });
    return res.status(201).json({ ok: true, review_id: rows[0].id });
  } catch (e) { return next(e); }
});

export default router;
