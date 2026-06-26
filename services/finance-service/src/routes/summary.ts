import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '../validators';
import { pool } from '../db';
import { authenticate } from '../middleware';

const router = Router();
router.use(authenticate);

const summarySchema = z.object({
  from: isoDate(),
  to: isoDate(),
});

// KPI for Финансы overview tab.
// Возвращает: opening_balance (сумма balance ВСЕХ active accounts ДО from),
// income/expense/transfer (за период), closing_balance,
// breakdown by_account_type (cash/bank/personal/other) для donut.
router.get('/', async (req, res, next) => {
  try {
    const q = summarySchema.parse(req.query);
    const companyId = req.auth!.company_id;

    // Total income/expense in period (transfers исключены — внутреннее перемещение)
    const totals = await pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'income' THEN amount ELSE 0 END), 0)::float8 AS income,
         COALESCE(SUM(CASE WHEN kind = 'expense' THEN amount ELSE 0 END), 0)::float8 AS expense
       FROM finance.operations
       WHERE company_id = $1 AND is_deleted = FALSE
         AND op_date >= $2 AND op_date <= $3`,
      [companyId, q.from, q.to],
    );

    // Closing balance (все active accounts на сегодня)
    const closing = await pool.query(
      `SELECT COALESCE(SUM(current_balance), 0)::float8 AS bal
       FROM finance.accounts
       WHERE company_id = $1 AND is_active = TRUE`,
      [companyId],
    );

    // Opening balance = closing - (income - expense - net_internal_transfers_already_in_balance)
    // Простой способ: opening = SUM(current_balance) - SUM(operations.signed_amount per account WHERE op_date >= from)
    // Но проще — пересчитать opening через initial_balance + операции ДО from.
    const opening = await pool.query(
      `SELECT COALESCE(SUM(a.initial_balance), 0)::float8
              + COALESCE(SUM(CASE
                  WHEN o.kind IN ('income', 'transfer_in') THEN o.amount
                  WHEN o.kind IN ('expense', 'transfer_out') THEN -o.amount
                  WHEN o.kind = 'adjust' THEN o.amount
                  ELSE 0
                END), 0)::float8 AS bal
       FROM finance.accounts a
       LEFT JOIN finance.operations o
              ON o.account_id = a.id AND o.is_deleted = FALSE AND o.op_date < $2
       WHERE a.company_id = $1 AND a.is_active = TRUE`,
      [companyId, q.from],
    );

    // Breakdown по типам счетов (для donut)
    const byType = await pool.query(
      `SELECT type, COALESCE(SUM(current_balance), 0)::float8 AS bal
       FROM finance.accounts
       WHERE company_id = $1 AND is_active = TRUE
       GROUP BY type`,
      [companyId],
    );

    return res.json({
      from: q.from,
      to: q.to,
      opening_balance: opening.rows[0].bal,
      income: totals.rows[0].income,
      expense: totals.rows[0].expense,
      profit: totals.rows[0].income - totals.rows[0].expense,
      closing_balance: closing.rows[0].bal,
      by_account_type: byType.rows.reduce(
        (acc: Record<string, number>, r: { type: string; bal: number }) => {
          acc[r.type] = r.bal;
          return acc;
        },
        {},
      ),
    });
  } catch (e) { return next(e); }
});

export default router;
