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

export type AuditAction = 'created' | 'updated' | 'canceled' | 'completed' | 'no_show';

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
    // Даты сравниваем по значению момента, а не по строковому виду.
    const norm = (v: unknown) =>
      v instanceof Date ? v.getTime() : typeof v === 'number' ? Number(v) : v ?? null;
    if (norm(a) !== norm(b)) changes[f] = { from: a ?? null, to: b ?? null };
  }
  return changes;
}
