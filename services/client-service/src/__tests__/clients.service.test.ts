import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db', () => ({
  pool: { query: vi.fn() },
}));

import { pool } from '../db';
import {
  normalizePhone,
  pickAvatarColor,
  createClient,
  updateClient,
  softDelete,
  restore,
} from '../clients.service';

const q = pool.query as ReturnType<typeof vi.fn>;

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';
const CLIENT_ID  = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

beforeEach(() => vi.clearAllMocks());

// ===== normalizePhone =====

describe('normalizePhone', () => {
  it('strips formatting and preserves leading +', () => {
    expect(normalizePhone('+7 (928) 188-98-54')).toBe('+79281889854');
  });

  it('strips formatting without leading +', () => {
    expect(normalizePhone('8 (928) 188-98-54')).toBe('89281889854');
  });

  it('leaves already-clean number unchanged', () => {
    expect(normalizePhone('+79281889854')).toBe('+79281889854');
  });

  it('handles spaces and dashes only', () => {
    expect(normalizePhone('  928 188 98 54  ')).toBe('9281889854');
  });
});

// ===== pickAvatarColor =====

describe('pickAvatarColor', () => {
  it('returns a hex color string', () => {
    const color = pickAvatarColor('+79281889854');
    expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('is deterministic for the same seed', () => {
    expect(pickAvatarColor('seed')).toBe(pickAvatarColor('seed'));
  });

  it('differs for different seeds (with high probability)', () => {
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l']
      .map(pickAvatarColor));
    expect(colors.size).toBeGreaterThan(1);
  });
});

// ===== createClient =====

describe('createClient', () => {
  it('inserts and returns the new client id', async () => {
    q.mockResolvedValueOnce({ rows: [{ id: CLIENT_ID }] });

    const id = await createClient({
      company_id: COMPANY_ID,
      phone: '+7 (928) 188-98-54',
      full_name: 'Иванова Мария',
    });

    expect(id).toBe(CLIENT_ID);
    const [sql, params] = q.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO clients.clients');
    // Phone must be normalised
    expect(params).toContain('+79281889854');
    expect(params).toContain('Иванова Мария');
  });

  it('throws 400 for a phone shorter than 10 digits', async () => {
    await expect(
      createClient({ company_id: COMPANY_ID, phone: '+7123', full_name: 'X' }),
    ).rejects.toMatchObject({ status: 400, code: 'invalid_phone' });
    expect(q).not.toHaveBeenCalled();
  });

  it('converts PG 23505 (unique violation) to HttpError 409', async () => {
    q.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));

    await expect(
      createClient({ company_id: COMPANY_ID, phone: '+79281889854', full_name: 'X' }),
    ).rejects.toMatchObject({ status: 409, code: 'phone_exists' });
  });

  it('rethrows non-23505 DB errors', async () => {
    q.mockRejectedValueOnce(Object.assign(new Error('boom'), { code: '42P01' }));

    await expect(
      createClient({ company_id: COMPANY_ID, phone: '+79281889854', full_name: 'X' }),
    ).rejects.toThrow('boom');
  });
});

// ===== updateClient =====

describe('updateClient', () => {
  it('does nothing when patch is empty', async () => {
    await updateClient(COMPANY_ID, CLIENT_ID, {});
    expect(q).not.toHaveBeenCalled();
  });

  it('builds UPDATE with supplied fields only', async () => {
    q.mockResolvedValueOnce({ rowCount: 1 });

    await updateClient(COMPANY_ID, CLIENT_ID, { full_name: 'Петрова', is_blocked: true });

    const [sql, params] = q.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('UPDATE clients.clients');
    expect(sql).toContain('full_name =');
    expect(sql).toContain('is_blocked =');
    expect(sql).not.toContain('phone =');
    expect(params).toContain('Петрова');
    expect(params).toContain(true);
  });

  it('normalises phone when included in patch', async () => {
    q.mockResolvedValueOnce({ rowCount: 1 });

    await updateClient(COMPANY_ID, CLIENT_ID, { phone: '+7 (000) 000-00-00' });

    const [, params] = q.mock.calls[0] as [string, unknown[]];
    expect(params).toContain('+70000000000');
  });

  it('throws 404 when rowCount is 0', async () => {
    q.mockResolvedValueOnce({ rowCount: 0 });

    await expect(
      updateClient(COMPANY_ID, CLIENT_ID, { full_name: 'X' }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('converts 23505 to HttpError 409', async () => {
    q.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));

    await expect(
      updateClient(COMPANY_ID, CLIENT_ID, { phone: '+79000000000' }),
    ).rejects.toMatchObject({ status: 409, code: 'phone_exists' });
  });
});

// ===== softDelete / restore =====

describe('softDelete', () => {
  it('sets is_deleted = TRUE', async () => {
    q.mockResolvedValueOnce({ rowCount: 1 });

    await softDelete(COMPANY_ID, CLIENT_ID);

    const [sql] = q.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_deleted = TRUE');
  });

  it('throws 404 when client not found', async () => {
    q.mockResolvedValueOnce({ rowCount: 0 });

    await expect(softDelete(COMPANY_ID, CLIENT_ID)).rejects.toMatchObject({ status: 404 });
  });
});

describe('restore', () => {
  it('sets is_deleted = FALSE', async () => {
    q.mockResolvedValueOnce({ rowCount: 1 });

    await restore(COMPANY_ID, CLIENT_ID);

    const [sql] = q.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('is_deleted = FALSE');
  });

  it('throws 404 when client not found', async () => {
    q.mockResolvedValueOnce({ rowCount: 0 });

    await expect(restore(COMPANY_ID, CLIENT_ID)).rejects.toMatchObject({ status: 404 });
  });
});
