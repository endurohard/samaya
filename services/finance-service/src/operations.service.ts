import type { PoolClient } from 'pg';
import { HttpError } from './middleware';

export type OpKind = 'income' | 'expense' | 'transfer_out' | 'transfer_in' | 'adjust';

export interface InsertOpArgs {
  companyId: string;
  accountId: string;
  kind: OpKind;
  amount: number;
  opDate: string;
  categoryId: string | null;
  counterpartyId: string | null;
  note: string | null;
  transferGroupId: string | null;
  createdByUserId: string;
  // Идемпотентный ключ внешнего источника (напр. выплата ЗП). Если операция с этой
  // парой уже существует — повторный вызов не создаёт дубль и не трогает баланс.
  sourceType?: string | null;
  sourceId?: string | null;
}

// Signed delta applied to account balance for each operation kind.
export function balanceDelta(kind: OpKind, amount: number): number {
  if (kind === 'income' || kind === 'transfer_in') return amount;
  if (kind === 'expense' || kind === 'transfer_out') return -amount;
  return amount; // adjust: caller passes signed value
}

export async function insertOpAndUpdateBalance(
  client: PoolClient,
  args: InsertOpArgs,
): Promise<{ id: string }> {
  const accCheck = await client.query(
    `SELECT id FROM finance.accounts WHERE id = $1 AND company_id = $2`,
    [args.accountId, args.companyId],
  );
  if (!accCheck.rows[0]) throw new HttpError(404, 'account not found', 'ACCOUNT_NOT_FOUND');

  const delta = balanceDelta(args.kind, args.amount);
  const sourceType = args.sourceType ?? null;
  const sourceId = args.sourceId ?? null;

  const ins = await client.query(
    `INSERT INTO finance.operations
       (company_id, account_id, kind, category_id, counterparty_id,
        amount, op_date, note, transfer_group_id, created_by_user_id,
        source_type, source_id, balance_delta)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (company_id, source_type, source_id)
       WHERE source_type IS NOT NULL AND source_id IS NOT NULL AND is_deleted = FALSE
       DO NOTHING
     RETURNING id`,
    [
      args.companyId, args.accountId, args.kind,
      args.categoryId, args.counterpartyId,
      Math.abs(args.amount), args.opDate, args.note,
      args.transferGroupId, args.createdByUserId,
      sourceType, sourceId, delta,
    ],
  );

  // Конфликт по идемпотентному ключу: операция уже создана ранее — возвращаем её id,
  // баланс НЕ трогаем (иначе двойное списание при ретрае).
  if (!ins.rows[0]) {
    const ex = await client.query(
      `SELECT id FROM finance.operations
       WHERE company_id = $1 AND source_type = $2 AND source_id = $3 AND is_deleted = FALSE`,
      [args.companyId, sourceType, sourceId],
    );
    if (ex.rows[0]) return { id: ex.rows[0].id as string };
    throw new HttpError(409, 'duplicate operation', 'DUPLICATE_OP');
  }

  await client.query(
    `UPDATE finance.accounts SET current_balance = current_balance + $1
     WHERE id = $2 AND company_id = $3`,
    [delta, args.accountId, args.companyId],
  );
  return { id: ins.rows[0].id as string };
}
