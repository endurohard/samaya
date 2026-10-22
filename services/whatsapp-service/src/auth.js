import { jwtVerify } from 'jose';
import { timingSafeEqual } from 'crypto';

const NODE_ENV = process.env.NODE_ENV || 'development';
const DEFAULT_DEV_TOKEN = 'dev_internal_token';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || DEFAULT_DEV_TOKEN;
const JWT_SECRET = process.env.JWT_SECRET || '';

// Constant-time сравнение, чтобы не утекала длина/содержимое токена по времени ответа.
function tokenMatches(provided) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(INTERNAL_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

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
// либо Bearer JWT пользователя с правом на переписку.
//
// Проверяем ПРАВО, а не только роль: раньше здесь стоял жёсткий список
// ['owner','admin'], и сотруднику с ролью master переписку нельзя было
// открыть никакой настройкой — раздел молча отдавал пустой список.
// Роли owner/admin проходят всегда: у них право есть по умолчанию, а
// старые токены, выданные до появления права, не должны отваливаться.
export async function authenticate(req, res, next) {
  if (tokenMatches(req.headers['x-internal-token'])) return next();

  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ') && secret) {
    try {
      const { payload } = await jwtVerify(h.slice(7), secret);
      if (payload.type === 'access') {
        const perms = payload.permissions || {};
        const isAdmin = ADMIN_ROLES.includes(payload.role);
        if (isAdmin || perms['messages.view'] === true) {
          // Кто именно вошёл — нужно роуту отправки, чтобы подписать сообщение
          // автором. При внутреннем токене (booking-service) автора нет: это
          // автоматика, а не сотрудник.
          req.user = {
            id: payload.sub,
            role: payload.role,
            canSend: isAdmin || perms['messages.send'] === true,
          };
          return next();
        }
        return res.status(403).json({
          error: 'forbidden',
          message: 'Нет доступа к переписке — требуется право «Переписка: чтение»',
        });
      }
    } catch {
      // невалидный токен → 401 ниже
    }
  }
  return res.status(401).json({ error: 'unauthorized' });
}

/**
 * Запретить изменяющие действия без права на отправку.
 *
 * Ставится на маршруты, которые пишут клиенту: отправка, рассылка.
 */
export function requireSend(req, res, next) {
  // Внутренний токен: req.user не заполняется, это сервис-к-сервису
  // (booking-service шлёт напоминания о записи) — такие запросы пропускаем.
  if (!req.user) return next();
  if (req.user.canSend) return next();
  return res.status(403).json({
    error: 'forbidden',
    message: 'Нет права отправлять сообщения клиентам',
  });
}
