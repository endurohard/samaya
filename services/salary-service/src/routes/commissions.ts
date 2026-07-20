import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '../validators';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

// GET /api/salary/commissions — список правил комиссий
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT sc.id, sc.company_id, sc.service_id, sc.category_id, sc.staff_group_id,
              sc.commission_type, sc.amount::float8 AS amount,
              sc.effective_from, sc.effective_to, sc.notes, sc.created_at,
              s.name AS service_name,
              c.name AS category_name,
              g.name AS staff_group_name
       FROM salary.service_commissions sc
       LEFT JOIN salons.services s ON s.id = sc.service_id
       LEFT JOIN salons.service_categories c ON c.id = sc.category_id
       LEFT JOIN salary.staff_groups g ON g.id = sc.staff_group_id
       WHERE sc.company_id = $1
       ORDER BY s.name NULLS FIRST, c.name NULLS FIRST, sc.effective_from DESC`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  service_id: z.string().uuid().nullable().optional(),
  // Правило на всю группу услуг. Если задана и услуга, и категория —
  // приоритет у услуги (точное правило перебивает групповое).
  category_id: z.string().uuid().nullable().optional(),
  // Кому начисляем: конкретной группе сотрудников или (NULL) всем в общем пуле.
  staff_group_id: z.string().uuid().nullable().optional(),
  commission_type: z.enum(['percent', 'fixed']),
  amount: z.number().min(0).max(100),
  effective_from: isoDate().optional(),
  effective_to: isoDate().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

// POST /api/salary/commissions — создать правило
router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const companyId = req.auth!.company_id;

    if (input.service_id) {
      const svc = await pool.query(
        `SELECT id FROM salons.services WHERE company_id = $1 AND id = $2`,
        [companyId, input.service_id],
      );
      if (!svc.rows[0]) throw new HttpError(400, 'service not found', 'INVALID_SERVICE');
    }

    const { rows } = await pool.query(
      `INSERT INTO salary.service_commissions
         (company_id, service_id, category_id, staff_group_id,
          commission_type, amount, effective_from, effective_to, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *, amount::float8 AS amount`,
      [
        companyId,
        input.service_id ?? null,
        input.category_id ?? null,
        input.staff_group_id ?? null,
        input.commission_type,
        input.amount,
        input.effective_from ?? new Date().toISOString().slice(0, 10),
        input.effective_to ?? null,
        input.notes ?? null,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e) { return next(e); }
});

// DELETE /api/salary/commissions/:id
router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM salary.service_commissions WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rowCount) return next(new HttpError(404, 'commission rule not found'));
    return res.status(204).send();
  } catch (e) { return next(e); }
});

export default router;
