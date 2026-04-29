import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock pg pool before any imports
vi.mock('../db', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

const COMPANY_ID   = '00000000-0000-0000-0000-000000000001';
const WAREHOUSE_ID = '11111111-1111-1111-1111-111111111111';
const BOOKING_ID   = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const SERVICE_ID   = 'ssssssss-ssss-ssss-ssss-ssssssssssss';
const PRODUCT_ID   = 'pppppppp-pppp-pppp-pppp-pppppppppppp';
const LOT_ID       = 'llllllll-llll-llll-llll-llllllllllll';

// Minimal PoolClient-like mock
function makeClient(responses: Array<{ rows: unknown[]; rowCount?: number }>) {
  let i = 0;
  return {
    query: vi.fn().mockImplementation(() =>
      Promise.resolve(responses[i++] ?? { rows: [], rowCount: 0 }),
    ),
  };
}

describe('consume worker — loadTechCardItems', () => {
  beforeEach(() => vi.clearAllMocks());

  it('includes tracking_mode = auto filter in SQL', async () => {
    const client = makeClient([{ rows: [] }]);
    const { loadTechCardItems } = await import('../worker');

    await loadTechCardItems(client as never, COMPANY_ID, SERVICE_ID);

    const [sql] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("tracking_mode = 'auto'");
    expect(sql).toContain('tech_cards');
    expect(sql).toContain('p.is_active = TRUE');
  });

  it('passes company_id and service_id as params', async () => {
    const client = makeClient([{ rows: [] }]);
    const { loadTechCardItems } = await import('../worker');

    await loadTechCardItems(client as never, COMPANY_ID, SERVICE_ID);

    const [, params] = (client.query as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string[]];
    expect(params).toContain(COMPANY_ID);
    expect(params).toContain(SERVICE_ID);
  });

  it('returns parsed rows', async () => {
    const item = { product_id: PRODUCT_ID, qty_per_service: 7.5 };
    const client = makeClient([{ rows: [item] }]);
    const { loadTechCardItems } = await import('../worker');

    const result = await loadTechCardItems(client as never, COMPANY_ID, SERVICE_ID);
    expect(result).toEqual([item]);
  });

  it('returns empty array when no tech card exists for service', async () => {
    const client = makeClient([{ rows: [] }]);
    const { loadTechCardItems } = await import('../worker');

    const result = await loadTechCardItems(client as never, COMPANY_ID, SERVICE_ID);
    expect(result).toEqual([]);
  });
});

describe('consume worker — consumeFifo', () => {
  beforeEach(() => vi.clearAllMocks());

  it('decrements lot and writes movement when stock is sufficient', async () => {
    const client = makeClient([
      // SELECT lots FOR UPDATE
      { rows: [{ id: LOT_ID, warehouse_id: WAREHOUSE_ID, qty_remaining: 100, unit_cost: 50 }] },
      // UPDATE stock_lots
      { rows: [], rowCount: 1 },
      // INSERT stock_movements
      { rows: [] },
    ]);
    const { consumeFifo } = await import('../worker');

    const remaining = await consumeFifo(
      client as never, COMPANY_ID, PRODUCT_ID, WAREHOUSE_ID, 5, BOOKING_ID, { debug: vi.fn(), warn: vi.fn() } as never,
    );

    expect(remaining).toBe(0);
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>;
    // UPDATE must decrement by 5
    const upd = calls.find(([sql]) => sql.includes('qty_remaining = qty_remaining - $1'));
    expect(upd).toBeTruthy();
    expect(upd![1][0]).toBe(5);
    // INSERT movement with source_type 'booking'
    const ins = calls.find(([sql]) => sql.includes('stock_movements'));
    expect(ins).toBeTruthy();
    expect(ins![0]).toContain("'booking'");      // literal in SQL
    expect(ins![1]).toContain(BOOKING_ID);       // param
    expect(ins![1]).toContain(LOT_ID);
    expect(ins![1]).toContain(-5);               // negative qty
  });

  it('returns 0 remaining when lot has exactly enough stock', async () => {
    const client = makeClient([
      { rows: [{ id: LOT_ID, warehouse_id: WAREHOUSE_ID, qty_remaining: 3, unit_cost: 10 }] },
      { rows: [], rowCount: 1 },
      { rows: [] },
    ]);
    const { consumeFifo } = await import('../worker');
    const remaining = await consumeFifo(
      client as never, COMPANY_ID, PRODUCT_ID, WAREHOUSE_ID, 3, BOOKING_ID, { debug: vi.fn(), warn: vi.fn() } as never,
    );
    expect(remaining).toBe(0);
  });

  it('returns > 0 and writes insufficient movement when stock is empty', async () => {
    const client = makeClient([
      // No lots available
      { rows: [] },
      // INSERT insufficient movement
      { rows: [] },
    ]);
    const { consumeFifo } = await import('../worker');

    const remaining = await consumeFifo(
      client as never, COMPANY_ID, PRODUCT_ID, WAREHOUSE_ID, 10, BOOKING_ID, { debug: vi.fn(), warn: vi.fn() } as never,
    );

    expect(remaining).toBe(10);
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>;
    const insufficientIns = calls.find(
      ([sql]) => sql.includes('stock_movements') && sql.includes('stock_insufficient'),
    );
    expect(insufficientIns).toBeTruthy();
    expect(insufficientIns![1]).toContain(-10); // full qty flagged
  });

  it('drains multiple lots FIFO order when first lot is insufficient', async () => {
    const LOT_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const LOT_B = 'bbbbbbbb-0000-0000-0000-000000000000';
    const client = makeClient([
      // Two lots: A=3, B=10 (total 13, need 8)
      {
        rows: [
          { id: LOT_A, warehouse_id: WAREHOUSE_ID, qty_remaining: 3, unit_cost: 10 },
          { id: LOT_B, warehouse_id: WAREHOUSE_ID, qty_remaining: 10, unit_cost: 10 },
        ],
      },
      { rows: [], rowCount: 1 }, // UPDATE lot A
      { rows: [] },              // INSERT movement A
      { rows: [], rowCount: 1 }, // UPDATE lot B
      { rows: [] },              // INSERT movement B
    ]);
    const { consumeFifo } = await import('../worker');

    const remaining = await consumeFifo(
      client as never, COMPANY_ID, PRODUCT_ID, WAREHOUSE_ID, 8, BOOKING_ID, { debug: vi.fn(), warn: vi.fn() } as never,
    );

    expect(remaining).toBe(0);
    const calls = (client.query as ReturnType<typeof vi.fn>).mock.calls as Array<[string, unknown[]]>;
    const updates = calls.filter(([sql]) => sql.includes('qty_remaining = qty_remaining - $1'));
    expect(updates).toHaveLength(2);
    // First decrement is full lot A (3), second is remaining need (5)
    expect(updates[0][1][0]).toBe(3);
    expect(updates[1][1][0]).toBe(5);
  });

  it('skips lot and continues if UPDATE rowCount is not 1 (race condition guard)', async () => {
    const LOT_B = 'bbbbbbbb-0000-0000-0000-000000000001';
    const client = makeClient([
      {
        rows: [
          { id: LOT_ID, warehouse_id: WAREHOUSE_ID, qty_remaining: 5, unit_cost: 10 },
          { id: LOT_B,  warehouse_id: WAREHOUSE_ID, qty_remaining: 10, unit_cost: 10 },
        ],
      },
      { rows: [], rowCount: 0 }, // LOT_ID update "fails" (race) — no decrement
      { rows: [], rowCount: 1 }, // LOT_B update succeeds
      { rows: [] },              // INSERT movement for LOT_B
    ]);
    const { consumeFifo } = await import('../worker');

    const remaining = await consumeFifo(
      client as never, COMPANY_ID, PRODUCT_ID, WAREHOUSE_ID, 5, BOOKING_ID, { debug: vi.fn(), warn: vi.fn() } as never,
    );

    // LOT_B had 10, took 5 → remaining = 0
    expect(remaining).toBe(0);
  });
});

describe('consume worker — startConsumeWorker', () => {
  it('is exported as a function', async () => {
    const { startConsumeWorker } = await import('../worker');
    expect(typeof startConsumeWorker).toBe('function');
  });
});
