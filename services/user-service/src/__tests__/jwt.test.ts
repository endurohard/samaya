import { describe, it, expect } from 'vitest';
import { generateRefreshToken, hashRefreshToken, signAccess, verifyAccess } from '../jwt';

describe('refresh token helpers', () => {
  it('hash matches sha256(token)', () => {
    const { token, hash } = generateRefreshToken();
    expect(token.length).toBeGreaterThan(40);
    expect(hashRefreshToken(token)).toEqual(hash);
  });

  it('produces unique tokens', () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a.token).not.toEqual(b.token);
    expect(a.hash).not.toEqual(b.hash);
  });
});

describe('access token roundtrip', () => {
  it('signs and verifies an access token', async () => {
    const token = await signAccess({
      sub: '11111111-1111-1111-1111-111111111111',
      company_id: '00000000-0000-0000-0000-000000000001',
      role: 'owner',
    });
    const payload = await verifyAccess(token);
    expect(payload.sub).toEqual('11111111-1111-1111-1111-111111111111');
    expect(payload.company_id).toEqual('00000000-0000-0000-0000-000000000001');
    expect(payload.role).toEqual('owner');
    expect(payload.type).toEqual('access');
  });

  it('rejects garbage tokens', async () => {
    await expect(verifyAccess('not-a-real-jwt')).rejects.toThrow();
  });
});
