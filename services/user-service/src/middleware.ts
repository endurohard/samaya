import type { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { verifyAccess, type AccessPayload } from './jwt';
import { AuthError } from './auth.service';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AccessPayload;
    }
  }
}

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'missing bearer token' });
  }
  try {
    const payload = await verifyAccess(header.slice(7));
    req.auth = payload;
    return next();
  } catch {
    return res.status(401).json({ error: 'invalid token' });
  }
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'validation', details: err.flatten().fieldErrors });
  }
  if (err instanceof AuthError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  // eslint-disable-next-line no-console
  console.error('[unhandled]', err);
  return res.status(500).json({ error: 'internal' });
}
