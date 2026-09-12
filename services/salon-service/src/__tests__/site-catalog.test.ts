// Публичные страницы каталога по ссылке (/c/<token>): рендер списка, страницы
// услуги внутри каталога и 404 по выключенной/чужой ссылке. БД замокана.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';

const COMPANY = '00000000-0000-0000-0000-000000000001';
const TOKEN = 'abcdefghijklmnop';
const catalog = { id: 'cat-1', name: 'Уход для Марины', description: 'Подобрали по итогам консультации', token: TOKEN };
const services = [
  { id: 's-1', name: 'Чистка лица', slug: 'chistka-lica', description: 'Глубокая чистка', price: 3500, duration_minutes: 60, color: null, image_path: null, video_path: null, preview_enabled: false, category_name: 'Уход' },
  { id: 's-2', name: 'Пилинг', slug: null, description: null, price: 4000, duration_minutes: 45, color: null, image_path: null, video_path: null, preview_enabled: false, category_name: null },
];

const query = vi.fn(async (sql: string, params: unknown[]) => {
  if (sql.includes('FROM salons.service_catalogs') && sql.includes('token = $2')) {
    return { rows: params[1] === TOKEN && params[0] === COMPANY ? [catalog] : [] };
  }
  if (sql.includes('FROM salons.service_catalog_items')) return { rows: services };
  if (sql.startsWith('UPDATE salons.service_catalogs SET views')) return { rows: [] };
  return { rows: [] };
});
vi.mock('../db', () => ({ pool: { query: (...a: unknown[]) => query(a[0] as string, a[1] as unknown[]) } }));

let server: Server; let base = '';
beforeAll(async () => {
  const { default: siteRoutes } = await import('../routes/site');
  const app = express();
  app.use('/api/salons/public/site', siteRoutes);
  await new Promise<void>((r) => { server = app.listen(0, () => r()); });
  const addr = server.address() as { port: number };
  base = `http://127.0.0.1:${addr.port}/api/salons/public/site`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

describe('public catalog pages', () => {
  it('renders catalog list with services and marks it noindex', async () => {
    const res = await fetch(`${base}/c/${TOKEN}?company_id=${COMPANY}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const html = await res.text();
    expect(html).toContain('Уход для Марины');
    expect(html).toContain('Подобрали по итогам консультации');
    expect(html).toContain(`href="/c/${TOKEN}/chistka-lica"`);
    expect(html).toContain(`href="/c/${TOKEN}/s-2"`); // без slug — по id
    expect(html).toMatch(/2 процедуры · от 3.500 ₽/); // Intl ставит между разрядами узкий пробел
    // Счётчик открытий инкрементится
    expect(query.mock.calls.some(([sql]) => String(sql).includes('SET views = views + 1'))).toBe(true);
  });

  it('renders a service page inside the catalog with back link and related', async () => {
    const res = await fetch(`${base}/c/${TOKEN}/chistka-lica?company_id=${COMPANY}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<h1>Чистка лица</h1>');
    expect(html).toContain(`href="/c/${TOKEN}">← Назад к «Уход для Марины»`);
    expect(html).toContain('Ещё из «Уход для Марины»');
    expect(html).toContain('Пилинг');
  });

  it('404 for unknown service key inside catalog', async () => {
    const res = await fetch(`${base}/c/${TOKEN}/nope?company_id=${COMPANY}`);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('Услуга не найдена');
  });

  it('404 for unknown or malformed token without touching the DB', async () => {
    query.mockClear();
    const bad = await fetch(`${base}/c/short?company_id=${COMPANY}`);
    expect(bad.status).toBe(404);
    expect(query).not.toHaveBeenCalled();
    const unknown = await fetch(`${base}/c/zzzzzzzzzzzzzzzz?company_id=${COMPANY}`);
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain('Каталог не найден');
  });
});
