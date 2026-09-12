// Токен публичной ссылки каталога: 12 случайных байт → 16 символов base64url.
// Без спецсимволов, чтобы ссылка спокойно жила в WhatsApp и QR.
import { randomBytes } from 'node:crypto';

export const CATALOG_TOKEN_RE = /^[A-Za-z0-9_-]{16,32}$/;

export function newCatalogToken(): string {
  return randomBytes(12).toString('base64url');
}
