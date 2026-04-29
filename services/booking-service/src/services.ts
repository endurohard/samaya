import type { PoolClient } from 'pg';
import { pool } from './db';
import { config } from './config';
import { HttpError } from './middleware';

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
export function toCompanyTime(date: string, time: string): Date {
  const t = time.length === 5 ? `${time}:00` : time;
  return new Date(`${date}T${t}${config.COMPANY_TZ_OFFSET}`);
}
