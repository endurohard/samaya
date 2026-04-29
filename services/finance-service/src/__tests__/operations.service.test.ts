import { describe, it, expect, vi, beforeEach } from 'vitest';
import { balanceDelta, insertOpAndUpdateBalance } from '../operations.service';
import type { OpKind } from '../operations.service';

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const ACCOUNT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OP_ID      = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const USER_ID    = 'uuuuuuuu-uuuu-uuuu-uuuu-uuuuuuuuuuuu';

function makeClient(responses: Array<{ rows: unknown[]; rowCount?: number }>) {
  let i = 0;
  return {
    query: vi.fn().mockImplementation(() =>
      Promise.resolve(responses[i++] ?? { rows: [], rowCount: 0 }),
    ),
  };
}

// ===== balanceDelta =====

describe('balanceDelta', () => {
  const cases: Array<[OpKind, number, number]> = [
    ['income',       100,  100],
    ['transfer_in',  200,  200],
    ['expense',      150, -150],
    ['transfer_out', 300, -300],
    ['adjust',        50,   50],
    ['adjust',       -75,  -75],
  ];
  it.each(cases)('kind=%s amount=%s → delta=%s', (kind, amount, expected) => {
    expect(balanceDelta(kind, amount)).toBe(expected);
  });
});

// ===== insertOpAndUpdateBalance =====

describe('insertOpAndUpdateBalance', () => {
  beforeEach(() => vi.clearAllMocks());

  const baseArgs = {
    companyId: COMPANY_ID,
    accountId: ACCOUNT_ID,
    kind: 'income' as OpKind,
    amount: 500,
    opDate: '2026-04-29',
    categoryId: null,
    counterpartyId: null,
    note: null,
    transferGroupId: null,
    createdByUserId: USER_ID,
  };

  it('inserts operation and updates balance for income', async () => {
    const client = makeClient([
      { rows: [{ id: ACCOUNT_ID }] },          // account check
      { rows: [{ id: OP_ID }] },               // INSERT operation
      { rows: [], rowCount: 1 },               // UPDATE balance
    ]);

    const result = await insertOpAndUpdateBalance(client as never, baseArgs);

    expect(result).toEqual({ id: OP_ID });

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>;
    // Account check
    expect(calls[0][0]).toContain('finance.accounts');
    expect(calls[0][1]).toContain(ACCOUNT_ID);
    // INSERT
    expect(calls[1][0]).toContain('INSERT INTO finance.operations');
    expect(calls[1][1]).toContain('income');
    expect(calls[1][1]).toContain(500);
    // Balance update: delta = +500 for income
    expect(calls[2][0]).toContain('current_balance = current_balance + $1');
    expect(calls[2][1][0]).toBe(500);
  });

  it('applies negative delta for expense', async () => {
    const client = makeClient([
      { rows: [{ id: ACCOUNT_ID }] },
      { rows: [{ id: OP_ID }] },
      { rows: [], rowCount: 1 },
    ]);

    await insertOpAndUpdateBalance(client as never, { ...baseArgs, kind: 'expense', amount: 200 });

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>;
    expect(calls[2][1][0]).toBe(-200);
  });

  it('stores abs(amount) in INSERT but applies signed delta for transfer_out', async () => {
    const client = makeClient([
      { rows: [{ id: ACCOUNT_ID }] },
      { rows: [{ id: OP_ID }] },
      { rows: [], rowCount: 1 },
    ]);

    await insertOpAndUpdateBalance(client as never, { ...baseArgs, kind: 'transfer_out', amount: 300 });

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>;
    const insertParams = calls[1][1] as unknown[];
    // amount stored as abs value
    expect(insertParams).toContain(300);
    // balance delta is negative
    expect(calls[2][1][0]).toBe(-300);
  });

  it('throws HttpError 404 when account does not belong to company', async () => {
    const client = makeClient([
      { rows: [] },  // account not found
    ]);

    await expect(
      insertOpAndUpdateBalance(client as never, baseArgs),
    ).rejects.toMatchObject({ status: 404, code: 'ACCOUNT_NOT_FOUND' });

    // Must NOT proceed to INSERT
    expect((client.query as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('passes category_id and note when provided', async () => {
    const CAT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
    const client = makeClient([
      { rows: [{ id: ACCOUNT_ID }] },
      { rows: [{ id: OP_ID }] },
      { rows: [], rowCount: 1 },
    ]);

    await insertOpAndUpdateBalance(client as never, {
      ...baseArgs,
      categoryId: CAT_ID,
      note: 'test note',
    });

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>;
    expect(calls[1][1]).toContain(CAT_ID);
    expect(calls[1][1]).toContain('test note');
  });

  it('adjust kind uses amount as signed delta directly', async () => {
    const client = makeClient([
      { rows: [{ id: ACCOUNT_ID }] },
      { rows: [{ id: OP_ID }] },
      { rows: [], rowCount: 1 },
    ]);

    await insertOpAndUpdateBalance(client as never, { ...baseArgs, kind: 'adjust', amount: -120 });

    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>;
    expect(calls[2][1][0]).toBe(-120);
  });
});
