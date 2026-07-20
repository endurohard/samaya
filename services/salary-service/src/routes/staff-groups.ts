import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

// GET /api/salary/staff-groups — группы вместе с составом
router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT g.id, g.name, g.created_at,
              COALESCE(
                json_agg(
                  json_build_object('master_id', gm.master_id, 'display_name', m.display_name)
                  ORDER BY m.display_name
                ) FILTER (WHERE gm.master_id IS NOT NULL),
                '[]'::json
              ) AS members
       FROM salary.staff_groups g
       LEFT JOIN salary.staff_group_members gm ON gm.group_id = g.id
       LEFT JOIN salons.masters m ON m.id = gm.master_id
       WHERE g.company_id = $1
       GROUP BY g.id
       ORDER BY g.name`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const upsertSchema = z.object({
  name: z.string().min(1).max(200),
  member_ids: z.array(z.string().uuid()).default([]),
});

// POST /api/salary/staff-groups — создать группу с составом
router.post('/', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = upsertSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    await client.query('BEGIN');

    const ins = await client.query(
      `INSERT INTO salary.staff_groups (company_id, name) VALUES ($1, $2) RETURNING id, name, created_at`,
      [companyId, input.name.trim()],
    );
    const group = ins.rows[0];
    await replaceMembers(client, companyId, group.id, input.member_ids);

    await client.query('COMMIT');
    return res.status(201).json(group);
  } catch (e: unknown) {
    await client.query('ROLLBACK').catch(() => { /* соединение уже мертво */ });
    if (typeof e === 'object' && e !== null && (e as { code?: string }).code === '23505') {
      return next(new HttpError(409, 'группа с таким названием уже есть', 'DUPLICATE_NAME'));
    }
    return next(e);
  } finally {
    client.release();
  }
});

// PUT /api/salary/staff-groups/:id — переименовать и заменить состав
router.put('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = upsertSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    await client.query('BEGIN');

    const upd = await client.query(
      `UPDATE salary.staff_groups SET name = $3
       WHERE company_id = $1 AND id = $2 RETURNING id, name, created_at`,
      [companyId, req.params.id, input.name.trim()],
    );
    if (!upd.rows[0]) throw new HttpError(404, 'группа не найдена');
    await replaceMembers(client, companyId, req.params.id, input.member_ids);

    await client.query('COMMIT');
    return res.json(upd.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => { /* соединение уже мертво */ });
    return next(e);
  } finally {
    client.release();
  }
});

// DELETE — правила начисления на эту группу удалятся каскадом (ON DELETE CASCADE),
// иначе остались бы «висячие» правила, начисляющие в никуда.
router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM salary.staff_groups WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id],
    );
    if (!rowCount) return next(new HttpError(404, 'группа не найдена'));
    return res.status(204).send();
  } catch (e) { return next(e); }
});

async function replaceMembers(
  client: import('pg').PoolClient,
  companyId: string,
  groupId: string,
  memberIds: string[],
): Promise<void> {
  await client.query(`DELETE FROM salary.staff_group_members WHERE group_id = $1`, [groupId]);
  if (!memberIds.length) return;

  // Проверяем, что все сотрудники наши: иначе в группу можно затащить чужого
  // мастера и начислять ему зарплату из чужой компании.
  const check = await client.query(
    `SELECT id FROM salons.masters WHERE company_id = $1 AND id = ANY($2::uuid[])`,
    [companyId, memberIds],
  );
  if (check.rows.length !== memberIds.length) {
    throw new HttpError(400, 'в списке есть неизвестные сотрудники', 'INVALID_MEMBERS');
  }

  const values = memberIds.map((_, i) => `($1, $${i + 2})`).join(', ');
  await client.query(
    `INSERT INTO salary.staff_group_members (group_id, master_id) VALUES ${values}`,
    [groupId, ...memberIds],
  );
}

export default router;
