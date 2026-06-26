import { jwtVerify } from 'jose';

const NODE_ENV = process.env.NODE_ENV || 'development';
const DEFAULT_DEV_TOKEN = 'dev_internal_token';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || DEFAULT_DEV_TOKEN;
const JWT_SECRET = process.env.JWT_SECRET || '';

if (NODE_ENV === 'production') {
  if (INTERNAL_TOKEN === DEFAULT_DEV_TOKEN) {
    console.error('[auth] FATAL: default INTERNAL_TOKEN in production');
    process.exit(1);
  }
  if (JWT_SECRET.length < 32) {
    console.error('[auth] FATAL: JWT_SECRET missing or too short in production');
    process.exit(1);
  }
}

const secret = JWT_SECRET ? new TextEncoder().encode(JWT_SECRET) : null;
const ADMIN_ROLES = ['owner', 'admin'];

// Доступ: либо внутренний токен (service-to-service, booking-service),
// либо Bearer JWT владельца/админа (фронтенд).
export async function authenticate(req, res, next) {
  if (req.headers['x-internal-token'] === INTERNAL_TOKEN) return next();

  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ') && secret) {
    try {
      const { payload } = await jwtVerify(h.slice(7), secret);
      if (payload.type === 'access' && ADMIN_ROLES.includes(payload.role)) {
        return next();
      }
    } catch {
      // невалидный токен → 401 ниже
    }
  }
  return res.status(401).json({ error: 'unauthorized' });
}
