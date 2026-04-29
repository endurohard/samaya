import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import authRoutes from './auth.routes';
import { authenticate, errorHandler } from './middleware';
import { config } from './config';
import { pool } from './db';

const log = pino({ level: config.LOG_LEVEL });

const app = express();
app.set('trust proxy', true); // за Kong'ом — берём X-Forwarded-For
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(pinoHttp({ logger: log }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'user-service' });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

app.use('/api/auth', authRoutes);

app.get('/api/auth/me', authenticate, (req, res) => {
  return res.json({ auth: req.auth });
});

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  log.info({ port: config.PORT, env: config.NODE_ENV }, 'user-service listening');
});

const shutdown = (signal: string) => {
  log.info({ signal }, 'shutting down');
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
