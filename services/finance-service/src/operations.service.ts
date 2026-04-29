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

  const ins = await client.query(
    `INSERT INTO finance.operations
       (company_id, account_id, kind, category_id, counterparty_id,
        amount, op_date, note, transfer_group_id, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      args.companyId, args.accountId, args.kind,
      args.categoryId, args.counterpartyId,
      Math.abs(args.amount), args.opDate, args.note,
      args.transferGroupId, args.createdByUserId,
    ],
  );
  await client.query(
    `UPDATE finance.accounts SET current_balance = current_balance + $1
     WHERE id = $2 AND company_id = $3`,
    [delta, args.accountId, args.companyId],
  );
  return { id: ins.rows[0].id as string };
}
