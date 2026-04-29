import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('connect', (client) => {
  // finance — наша схема. users — для resolve created_by_user_id.
  void client.query("SET search_path TO finance, users, public");
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] pool error', err);
});
