import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

// Справочник должностей компании. Должность — не только подпись в карточке:
// флагом show_in_journal она решает, занимает ли сотрудник колонку в журнале
// записей. Техничку и менеджера по продажам на клиента не записывают, а место
// в сетке они занимали наравне с врачами.
const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.show_in_journal,
              (SELECT COUNT(*)::int FROM salons.masters m
                WHERE m.company_id = p.company_id
                  AND lower(btrim(m.position)) = lower(btrim(p.name))) AS masters_count
         FROM salons.positions p
        WHERE p.company_id = $1
        ORDER BY p.name`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  show_in_journal: z.boolean().optional().default(true),
});

router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO salons.positions (company_id, name, show_in_journal)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id, lower(btrim(name))) DO UPDATE
         SET show_in_journal = EXCLUDED.show_in_journal
       RETURNING id, name, show_in_journal`,
      [req.auth!.company_id, body.name, body.show_in_journal],
    );
    return res.status(201).json(rows[0]);
  } catch (e) { return next(e); }
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  show_in_journal: z.boolean().optional(),
});

router.patch('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = patchSchema.parse(req.body);
    if (body.name === undefined && body.show_in_journal === undefined) {
      throw new HttpError(400, 'nothing to update');
    }
    await client.query('BEGIN');

    const cur = await client.query(
      `SELECT name FROM salons.positions WHERE company_id = $1 AND id = $2 FOR UPDATE`,
      [req.auth!.company_id, req.params.id],
    );
    if (!cur.rows[0]) throw new HttpError(404, 'position not found');

    const { rows } = await client.query(
      `UPDATE salons.positions
          SET name = COALESCE($3, name),
              show_in_journal = COALESCE($4, show_in_journal)
        WHERE company_id = $1 AND id = $2
        RETURNING id, name, show_in_journal`,
      [req.auth!.company_id, req.params.id, body.name ?? null, body.show_in_journal ?? null],
    );

    // Переименование тянет за собой карточки сотрудников: связь идёт по имени,
    // и без этого у них осталась бы должность, которой в справочнике больше нет.
    if (body.name && body.name !== cur.rows[0].name) {
      await client.query(
        `UPDATE salons.masters SET position = $3
          WHERE company_id = $1 AND lower(btrim(position)) = lower(btrim($2))`,
        [req.auth!.company_id, cur.rows[0].name, body.name],
      );
    }

    await client.query('COMMIT');
    return res.json(rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { /* соединение уже мертво */ });
    return next(e);
  } finally {
    client.release();
  }
});

// Должность удаляется только из справочника: сотрудникам её оставляем, иначе
// удаление строки в списке молча стирало бы подпись в карточках.
router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM salons.positions WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rowCount) throw new HttpError(404, 'position not found');
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

export default router;
