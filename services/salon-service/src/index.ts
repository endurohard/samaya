import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config';
import { pool } from './db';
import { errorHandler, authenticate, requirePermission } from './middleware';
import type { Request, Response, NextFunction } from 'express';
import categoriesRoutes from './routes/categories';
import servicesRoutes from './routes/services';
import mastersRoutes from './routes/masters';
import scheduleRoutes from './routes/schedule';
import publicRoutes from './routes/public';
import companyRoutes from './routes/company';
import templatesRoutes from './routes/templates';

const log = pino({ level: config.LOG_LEVEL });

const app = express();
app.set('trust proxy', true);
app.use(helmet());
app.use(express.json({ limit: '500kb' }));
app.use(pinoHttp({ logger: log }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'salon-service' });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

// Public routes — без auth (для виджета записи)
app.use('/api/salons/public', publicRoutes);

// RBAC (фаза 2): гейт по методу — GET=viewKey, изменения=writeKeys. owner всегда.
const gate = (viewKey: string, ...writeKeys: string[]) =>
  (req: Request, res: Response, next: NextFunction) =>
    (req.method === 'GET' ? requirePermission(viewKey) : requirePermission(...writeKeys))(req, res, next);
// company GET открыт (профиль/виджет), PUT — settings.manage
const companyGate = (req: Request, res: Response, next: NextFunction) =>
  (req.method === 'GET' ? (_r: Request, _s: Response, n: NextFunction) => n() : requirePermission('settings.manage'))(req, res, next);

// Auth-protected routes
app.use('/api/salons/categories', authenticate, gate('services.view', 'services.manage'), categoriesRoutes);
app.use('/api/salons/services', authenticate, gate('services.view', 'services.manage'), servicesRoutes);
app.use('/api/salons/schedule', authenticate, gate('schedule.view', 'schedule.edit'), scheduleRoutes);   // /:masterId
app.use('/api/salons/masters', mastersRoutes);   // без гейта: список мастеров нужен во всех разделах (запись/журнал), запись — role-gated
app.use('/api/salons/company', authenticate, companyGate, companyRoutes);
app.use('/api/salons/schedule-templates', authenticate, gate('schedule.view', 'schedule.edit'), templatesRoutes);

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  log.info({ port: config.PORT, env: config.NODE_ENV }, 'salon-service listening');
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
