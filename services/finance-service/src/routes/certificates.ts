import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '../validators';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();

function genCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = 'GIFT-';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

// GET /api/finance/certificates  — list
router.get('/', authenticate, async (req, res, next) => {
  try {
    const status = (req.query.status as string | undefined) || 'active';
    const search = (req.query.search as string | undefined) || '';
    const params: unknown[] = [req.auth!.company_id];
    let where = 'company_id = $1';
    if (status !== 'all') { params.push(status); where += ` AND status = $${params.length}`; }
    if (search) { params.push(`%${search}%`); where += ` AND (code ILIKE $${params.length} OR client_name ILIKE $${params.length})`; }
    const { rows } = await pool.query(
      `SELECT id, code, amount::float8, balance::float8, client_name, client_id,
              sold_at, expires_at, status, notes, created_at
       FROM finance.gift_certificates
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT 200`,
      params,
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

// GET /api/finance/certificates/check?code=GIFT-XXXX  — check balance (for sale modal)
router.get('/check', authenticate, async (req, res, next) => {
  try {
    const code = (req.query.code as string | undefined)?.trim().toUpperCase();
    if (!code) return res.status(400).json({ error: 'code required' });
    const { rows } = await pool.query(
      `SELECT id, code, amount::float8, balance::float8, client_name, expires_at, status
       FROM finance.gift_certificates
       WHERE company_id = $1 AND code = $2`,
      [req.auth!.company_id, code],
    );
    if (!rows[0]) return res.status(404).json({ error: 'not_found', message: 'Сертификат не найден' });
    const cert = rows[0];
    if (cert.status === 'cancelled') return res.status(409).json({ error: 'cancelled', message: 'Сертификат аннулирован' });
    if (cert.status === 'used') return res.status(409).json({ error: 'used', message: 'Баланс сертификата равен нулю' });
    if (cert.status === 'expired' || (cert.expires_at && new Date(cert.expires_at) < new Date()))
      return res.status(409).json({ error: 'expired', message: 'Сертификат истёк' });
    return res.json(cert);
  } catch (e) { return next(e); }
});

// POST /api/finance/certificates  — sell a new certificate
const createSchema = z.object({
  amount: z.number().min(100).max(1_000_000),
  client_id: z.string().uuid().nullable().optional(),
  client_name: z.string().max(200).nullable().optional(),
  expires_at: isoDate().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

router.post('/', authenticate, requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const companyId = req.auth!.company_id;

    // Generate unique code (retry up to 5 times on collision)
    let code = '';
    for (let attempt = 0; attempt < 5; attempt++) {
      code = genCode();
      const exists = await pool.query(
        `SELECT 1 FROM finance.gift_certificates WHERE company_id = $1 AND code = $2`,
        [companyId, code],
      );
      if (!exists.rows[0]) break;
    }
    if (!code) throw new HttpError(500, 'Failed to generate unique code');

    const clientName = input.client_name?.trim() || null;
    // If client_id provided, resolve name
    let resolvedName = clientName;
    if (input.client_id && !resolvedName) {
      const cr = await pool.query(
        `SELECT full_name FROM clients.clients WHERE id = $1`,
        [input.client_id],
      );
      resolvedName = cr.rows[0]?.full_name || null;
    }

    const { rows } = await pool.query(
      `INSERT INTO finance.gift_certificates
         (company_id, code, amount, balance, client_id, client_name, sold_by, expires_at, notes)
       VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8)
       RETURNING id, code, amount::float8, balance::float8, client_name, expires_at, status, created_at`,
      [
        companyId, code, input.amount,
        input.client_id ?? null, resolvedName,
        req.auth!.sub,
        input.expires_at ?? null,
        input.notes ?? null,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e) { return next(e); }
});

// POST /api/finance/certificates/:id/redeem  — deduct from balance
const redeemSchema = z.object({
  amount: z.number().min(0.01),
  booking_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

router.post('/:id/redeem', authenticate, requireRole(['owner', 'admin', 'master']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = redeemSchema.parse(req.body);
    await client.query('BEGIN');

    const cert = await client.query(
      `SELECT id, balance::float8, status, expires_at
       FROM finance.gift_certificates
       WHERE company_id = $1 AND id = $2
       FOR UPDATE`,
      [req.auth!.company_id, req.params.id],
    );
    if (!cert.rows[0]) { await client.query('ROLLBACK'); return next(new HttpError(404, 'certificate not found')); }
    const c = cert.rows[0];
    if (c.status !== 'active') { await client.query('ROLLBACK'); return next(new HttpError(409, `certificate status: ${c.status}`, 'INVALID_STATUS')); }
    if (c.expires_at && new Date(c.expires_at) < new Date()) {
      await client.query(`UPDATE finance.gift_certificates SET status='expired' WHERE id=$1`, [c.id]);
      await client.query('COMMIT');
      return next(new HttpError(409, 'certificate expired', 'EXPIRED'));
    }
    const spend = Math.min(input.amount, c.balance);
    const newBalance = Math.round((c.balance - spend) * 100) / 100;
    const newStatus = newBalance === 0 ? 'used' : 'active';

    await client.query(
      `UPDATE finance.gift_certificates SET balance=$1, status=$2 WHERE id=$3`,
      [newBalance, newStatus, c.id],
    );
    await client.query(
      `INSERT INTO finance.cert_usages (certificate_id, booking_id, amount_used, used_by, notes)
       VALUES ($1,$2,$3,$4,$5)`,
      [c.id, input.booking_id ?? null, spend, req.auth!.sub, input.notes ?? null],
    );
    await client.query('COMMIT');
    return res.json({ amount_used: spend, new_balance: newBalance, status: newStatus });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

// PATCH /api/finance/certificates/:id/cancel
router.patch('/:id/cancel', authenticate, requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `UPDATE finance.gift_certificates SET status='cancelled'
       WHERE company_id=$1 AND id=$2 AND status='active'`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rowCount) return next(new HttpError(404, 'certificate not found or not cancellable'));
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default router;
