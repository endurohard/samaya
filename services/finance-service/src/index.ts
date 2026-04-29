import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config';
import { pool } from './db';
import { errorHandler } from './middleware';
import accountsRoutes from './routes/accounts';
import categoriesRoutes from './routes/categories';
import counterpartiesRoutes from './routes/counterparties';
import operationsRoutes from './routes/operations';
import summaryRoutes from './routes/summary';

const log = pino({ level: config.LOG_LEVEL });

const app = express();
app.set('trust proxy', true);
app.use(helmet());
app.use(express.json({ limit: '500kb' }));
app.use(pinoHttp({ logger: log }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'finance-service' });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

// Auth-protected routes (under /api/finance via Kong)
app.use('/api/finance/accounts', accountsRoutes);
app.use('/api/finance/categories', categoriesRoutes);
app.use('/api/finance/counterparties', counterpartiesRoutes);
app.use('/api/finance/operations', operationsRoutes);
app.use('/api/finance/summary', summaryRoutes);

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  log.info({ port: config.PORT, env: config.NODE_ENV }, 'finance-service listening');
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
