import { Pool } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
});

pool.on('connect', (client) => {
  // Все unqualified имена резолвятся в схеме users этого сервиса.
  // Запросы всё равно лучше писать с префиксом users.<table>, search_path — страховка.
  void client.query("SET search_path TO users, public");
});

pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] pool error', err);
});
