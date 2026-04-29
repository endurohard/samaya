import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});


pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] pool error', err);
});
