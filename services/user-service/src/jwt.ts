import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import { randomBytes, createHash } from 'crypto';
import { config } from './config';

const secret = new TextEncoder().encode(config.JWT_SECRET);

export interface AccessPayload extends JWTPayload {
  sub: string;        // user_id
  company_id: string;
  role: string;
  type: 'access';
}

export async function signAccess(payload: { sub: string; company_id: string; role: string }): Promise<string> {
  return new SignJWT({ ...payload, type: 'access' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(config.JWT_ACCESS_TTL)
    .sign(secret);
}

export async function verifyAccess(token: string): Promise<AccessPayload> {
  const { payload } = await jwtVerify(token, secret);
  if (payload.type !== 'access') {
    throw new Error('not an access token');
  }
  return payload as AccessPayload;
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  const hash = createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
