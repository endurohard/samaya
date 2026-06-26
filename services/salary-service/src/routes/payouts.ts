import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '../validators';
import { pool } from '../db';
import { config } from '../config';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const masterId = typeof req.query.master_id === 'string' ? req.query.master_id : null;
    const params: unknown[] = [req.auth!.company_id];
    let where = `company_id = $1`;
    if (masterId) {
      params.push(masterId);
      where += ` AND master_id = $${params.length}`;
    }
    const { rows } = await pool.query(
      `SELECT id, master_id, amount::float8 AS amount, paid_on,
              finance_operation_id, status, failure_reason, note,
              created_by_user_id, created_at, posted_at
       FROM salary.payouts
       WHERE ${where}
       ORDER BY paid_on DESC, created_at DESC
       LIMIT 200`,
      params,
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  master_id: z.string().uuid(),
  amount: z.number().positive(),
  paid_on: isoDate(),
  account_id: z.string().uuid(),    // counter в finance.accounts
  note: z.string().max(500).optional(),
});

// Saga: insert pending payout → call finance to create expense → update with operation_id.
// На любом сбое payout остаётся pending — можно повторить.
router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  let payoutId: string | null = null;
  const client = await pool.connect();
  try {
    const input = createSchema.parse(req.body);
    await client.query('BEGIN');

    // 1. master must exist
    const m = await client.query(
      `SELECT display_name AS name FROM salons.masters
       WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, input.master_id],
    );
    if (!m.rows[0]) throw new HttpError(404, 'master not found');
    const masterName: string = m.rows[0].name;

    // 2. insert pending payout
    const { rows } = await client.query(
      `INSERT INTO salary.payouts
         (company_id, master_id, amount, paid_on, status, note, created_by_user_id)
       VALUES ($1, $2, $3, $4, 'pending', $5, $6)
       RETURNING id`,
      [
        req.auth!.company_id, input.master_id, input.amount, input.paid_on,
        input.note ?? null, req.auth!.sub,
      ],
    );
    payoutId = rows[0].id;
    await client.query('COMMIT');

    // 3. call finance-service (forwarding user JWT)
    const token = (req.headers.authorization || '').slice(7);
    const r = await fetch(`${config.FINANCE_SERVICE_URL}/api/finance/operations/expense`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        account_id: input.account_id,
        amount: input.amount,
        op_date: input.paid_on,
        note: `Зарплата · ${masterName}` + (input.note ? ` · ${input.note}` : ''),
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      await pool.query(
        `UPDATE salary.payouts SET status = 'failed', failure_reason = $1
         WHERE id = $2 AND company_id = $3`,
        [`finance ${r.status}: ${errText.slice(0, 200)}`, payoutId, req.auth!.company_id],
      );
      // Детали — в failure_reason (БД); наружу только статус, как в /retry ниже.
      throw new HttpError(502, `finance-service ${r.status}`, 'FINANCE_FAIL');
    }
    const fin = (await r.json()) as { id: string };

    // 4. mark posted
    const final = await pool.query(
      `UPDATE salary.payouts SET status = 'posted', posted_at = NOW(),
                                 finance_operation_id = $1
       WHERE id = $2 AND company_id = $3
       RETURNING id, master_id, amount::float8 AS amount, paid_on,
                 finance_operation_id, status, posted_at`,
      [fin.id, payoutId, req.auth!.company_id],
    );
    return res.status(201).json(final.rows[0]);
  } catch (e) {
    // если не успели COMMIT — откатимся
    try { await client.query('ROLLBACK'); } catch { /* noop */ }
    return next(e);
  } finally {
    client.release();
  }
});

// Retry pending/failed payout: пере-вызываем finance с тем же payout id.
const retrySchema = z.object({
  account_id: z.string().uuid(),
});

router.post('/:id/retry', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = retrySchema.parse(req.body);
    const { rows } = await pool.query(
      `SELECT id, master_id, amount::float8 AS amount, paid_on, status, note
       FROM salary.payouts
       WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    const p = rows[0];
    if (!p) return next(new HttpError(404, 'payout not found'));
    if (p.status === 'posted') return next(new HttpError(409, 'already posted', 'POSTED'));

    const m = await pool.query(
      `SELECT display_name AS name FROM salons.masters
       WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, p.master_id],
    );
    const masterName: string = m.rows[0]?.name ?? 'мастер';

    const token = (req.headers.authorization || '').slice(7);
    const r = await fetch(`${config.FINANCE_SERVICE_URL}/api/finance/operations/expense`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        account_id: input.account_id,
        amount: p.amount,
        op_date: p.paid_on,
        note: `Зарплата · ${masterName}` + (p.note ? ` · ${p.note}` : ''),
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      await pool.query(
        `UPDATE salary.payouts SET failure_reason = $1
         WHERE id = $2 AND company_id = $3`,
        [`finance ${r.status}: ${errText.slice(0, 200)}`, p.id, req.auth!.company_id],
      );
      return next(new HttpError(502, `finance-service ${r.status}`, 'FINANCE_FAIL'));
    }
    const fin = (await r.json()) as { id: string };

    const final = await pool.query(
      `UPDATE salary.payouts SET status = 'posted', posted_at = NOW(),
                                 finance_operation_id = $1, failure_reason = NULL
       WHERE id = $2 AND company_id = $3
       RETURNING id, master_id, amount::float8 AS amount, paid_on,
                 finance_operation_id, status, posted_at`,
      [fin.id, p.id, req.auth!.company_id],
    );
    return res.json(final.rows[0]);
  } catch (e) { return next(e); }
});

export default router;
