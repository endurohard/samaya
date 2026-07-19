import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config';
import { pool } from './db';
import { errorHandler, authenticate, requirePermission } from './middleware';
import bookingsRoutes from './routes/bookings';
import promosRoutes from './routes/promos';
import slotsRoutes from './routes/slots';
import publicRoutes from './routes/public';
import timeBlocksRoutes from './routes/time-blocks';
import { startReminderScheduler } from './reminders';
import { startNotificationWorker } from './notification-outbox';

const log = pino({ level: config.LOG_LEVEL });

const app = express();
app.set('trust proxy', true);
app.use(helmet());
app.use(express.json({ limit: '500kb' }));
app.use(pinoHttp({ logger: log }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'booking-service' });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

// Public (без auth)
app.use('/api/bookings/slots', slotsRoutes);
app.use('/api/bookings/public', publicRoutes);

// Auth-protected
app.use('/api/bookings/promos', promosRoutes);

// RBAC (фаза 2): гейт на staff-роуты записей. req.path — относительный к /api/bookings.
// Аналитика/отчёты → analytics.view; просмотр записей → bookings.view; изменения → права записей.
// owner всегда; публичные /slots и /public смонтированы выше и сюда не попадают.
app.use('/api/bookings', authenticate, (req, res, next) => {
  const p = req.path;
  const isAnalytics = p.startsWith('/analytics') || p === '/sales' || p === '/retention' || p === '/reviews';
  if (isAnalytics) return requirePermission('analytics.view')(req, res, next);
  if (req.method === 'GET') return requirePermission('bookings.view')(req, res, next);
  return requirePermission('bookings.add', 'bookings.edit', 'bookings.cancel', 'bookings.delete')(req, res, next);
});

// Раньше bookingsRoutes — иначе GET /:id перехватил бы /blocks как id записи.
// authenticate и RBAC уже отработали в гейте выше — здесь только маршруты.
app.use('/api/bookings/blocks', timeBlocksRoutes);

app.use('/api/bookings', bookingsRoutes);

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  log.info({ port: config.PORT, env: config.NODE_ENV, tz: config.COMPANY_TZ_OFFSET }, 'booking-service listening');
  startReminderScheduler();
  startNotificationWorker();
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
