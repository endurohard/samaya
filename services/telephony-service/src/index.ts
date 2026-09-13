import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import callsRoutes from './routes/calls';
import extensionsRoutes from './routes/extensions';
import streamRoutes from './routes/stream';
import { authenticate, errorHandler } from './middleware';
import { config } from './config';
import { pool } from './db';
import { startSyncWorker, runSyncOnce } from './sync';
import { startEvents, stopEvents } from './events';

const log = pino({ level: config.LOG_LEVEL });

const app = express();
app.set('trust proxy', true);
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger: log }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'telephony-service' });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

// Права проверяются по месту (журнал — telephony.view, запись — telephony.listen,
// привязка — telephony.manage): прослушивание доступно уже́ не всем, кому открыт
// список звонков.
app.use('/api/telephony', authenticate, callsRoutes);
app.use('/api/telephony', authenticate, extensionsRoutes);
// Поток событий живьём — всплывающая карточка входящего у администратора.
app.use('/api/telephony', authenticate, streamRoutes);

// Ручной прогон синхронизации: кнопка «обновить» в интерфейсе, когда ждать
// очередной цикл некогда.
app.post('/api/telephony/sync', authenticate, async (req, res) => {
  if (req.auth!.role !== 'owner' && req.auth!.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  await runSyncOnce(log);
  return res.json({ ok: true });
});

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  log.info({ port: config.PORT, env: config.NODE_ENV }, 'telephony-service listening');
  startSyncWorker(log);
  startEvents(log);
});

const shutdown = (signal: string) => {
  log.info({ signal }, 'shutting down');
  stopEvents();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
