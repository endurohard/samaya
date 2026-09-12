import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('connect', (client) => {
  // Неквалифицированные имена резолвятся в telephony; clients.clients и
  // salons.masters всегда указываем явно.
  void client.query('SET search_path TO telephony, public');
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] pool error', err);
});
