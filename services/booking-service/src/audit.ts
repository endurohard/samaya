import type { PoolClient } from 'pg';

/**
 * История изменений записи: кто, когда и что поменял.
 *
 * Пишется в той же транзакции, что и само изменение, — иначе при откате
 * останется запись о правке, которой не было.
 */
export interface AuditActor {
  sub?: string;
  role?: string;
  full_name?: string | null;
}

export type AuditAction = 'created' | 'updated' | 'updated_paid' | 'canceled' | 'completed' | 'no_show';

export async function logBookingChange(
  client: PoolClient,
  companyId: string,
  bookingId: string,
  actor: AuditActor,
  action: AuditAction,
  changes: Record<string, { from: unknown; to: unknown }> = {},
): Promise<void> {
  // Имени в токене нет, поэтому берём его из справочника — и сохраняем снимком:
  // пользователя могут переименовать или удалить, а история должна остаться
  // читаемой («кто менял цену»), а не превратиться в набор UUID.
  await client.query(
    `INSERT INTO bookings.booking_audit
       (company_id, booking_id, actor_id, actor_name, actor_role, action, changes)
     VALUES (
       $1, $2, $3,
       COALESCE($4, (SELECT full_name FROM users.users WHERE id = $3::uuid)),
       $5, $6, $7::jsonb
     )`,
    [
      companyId,
      bookingId,
      actor.sub ?? null,
      actor.full_name ?? null,
      actor.role ?? null,
      action,
      JSON.stringify(changes),
    ],
  );
}

/**
 * Сравнивает старое и новое состояние и возвращает только изменившиеся поля.
 * Без этого история заполняется шумом: «сохранил, ничего не поменяв».
 */
export function diffFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    if (!(f in after) || after[f] === undefined) continue;
    const a = before[f];
    const b = after[f];
    // Даты сравниваем по моменту времени, а числа — по значению: Postgres
    // отдаёт numeric строкой («10000.00»), а расчёт — числом, и без приведения
    // история заполнялась бы правками цены, которых не было.
    const norm = (v: unknown) => {
      if (v instanceof Date) return v.getTime();
      if (v === null || v === undefined) return null;
      if (typeof v === 'number') return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      return v;
    };
    if (norm(a) !== norm(b)) changes[f] = { from: a ?? null, to: b ?? null };
  }
  return changes;
}
