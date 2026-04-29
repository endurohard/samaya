import { Router } from 'express';
import { pool } from '../db';
import { authenticate } from '../middleware';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, is_default, is_active, created_at
       FROM inventory.warehouses
       WHERE company_id = $1
       ORDER BY is_default DESC, name`,
      [req.auth!.company_id],
    );
    res.json({ items: rows });
  } catch (e) { next(e); }
});

export default router;
