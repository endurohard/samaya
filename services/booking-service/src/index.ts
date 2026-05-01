import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config';
import { pool } from './db';
import { errorHandler } from './middleware';
import bookingsRoutes from './routes/bookings';
import promosRoutes from './routes/promos';
import slotsRoutes from './routes/slots';
import publicRoutes from './routes/public';
import { startReminderScheduler } from './reminders';

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
app.use('/api/bookings', bookingsRoutes);

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  log.info({ port: config.PORT, env: config.NODE_ENV, tz: config.COMPANY_TZ_OFFSET }, 'booking-service listening');
  startReminderScheduler();
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
