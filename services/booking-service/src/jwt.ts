import { jwtVerify, type JWTPayload } from 'jose';
import { config } from './config';

const secret = new TextEncoder().encode(config.JWT_SECRET);

export interface AccessPayload extends JWTPayload {
  sub: string;
  company_id: string;
  role: string;
  type: 'access';
}

export async function verifyAccess(token: string): Promise<AccessPayload> {
  const { payload } = await jwtVerify(token, secret);
  if (payload.type !== 'access') throw new Error('not an access token');
  return payload as AccessPayload;
}
