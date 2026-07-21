import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '../validators';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';
import { insertOpAndUpdateBalance } from '../operations.service';

const router = Router();
router.use(authenticate);

// ===== List with filters =====
const listSchema = z.object({
  from: isoDate().optional(),
  to: isoDate().optional(),
  account_id: z.string().uuid().optional(),
  category_id: z.string().uuid().optional(),
  counterparty_id: z.string().uuid().optional(),
  kind: z.enum(['income', 'expense', 'transfer_out', 'transfer_in', 'adjust']).optional(),
  // Вид расчёта: cash = наличный счёт (type='cash'), cashless = безналичный (остальные типы)
  payment_method: z.enum(['cash', 'cashless']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

router.get('/', async (req, res, next) => {
  try {
    const q = listSchema.parse(req.query);
    const params: unknown[] = [req.auth!.company_id];
    let where = `o.company_id = $1 AND o.is_deleted = FALSE`;
    if (q.from) {
      params.push(q.from);
      where += ` AND o.op_date >= $${params.length}`;
    }
    if (q.to) {
      params.push(q.to);
      where += ` AND o.op_date <= $${params.length}`;
    }
    if (q.account_id) {
      params.push(q.account_id);
      where += ` AND o.account_id = $${params.length}`;
    }
    if (q.category_id) {
      params.push(q.category_id);
      where += ` AND o.category_id = $${params.length}`;
    }
    if (q.counterparty_id) {
      params.push(q.counterparty_id);
      where += ` AND o.counterparty_id = $${params.length}`;
    }
    if (q.kind) {
      params.push(q.kind);
      where += ` AND o.kind = $${params.length}`;
    }
    if (q.payment_method === 'cash') {
      where += ` AND a.type = 'cash'`;
    } else if (q.payment_method === 'cashless') {
      where += ` AND a.type <> 'cash'`;
    }
    params.push(q.limit);
    const { rows } = await pool.query(
      `SELECT o.id, o.account_id, a.name AS account_name, a.type AS account_type,
              o.kind, o.category_id, c.name AS category_name,
              o.counterparty_id, cp.name AS counterparty_name,
              o.amount::float8 AS amount,
              o.op_date, o.note, o.transfer_group_id,
              o.created_by_user_id, o.created_at
       FROM finance.operations o
       LEFT JOIN finance.accounts a ON a.id = o.account_id
       LEFT JOIN finance.cashflow_categories c ON c.id = o.category_id
       LEFT JOIN finance.counterparties cp ON cp.id = o.counterparty_id
       WHERE ${where}
       ORDER BY o.op_date DESC, o.created_at DESC
       LIMIT $${params.length}`,
      params,
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

// ===== POST /income =====
const incomeSchema = z.object({
  account_id: z.string().uuid(),
  amount: z.number().positive(),
  op_date: isoDate(),
  category_id: z.string().uuid().optional(),
  counterparty_id: z.string().uuid().optional(),
  note: z.string().max(500).optional(),
});

// master тоже может проводить приход: оформление продажи в кассу делает тот,
// кто принял оплату, а это в клинике и врач.
router.post('/income', requireRole(['owner', 'admin', 'master']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = incomeWithSourceSchema.parse(req.body);
    await client.query('BEGIN');
    const { id } = await insertOpAndUpdateBalance(client, {
      companyId: req.auth!.company_id,
      accountId: input.account_id,
      kind: 'income',
      amount: input.amount,
      opDate: input.op_date,
      categoryId: input.category_id ?? null,
      counterpartyId: input.counterparty_id ?? null,
      note: input.note ?? null,
      transferGroupId: null,
      createdByUserId: req.auth!.sub,
      sourceType: input.source_type ?? null,
      sourceId: input.source_id ?? null,
    });
    await client.query('COMMIT');
    return res.status(201).json({ id });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

const incomeWithSourceSchema = incomeSchema.extend({
  // Идемпотентный ключ источника (booking_sale и т.п.) — повтор не задвоит приход.
  source_type: z.string().max(50).optional(),
  source_id: z.string().uuid().optional(),
});

// ===== POST /expense =====
const expenseSchema = incomeSchema.extend({
  // Идемпотентный ключ внешнего источника (напр. { source_type:'salary_payout', source_id:<uuid> }).
  source_type: z.string().max(50).optional(),
  source_id: z.string().uuid().optional(),
});

router.post('/expense', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = expenseSchema.parse(req.body);
    await client.query('BEGIN');
    const { id } = await insertOpAndUpdateBalance(client, {
      companyId: req.auth!.company_id,
      accountId: input.account_id,
      kind: 'expense',
      amount: input.amount,
      opDate: input.op_date,
      categoryId: input.category_id ?? null,
      counterpartyId: input.counterparty_id ?? null,
      note: input.note ?? null,
      transferGroupId: null,
      createdByUserId: req.auth!.sub,
      sourceType: input.source_type ?? null,
      sourceId: input.source_id ?? null,
    });
    await client.query('COMMIT');
    return res.status(201).json({ id });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

// ===== POST /transfer =====
const transferSchema = z.object({
  from_account_id: z.string().uuid(),
  to_account_id: z.string().uuid(),
  amount: z.number().positive(),
  op_date: isoDate(),
  note: z.string().max(500).optional(),
}).refine((d) => d.from_account_id !== d.to_account_id, {
  message: 'from_account_id and to_account_id must differ',
});

router.post('/transfer', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = transferSchema.parse(req.body);
    await client.query('BEGIN');
    const groupRes = await client.query(`SELECT uuid_generate_v4() AS id`);
    const transferGroupId: string = groupRes.rows[0].id;

    const out = await insertOpAndUpdateBalance(client, {
      companyId: req.auth!.company_id,
      accountId: input.from_account_id,
      kind: 'transfer_out',
      amount: input.amount,
      opDate: input.op_date,
      categoryId: null,
      counterpartyId: null,
      note: input.note ?? null,
      transferGroupId,
      createdByUserId: req.auth!.sub,
    });
    const inOp = await insertOpAndUpdateBalance(client, {
      companyId: req.auth!.company_id,
      accountId: input.to_account_id,
      kind: 'transfer_in',
      amount: input.amount,
      opDate: input.op_date,
      categoryId: null,
      counterpartyId: null,
      note: input.note ?? null,
      transferGroupId,
      createdByUserId: req.auth!.sub,
    });
    await client.query('COMMIT');
    return res.status(201).json({
      transfer_group_id: transferGroupId,
      out_id: out.id,
      in_id: inOp.id,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

// ===== POST /adjust =====
// Корректировка остатка: пользователь задаёт целевой баланс, мы пишем разницу.
const adjustSchema = z.object({
  account_id: z.string().uuid(),
  new_balance: z.number().finite(),
  op_date: isoDate(),
  note: z.string().max(500).optional(),
});

router.post('/adjust', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const input = adjustSchema.parse(req.body);
    await client.query('BEGIN');
    const cur = await client.query(
      `SELECT current_balance::float8 AS bal FROM finance.accounts
       WHERE id = $1 AND company_id = $2 FOR UPDATE`,
      [input.account_id, req.auth!.company_id],
    );
    if (!cur.rows[0]) throw new HttpError(404, 'account not found');
    const delta = input.new_balance - Number(cur.rows[0].bal);
    if (delta === 0) {
      await client.query('ROLLBACK');
      return res.status(200).json({ ok: true, no_change: true });
    }
    const { id } = await insertOpAndUpdateBalance(client, {
      companyId: req.auth!.company_id,
      accountId: input.account_id,
      kind: 'adjust',
      amount: delta,
      opDate: input.op_date,
      categoryId: null,
      counterpartyId: null,
      note: input.note ?? `Корректировка остатка → ${input.new_balance.toFixed(2)}`,
      transferGroupId: null,
      createdByUserId: req.auth!.sub,
    });
    await client.query('COMMIT');
    return res.status(201).json({ id, delta });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

// ===== DELETE /:id =====
router.delete('/:id', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Загружаем операцию + связанные (для transfer удаляем парную) под блокировкой,
    // чтобы два конкурентных DELETE не сделали двойной реверс баланса.
    const { rows: ops } = await client.query(
      `SELECT id, account_id, kind, amount::float8 AS amount,
              balance_delta::float8 AS balance_delta, transfer_group_id, is_deleted
       FROM finance.operations
       WHERE company_id = $1 AND id = $2
       FOR UPDATE`,
      [req.auth!.company_id, req.params.id],
    );
    if (!ops[0]) throw new HttpError(404, 'operation not found');
    if (ops[0].is_deleted) throw new HttpError(410, 'already deleted');

    const target = ops[0];
    let toDelete: typeof ops = [target];
    if (target.transfer_group_id) {
      const { rows: pair } = await client.query(
        `SELECT id, account_id, kind, amount::float8 AS amount,
                balance_delta::float8 AS balance_delta, transfer_group_id, is_deleted
         FROM finance.operations
         WHERE company_id = $1 AND transfer_group_id = $2 AND is_deleted = FALSE
         FOR UPDATE`,
        [req.auth!.company_id, target.transfer_group_id],
      );
      toDelete = pair;
    }
    for (const op of toDelete) {
      // Reverse balance. Предпочитаем знаковую balance_delta (корректно для adjust);
      // для legacy-строк без неё — старая ветка по kind.
      let delta: number;
      if (op.balance_delta !== null && op.balance_delta !== undefined) {
        delta = -op.balance_delta;
      } else if (op.kind === 'income' || op.kind === 'transfer_in') {
        delta = -op.amount;
      } else if (op.kind === 'expense' || op.kind === 'transfer_out') {
        delta = op.amount;
      } else {
        delta = -op.amount; // adjust legacy — знак неизвестен, поведение как раньше
      }
      // Атомарный guard: помечаем удалённой только если ещё не удалена; если строку
      // уже забрал конкурентный DELETE — реверс не применяем.
      const del = await client.query(
        `UPDATE finance.operations SET is_deleted = TRUE, deleted_at = NOW()
         WHERE id = $1 AND is_deleted = FALSE`,
        [op.id],
      );
      if (del.rowCount !== 1) continue;
      await client.query(
        `UPDATE finance.accounts SET current_balance = current_balance + $1
         WHERE id = $2 AND company_id = $3`,
        [delta, op.account_id, req.auth!.company_id],
      );
    }
    await client.query('COMMIT');
    return res.json({ ok: true, deleted_count: toDelete.length });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

export default router;
