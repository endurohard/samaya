import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config';
import { pool } from './db';
import { errorHandler, authenticate, requirePermission } from './middleware';
import schemesRoutes from './routes/schemes';
import calculateRoutes from './routes/calculate';
import accrualsRoutes from './routes/accruals';
import settlementsRoutes from './routes/settlements';
import payoutsRoutes from './routes/payouts';
import commissionsRoutes from './routes/commissions';

const log = pino({ level: config.LOG_LEVEL });

const app = express();
app.set('trust proxy', true);
app.use(helmet());
app.use(express.json({ limit: '500kb' }));
app.use(pinoHttp({ logger: log }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'salary-service' });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

// RBAC (фаза 2): просмотр — salary.view, изменения — salary.manage. owner всегда.
app.use('/api/salary', authenticate, (req, res, next) => {
  const key = req.method === 'GET' ? 'salary.view' : 'salary.manage';
  return requirePermission(key)(req, res, next);
});

app.use('/api/salary/schemes', schemesRoutes);
app.use('/api/salary/calculate', calculateRoutes);
app.use('/api/salary/accruals', accrualsRoutes);
app.use('/api/salary/settlements', settlementsRoutes);
app.use('/api/salary/payouts', payoutsRoutes);
app.use('/api/salary/commissions', commissionsRoutes);

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  log.info({
    port: config.PORT,
    env: config.NODE_ENV,
    booking_svc: config.BOOKING_SERVICE_URL,
    finance_svc: config.FINANCE_SERVICE_URL,
  }, 'salary-service listening');
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
