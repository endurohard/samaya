import type { PoolClient } from 'pg';
import { HttpError } from './middleware';

// Нормализуем телефон к единому виду: только цифры, российские номера — к 11
// знакам с ведущей 7 (та же логика, что в client-service).
//
// Раньше «+» сохранялся как есть, и один и тот же номер, введённый как
// 89519392288 и как +79519392288, давал ДВЕ карточки клиента: лицевой счёт
// пополняли на одну, а записывали на другую, и деньги «пропадали».
export function normalizePhone(raw: string): string {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

// Найти-или-создать карточку клиента по телефону в рамках компании и вернуть её id.
// Запись привязывается к клиенту (client_id), т.к. лицевой счёт/предоплата и история
// живут на карточке клиента.
// - заблокированный клиент не может записаться онлайн (public_widget) → 409;
// - удалённая карточка при новой записи реактивируется (клиент вернулся), иначе
//   уникальность phone не даст создать новую и запись потеряла бы привязку.
export async function findOrCreateClientId(
  client: PoolClient,
  companyId: string,
  phone: string | null | undefined,
  name: string | null | undefined,
  source: 'admin' | 'public_widget' | 'promo',
): Promise<string | null> {
  if (!phone) return null;
  const norm = normalizePhone(phone);
  if (!norm || norm === '+') return null;
  const fullName = (name && name.trim()) || 'Клиент';

  // Существующая карточка (с флагами) под блокировкой строки.
  //
  // Ищем по последним 10 цифрам, а не по точному совпадению строки: в базе
  // уже лежат номера, записанные по-старому ('8951…', '+7951…'), и поиск по
  // новому формату их бы не нашёл — на каждого такого клиента появился бы
  // ещё один дубль поверх существующего. Берём самую раннюю карточку:
  // на ней обычно и висит история.
  const existing = await client.query<{ id: string; is_deleted: boolean; is_blocked: boolean }>(
    `SELECT id, is_deleted, is_blocked FROM clients.clients
     WHERE company_id = $1
       AND right(regexp_replace(phone::text, '\\D', '', 'g'), 10)
           = right(regexp_replace($2::text, '\\D', '', 'g'), 10)
     ORDER BY created_at
     LIMIT 1
     FOR UPDATE`,
    [companyId, norm],
  );
  if (existing.rows[0]) {
    const row = existing.rows[0];
    if (row.is_blocked && source === 'public_widget') {
      throw new HttpError(409, 'клиент заблокирован для онлайн-записи', 'CLIENT_BLOCKED');
    }
    if (row.is_deleted) {
      await client.query(
        `UPDATE clients.clients SET is_deleted = FALSE, updated_at = NOW()
         WHERE id = $1`,
        [row.id],
      );
    }
    return row.id;
  }

  const res = await client.query<{ id: string }>(
    `WITH ins AS (
       INSERT INTO clients.clients (company_id, phone, full_name, source)
         VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, phone) DO NOTHING
       RETURNING id
     )
     SELECT id FROM ins
     UNION ALL
     SELECT id FROM clients.clients WHERE company_id = $1 AND phone = $2
     LIMIT 1`,
    [companyId, norm, fullName, source],
  );
  return res.rows[0]?.id ?? null;
}
