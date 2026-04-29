import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('connect', (client) => {
  // bookings — наша схема. salons — читаем для slots/проверок (cross-schema read,
  // не FK; см. ADR-001). public — для extensions.
  void client.query("SET search_path TO bookings, salons, public");
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] pool error', err);
});
