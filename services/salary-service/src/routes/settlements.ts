import { Router } from 'express';
import { pool } from '../db';
import { authenticate } from '../middleware';

const router = Router();
router.use(authenticate);

// GET /api/salary/settlements?master_id= — баланс начислено vs выплачено по мастеру.
// Без master_id — таблица по всем мастерам.
router.get('/', async (req, res, next) => {
  try {
    const companyId = req.auth!.company_id;
    const masterId = typeof req.query.master_id === 'string' ? req.query.master_id : null;

    const params: unknown[] = [companyId];
    let where = `m.company_id = $1`;
    if (masterId) {
      params.push(masterId);
      where += ` AND m.id = $${params.length}`;
    }

    const { rows } = await pool.query(
      `SELECT m.id AS master_id,
              m.display_name AS master_name,
              m.specialization AS master_role,
              COALESCE(a.accrued, 0)::float8 AS accrued_total,
              COALESCE(p.paid, 0)::float8    AS paid_total,
              (COALESCE(a.accrued, 0) - COALESCE(p.paid, 0))::float8 AS balance
       FROM salons.masters m
       LEFT JOIN (
         SELECT master_id, SUM(amount) AS accrued
         FROM salary.accruals
         WHERE company_id = $1
         GROUP BY master_id
       ) a ON a.master_id = m.id
       LEFT JOIN (
         SELECT master_id, SUM(amount) AS paid
         FROM salary.payouts
         WHERE company_id = $1 AND status = 'posted'
         GROUP BY master_id
       ) p ON p.master_id = m.id
       WHERE ${where} AND m.is_active = TRUE
       ORDER BY balance DESC, master_name`,
      params,
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

export default router;
