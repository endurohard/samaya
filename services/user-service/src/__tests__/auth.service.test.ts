import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseTtlMs, AuthError, register, login } from '../auth.service';

// ===== parseTtlMs =====

describe('parseTtlMs', () => {
  it.each([
    ['30s',  30_000],
    ['15m',  15 * 60_000],
    ['2h',   2 * 3_600_000],
    ['7d',   7 * 86_400_000],
    ['1s',   1_000],
    ['90m',  90 * 60_000],
  ])('%s → %i ms', (input, expected) => {
    expect(parseTtlMs(input)).toBe(expected);
  });

  it('throws on invalid format', () => {
    expect(() => parseTtlMs('30x')).toThrow('invalid TTL');
    expect(() => parseTtlMs('')).toThrow('invalid TTL');
    expect(() => parseTtlMs('abc')).toThrow('invalid TTL');
  });
});

// ===== AuthError =====

describe('AuthError', () => {
  it('carries status and code', () => {
    const e = new AuthError(401, 'bad creds', 'INVALID_CREDENTIALS');
    expect(e.status).toBe(401);
    expect(e.code).toBe('INVALID_CREDENTIALS');
    expect(e.message).toBe('bad creds');
    expect(e).toBeInstanceOf(Error);
  });

  it('defaults code to AUTH_ERROR', () => {
    const e = new AuthError(400, 'oops');
    expect(e.code).toBe('AUTH_ERROR');
  });
});

// ===== register / login — validation-only (no DB) =====

vi.mock('../db', () => ({
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
  },
}));

vi.mock('../jwt', () => ({
  signAccess: vi.fn().mockResolvedValue('access-token'),
  generateRefreshToken: vi.fn().mockReturnValue({ token: 'refresh-token', hash: 'hash' }),
  hashRefreshToken: vi.fn().mockReturnValue('hash'),
}));

import { pool } from '../db';

function makeClient(responses: Array<{ rows: unknown[]; rowCount?: number }>) {
  let i = 0;
  const q = vi.fn().mockImplementation(() =>
    Promise.resolve(responses[i++] ?? { rows: [], rowCount: 0 }),
  );
  return { query: q, release: vi.fn() };
}

const COMPANY_ID = '00000000-0000-0000-0000-000000000001';

beforeEach(() => vi.clearAllMocks());

describe('register — input validation', () => {
  it('throws 400 when neither email nor phone provided', async () => {
    await expect(register({ company_id: COMPANY_ID, password: 'password123' }))
      .rejects.toMatchObject({ status: 400, code: 'EMAIL_OR_PHONE_REQUIRED' });
  });

  it('throws 400 when password too short', async () => {
    await expect(register({ company_id: COMPANY_ID, email: 'a@b.com', password: 'short' }))
      .rejects.toMatchObject({ status: 400, code: 'PASSWORD_TOO_SHORT' });
  });
});

describe('register — DB outcomes', () => {
  it('returns token bundle on success', async () => {
    const user = {
      id: 'user-1',
      company_id: COMPANY_ID,
      email: 'a@b.com',
      phone: null,
      full_name: null,
      role: 'client',
    };
    const client = makeClient([
      { rows: [] },     // BEGIN
      { rows: [user] }, // INSERT user
      { rows: [] },     // INSERT refresh_token
      { rows: [] },     // COMMIT
    ]);
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    const result = await register({ company_id: COMPANY_ID, email: 'a@b.com', password: 'validpass' });
    expect(result.user.email).toBe('a@b.com');
    expect(result.access_token).toBe('access-token');
    expect(result.refresh_token).toBe('refresh-token');
  });

  it('throws 409 on duplicate user (23505)', async () => {
    const err = Object.assign(new Error('dup'), { code: '23505' });
    const client = makeClient([{ rows: [] }]); // BEGIN
    client.query.mockRejectedValueOnce(err);   // INSERT throws
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    await expect(
      register({ company_id: COMPANY_ID, email: 'a@b.com', password: 'validpass' }),
    ).rejects.toMatchObject({ status: 409, code: 'USER_EXISTS' });
  });

  it('throws 400 on invalid company (23503)', async () => {
    const err = Object.assign(new Error('fk'), { code: '23503' });
    const client = makeClient([{ rows: [] }]);
    client.query.mockRejectedValueOnce(err);
    vi.mocked(pool.connect).mockResolvedValue(client as never);

    await expect(
      register({ company_id: 'bad-id', email: 'a@b.com', password: 'validpass' }),
    ).rejects.toMatchObject({ status: 400, code: 'INVALID_COMPANY' });
  });
});

describe('login — input validation and outcomes', () => {
  it('throws 400 when neither email nor phone provided', async () => {
    await expect(login({ company_id: COMPANY_ID, password: 'pass' }))
      .rejects.toMatchObject({ status: 400, code: 'EMAIL_OR_PHONE_REQUIRED' });
  });

  it('throws 401 when user not found', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as never);
    await expect(login({ company_id: COMPANY_ID, email: 'x@x.com', password: 'anypass' }))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('throws 403 when user disabled', async () => {
    vi.mocked(pool.query).mockResolvedValueOnce({
      rows: [{ id: '1', company_id: COMPANY_ID, email: 'x@x.com', phone: null,
               full_name: null, role: 'client', is_active: false,
               password_hash: '$2a$10$invalid' }],
    } as never);
    await expect(login({ company_id: COMPANY_ID, email: 'x@x.com', password: 'anypass' }))
      .rejects.toMatchObject({ status: 403, code: 'USER_DISABLED' });
  });
});
