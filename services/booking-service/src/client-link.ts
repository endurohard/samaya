import type { PoolClient } from 'pg';

// Нормализуем телефон до цифр + ведущий + (та же логика, что в client-service):
// '+7 (928) 188-98-54' → '+79281889854'. Гарантирует, что один и тот же номер,
// введённый по-разному, привязывается к одной карточке клиента.
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus ? `+${digits}` : digits;
}

// Найти-или-создать карточку клиента по телефону в рамках компании и вернуть её id.
// Запись привязывается к клиенту (client_id), т.к. лицевой счёт/предоплата и история
// живут на карточке клиента. Существующую карточку не трогаем — только берём id.
export async function findOrCreateClientId(
  client: PoolClient,
  companyId: string,
  phone: string | null | undefined,
  name: string | null | undefined,
  source: 'admin' | 'public_widget',
): Promise<string | null> {
  if (!phone) return null;
  const norm = normalizePhone(phone);
  if (!norm || norm === '+') return null;
  const fullName = (name && name.trim()) || 'Клиент';
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
