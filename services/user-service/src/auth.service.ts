import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { pool } from './db';
import { signAccess, generateRefreshToken, hashRefreshToken } from './jwt';
import { config } from './config';

export class AuthError extends Error {
  constructor(
    public status: number,
    message: string,
    public code: string = 'AUTH_ERROR',
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export interface PublicUser {
  id: string;
  company_id: string;
  email: string | null;
  phone: string | null;
  full_name: string | null;
  role: string;
}

export interface TokenBundle {
  user: PublicUser;
  access_token: string;
  refresh_token: string;
}

export interface RegisterInput {
  company_id: string;
  email?: string;
  phone?: string;
  password: string;
  full_name?: string;
  role?: 'owner' | 'admin' | 'master' | 'client';
}

export interface LoginInput {
  company_id: string;
  email?: string;
  phone?: string;
  password: string;
}

interface RequestMeta {
  ip?: string;
  ua?: string;
}

const REFRESH_TTL_MS = parseTtlMs(config.JWT_REFRESH_TTL);

function parseTtlMs(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (!m) throw new Error(`invalid TTL: ${s}`);
  const n = Number(m[1]);
  switch (m[2]) {
    case 's': return n * 1_000;
    case 'm': return n * 60_000;
    case 'h': return n * 3_600_000;
    case 'd': return n * 86_400_000;
    default: throw new Error(`invalid TTL unit: ${m[2]}`);
  }
}

async function issueTokens(
  client: PoolClient,
  user: PublicUser,
  meta: RequestMeta,
): Promise<{ access_token: string; refresh_token: string }> {
  const access_token = await signAccess({
    sub: user.id,
    company_id: user.company_id,
    role: user.role,
  });
  const { token, hash } = generateRefreshToken();
  const expires_at = new Date(Date.now() + REFRESH_TTL_MS);
  await client.query(
    `INSERT INTO users.refresh_tokens (user_id, company_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [user.id, user.company_id, hash, expires_at, meta.ip ?? null, meta.ua ?? null],
  );
  return { access_token, refresh_token: token };
}

export async function register(input: RegisterInput, meta: RequestMeta = {}): Promise<TokenBundle> {
  if (!input.email && !input.phone) {
    throw new AuthError(400, 'email or phone required', 'EMAIL_OR_PHONE_REQUIRED');
  }
  if (input.password.length < 8) {
    throw new AuthError(400, 'password too short (min 8)', 'PASSWORD_TOO_SHORT');
  }
  const password_hash = await bcrypt.hash(input.password, 10);
  const role = input.role ?? 'client';

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users.users (company_id, email, phone, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, company_id, email, phone, full_name, role`,
      [
        input.company_id,
        input.email ?? null,
        input.phone ?? null,
        password_hash,
        input.full_name ?? null,
        role,
      ],
    );
    const user: PublicUser = rows[0];
    const tokens = await issueTokens(client, user, meta);
    await client.query('COMMIT');
    return { user, ...tokens };
  } catch (err: unknown) {
    await client.query('ROLLBACK');
    const e = err as { code?: string };
    if (e?.code === '23505') {
      throw new AuthError(409, 'user already exists', 'USER_EXISTS');
    }
    if (e?.code === '23503') {
      throw new AuthError(400, 'invalid company_id', 'INVALID_COMPANY');
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function login(input: LoginInput, meta: RequestMeta = {}): Promise<TokenBundle> {
  if (!input.email && !input.phone) {
    throw new AuthError(400, 'email or phone required', 'EMAIL_OR_PHONE_REQUIRED');
  }
  const where = input.email ? 'email = $2' : 'phone = $2';
  const value = input.email ?? input.phone;
  const { rows } = await pool.query(
    `SELECT id, company_id, email, phone, password_hash, full_name, role, is_active
     FROM users.users WHERE company_id = $1 AND ${where} LIMIT 1`,
    [input.company_id, value],
  );
  const row = rows[0];
  if (!row) throw new AuthError(401, 'invalid credentials', 'INVALID_CREDENTIALS');
  if (!row.is_active) throw new AuthError(403, 'user disabled', 'USER_DISABLED');
  const ok = await bcrypt.compare(input.password, row.password_hash);
  if (!ok) throw new AuthError(401, 'invalid credentials', 'INVALID_CREDENTIALS');

  const user: PublicUser = {
    id: row.id,
    company_id: row.company_id,
    email: row.email,
    phone: row.phone,
    full_name: row.full_name,
    role: row.role,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tokens = await issueTokens(client, user, meta);
    await client.query('COMMIT');
    return { user, ...tokens };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function refresh(refresh_token: string, meta: RequestMeta = {}): Promise<TokenBundle> {
  const hash = hashRefreshToken(refresh_token);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // FOR UPDATE OF rt — атомарно блокируем строку refresh-токена,
    // чтобы тот же токен не мог быть использован дважды (replay).
    const { rows } = await client.query(
      `SELECT rt.id AS rt_id, rt.expires_at, rt.revoked_at,
              u.id, u.company_id, u.email, u.phone, u.full_name, u.role, u.is_active
       FROM users.refresh_tokens rt
       JOIN users.users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
       FOR UPDATE OF rt`,
      [hash],
    );
    const row = rows[0];
    if (!row) throw new AuthError(401, 'invalid refresh token', 'INVALID_REFRESH');
    if (row.revoked_at) throw new AuthError(401, 'refresh token revoked', 'REFRESH_REVOKED');
    if (new Date(row.expires_at) < new Date()) {
      throw new AuthError(401, 'refresh token expired', 'REFRESH_EXPIRED');
    }
    if (!row.is_active) throw new AuthError(403, 'user disabled', 'USER_DISABLED');

    await client.query(
      `UPDATE users.refresh_tokens SET revoked_at = NOW() WHERE id = $1`,
      [row.rt_id],
    );

    const user: PublicUser = {
      id: row.id,
      company_id: row.company_id,
      email: row.email,
      phone: row.phone,
      full_name: row.full_name,
      role: row.role,
    };
    const tokens = await issueTokens(client, user, meta);
    await client.query('COMMIT');
    return { user, ...tokens };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function logout(refresh_token: string): Promise<void> {
  const hash = hashRefreshToken(refresh_token);
  await pool.query(
    `UPDATE users.refresh_tokens SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [hash],
  );
}
