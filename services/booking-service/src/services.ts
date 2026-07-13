import type { PoolClient } from 'pg';
import { pool } from './db';
import { config } from './config';
import { HttpError } from './middleware';
import { zonedWallTimeToUtc, zonedLocalDate } from './tz';

export interface ServiceSnapshot {
  id: string;
  name: string;
  price: number;
  duration_minutes: number;
}

/**
 * Загружает услуги по списку id и проверяет, что они принадлежат компании
 * и активны. Возвращает snapshot для записи в booking_services.
 */
export async function loadServiceSnapshots(
  client: PoolClient,
  companyId: string,
  serviceIds: string[],
): Promise<ServiceSnapshot[]> {
  if (serviceIds.length === 0) {
    throw new HttpError(400, 'at least one service required', 'NO_SERVICES');
  }
  const { rows } = await client.query(
    `SELECT id, name, price::float8 AS price, duration_minutes
     FROM salons.services
     WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_active = TRUE
     ORDER BY name`,
    [companyId, serviceIds],
  );
  if (rows.length !== serviceIds.length) {
    throw new HttpError(400, 'some service ids not found or inactive', 'INVALID_SERVICES');
  }
  return rows as ServiceSnapshot[];
}

/**
 * Мастер (role='master') может действовать только со своими записями. Роль master
 * привязана к users.users.id (req.auth.sub) через salons.masters.user_id.
 * Бросает 403, если актор — мастер и masterId не его. Owner/admin проходят.
 */
export async function assertMasterActor(
  client: PoolClient,
  companyId: string,
  role: string,
  userId: string,
  masterId: string,
): Promise<void> {
  if (role !== 'master') return;
  const { rows } = await client.query(
    `SELECT 1 FROM salons.masters
     WHERE company_id = $1 AND id = $2 AND user_id = $3`,
    [companyId, masterId, userId],
  );
  if (!rows[0]) {
    throw new HttpError(403, 'мастер может работать только со своими записями', 'NOT_OWN_MASTER');
  }
}

/**
 * Проверяет, что мастер принадлежит компании и активен.
 */
export async function assertMaster(
  client: PoolClient,
  companyId: string,
  masterId: string,
): Promise<void> {
  const { rows } = await client.query(
    `SELECT id FROM salons.masters
     WHERE company_id = $1 AND id = $2 AND is_active = TRUE`,
    [companyId, masterId],
  );
  if (!rows[0]) throw new HttpError(404, 'master not found or inactive', 'MASTER_NOT_FOUND');
}

/**
 * Объединяет дату YYYY-MM-DD и время HH:MM[:SS] в Date с учётом часового пояса
 * компании (config.COMPANY_TZ_OFFSET, '+03:00' по умолчанию).
 */
// Настенное время компании (дата + время из графика) → UTC-момент.
// При наличии IANA-таймзоны компании используем её (учёт DST), иначе — фиксированный
// офсет из конфига (обратная совместимость / single-salon).
export function toCompanyTime(date: string, time: string, tz?: string | null): Date {
  const t = time.length === 5 ? `${time}:00` : time;
  if (tz) return zonedWallTimeToUtc(date, t, tz);
  return new Date(`${date}T${t}${config.COMPANY_TZ_OFFSET}`);
}

// Смещение компании (например '+03:00') в минутах.
function companyOffsetMinutes(): number {
  const m = /^([+-])(\d{2}):(\d{2})$/.exec(config.COMPANY_TZ_OFFSET);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

// Локальная (в TZ компании) дата YYYY-MM-DD для момента времени.
export function companyLocalDate(instant: Date, tz?: string | null): string {
  if (tz) return zonedLocalDate(instant, tz);
  const shifted = new Date(instant.getTime() + companyOffsetMinutes() * 60_000);
  return shifted.toISOString().slice(0, 10);
}

// IANA-таймзона компании из профиля (напр. 'Europe/Moscow'); null → фиксированный офсет.
export async function getCompanyTimezone(
  client: Pick<PoolClient, 'query'>,
  companyId: string,
): Promise<string | null> {
  const { rows } = await client.query<{ timezone: string | null }>(
    `SELECT timezone FROM salons.company_profile WHERE company_id = $1`,
    [companyId],
  );
  return rows[0]?.timezone ?? null;
}

/**
 * Проверяет, что интервал записи [startsAt, endsAt) лежит в будущем и попадает
 * в рабочий график мастера на этот день (не выходной, в пределах смены).
 * Бросает HttpError при нарушении. Использует ту же TZ, что и генерация слотов.
 */
export async function assertBookingWithinSchedule(
  client: PoolClient,
  companyId: string,
  masterId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<void> {
  if (startsAt.getTime() <= Date.now()) {
    throw new HttpError(400, 'время записи в прошлом', 'PAST_TIME');
  }
  const tz = await getCompanyTimezone(client, companyId);
  const workDate = companyLocalDate(startsAt, tz);
  const schedRes = await client.query(
    `SELECT start_time::text AS start_time, end_time::text AS end_time, is_day_off
     FROM salons.master_schedules
     WHERE company_id = $1 AND master_id = $2 AND work_date = $3::date`,
    [companyId, masterId, workDate],
  );
  const sched = schedRes.rows[0] as { start_time: string; end_time: string; is_day_off: boolean } | undefined;
  if (!sched || sched.is_day_off) {
    throw new HttpError(400, 'мастер не работает в это время', 'OUTSIDE_SCHEDULE');
  }
  const dayStart = toCompanyTime(workDate, sched.start_time, tz);
  const dayEnd = toCompanyTime(workDate, sched.end_time, tz);
  if (startsAt < dayStart || endsAt > dayEnd) {
    throw new HttpError(400, 'время записи вне рабочего графика мастера', 'OUTSIDE_SCHEDULE');
  }
}
