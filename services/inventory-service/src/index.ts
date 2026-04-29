import express from 'express';
import helmet from 'helmet';
import pino from 'pino';
import pinoHttp from 'pino-http';
import { config } from './config';
import { pool } from './db';
import { errorHandler } from './middleware';
import productsRoutes from './routes/products';
import suppliersRoutes from './routes/suppliers';
import warehousesRoutes from './routes/warehouses';
import receiptsRoutes from './routes/receipts';
import stockRoutes from './routes/stock';
import techCardsRoutes from './routes/tech-cards';
import { startConsumeWorker } from './worker';

const log = pino({ level: config.LOG_LEVEL });

const app = express();
app.set('trust proxy', true);
app.use(helmet());
app.use(express.json({ limit: '500kb' }));
app.use(pinoHttp({ logger: log }));

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.json({ ok: true, service: 'inventory-service' });
  } catch {
    return res.status(500).json({ ok: false });
  }
});

app.use('/api/inventory/products', productsRoutes);
app.use('/api/inventory/suppliers', suppliersRoutes);
app.use('/api/inventory/warehouses', warehousesRoutes);
app.use('/api/inventory/receipts', receiptsRoutes);
app.use('/api/inventory/stock', stockRoutes);
app.use('/api/inventory/tech-cards', techCardsRoutes);

app.use(errorHandler);

const server = app.listen(config.PORT, () => {
  log.info({ port: config.PORT, env: config.NODE_ENV }, 'inventory-service listening');
});

const workerHandle = startConsumeWorker(log);

const shutdown = (signal: string) => {
  log.info({ signal }, 'shutting down');
  if (workerHandle) clearInterval(workerHandle);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
