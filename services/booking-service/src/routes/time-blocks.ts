import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { HttpError, requireRole } from '../middleware';
import { assertMaster, assertMasterActor } from '../services';

const router = Router();

// ===== Список блокировок за период =====
const listSchema = z.object({
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  master_id: z.string().uuid().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const params: unknown[] = [req.auth!.company_id];
    const where = ['company_id = $1'];
    if (q.from) { params.push(q.from); where.push(`ends_at > $${params.length}`); }
    if (q.to) { params.push(q.to); where.push(`starts_at < $${params.length}`); }
    if (q.master_id) { params.push(q.master_id); where.push(`master_id = $${params.length}`); }

    const { rows } = await pool.query(
      `SELECT id, master_id, starts_at, ends_at, reason, created_at
       FROM bookings.time_blocks
       WHERE ${where.join(' AND ')}
       ORDER BY starts_at ASC`,
      params,
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

// ===== Занять время =====
const createSchema = z.object({
  master_id: z.string().uuid(),
  starts_at: z.string().datetime({ offset: true }),
  ends_at: z.string().datetime({ offset: true }),
  reason: z.string().max(500).optional(),
});

router.post('/', requireRole(['owner', 'admin', 'master']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = createSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    const startsAt = new Date(input.starts_at);
    const endsAt = new Date(input.ends_at);
    if (endsAt <= startsAt) throw new HttpError(400, 'конец раньше начала', 'BAD_RANGE');

    await client.query('BEGIN');
    await assertMaster(client, companyId, input.master_id);
    // Мастер может занимать время только у себя — как и создавать записи.
    await assertMasterActor(client, companyId, req.auth!.role, req.auth!.sub, input.master_id);

    // Нельзя занять время поверх существующей записи клиента: он уже придёт.
    const busy = await client.query(
      `SELECT id, starts_at, ends_at FROM bookings.bookings
       WHERE company_id = $1 AND master_id = $2
         AND status IN ('pending', 'confirmed')
         AND tstzrange(starts_at, ends_at) && tstzrange($3::timestamptz, $4::timestamptz)
       LIMIT 1`,
      [companyId, input.master_id, startsAt.toISOString(), endsAt.toISOString()],
    );
    if (busy.rows[0]) {
      throw new HttpError(409, 'на это время уже есть запись клиента', 'BOOKING_EXISTS');
    }

    const ins = await client.query(
      `INSERT INTO bookings.time_blocks
         (company_id, master_id, starts_at, ends_at, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id, master_id, starts_at, ends_at, reason, created_at`,
      [
        companyId, input.master_id,
        startsAt.toISOString(), endsAt.toISOString(),
        input.reason ?? null, req.auth!.sub,
      ],
    );
    await client.query('COMMIT');
    return res.status(201).json(ins.rows[0]);
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => { /* соединение уже мертво */ });
    // 23P01 — EXCLUDE-констрейнт: блокировка пересекается с уже существующей.
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23P01') {
      return next(new HttpError(409, 'это время уже занято', 'ALREADY_BLOCKED'));
    }
    return next(e);
  } finally {
    client.release();
  }
});

// ===== Освободить время =====
router.delete('/:id', requireRole(['owner', 'admin', 'master']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const companyId = req.auth!.company_id;
    await client.query('BEGIN');
    const found = await client.query(
      `SELECT master_id FROM bookings.time_blocks WHERE company_id = $1 AND id = $2`,
      [companyId, req.params.id],
    );
    if (!found.rows[0]) throw new HttpError(404, 'блокировка не найдена');
    await assertMasterActor(client, companyId, req.auth!.role, req.auth!.sub, found.rows[0].master_id);

    await client.query(
      `DELETE FROM bookings.time_blocks WHERE company_id = $1 AND id = $2`,
      [companyId, req.params.id],
    );
    await client.query('COMMIT');
    return res.status(204).end();
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { /* соединение уже мертво */ });
    return next(e);
  } finally {
    client.release();
  }
});

export default router;
