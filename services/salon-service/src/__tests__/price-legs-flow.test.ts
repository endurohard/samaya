import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

// Подменяем только хранилище: разбор реплик, переходы и прайс настоящие.
const store = vi.hoisted(() => ({ row: null as any }));
vi.mock('../db', () => ({ pool: { query: async (sql: string, p: any[]) => {
  if (sql.includes('FROM ai.price_dialog')) return { rows: store.row ? [{ ...store.row,
    fresh: Date.now() - store.row.updated_at.getTime() < 24 * 3600_000 }] : [] };
  if (sql.includes('INSERT INTO ai.price_dialog')) {
    const old = store.row;
    store.row = { city: p[3], weight: p[4], zones: p[5], armpits: p[6],
      pubis_belly: p[7], quoted_at: p[8], asked_at: p[9], confirm_asked_at: p[10],
      prior_city: p[3] ?? old?.prior_city, prior_weight: p[4] ?? old?.prior_weight,
      updated_at: new Date() };
  }
  return { rows: [] };
} } }));
import { handleMessage } from '../ai/price-dialog';
const say = (text: string, fresh = false) => handleMessage({ companyId: 'test', channel: 'test', threadId: 'legs', text, fresh });
beforeEach(() => { store.row = null; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T12:00:00Z')); });
afterEach(() => vi.useRealTimers());

// it.izberbash 6 ноября: «Здравствуйте» + «Цена лл ног» — бот без
// приветствия сразу прислал фото и обе цены. Владелец: сначала узнать город,
// потом назвать цену этого города.
describe('ноги: сначала город, потом цена его города', () => {
  it('город не назван — вопрос о городе с приветствием, без цены', async () => {
    const out = await say('Здравствуйте\nЦена лл ног', true);
    expect(out.kind).toBe('ask');
    expect(out.reply).toMatch(/^Здравствуйте/);
    expect(out.reply).toContain('город');
    expect(out.reply).not.toMatch(/₽/);
  });
  it('ответ «Каспийск» — цена Каспийска, без повторного приветствия', async () => {
    await say('Здравствуйте\nЦена лл ног', true);
    const out = await say('Каспийск');
    expect(out.kind).toBe('quote');
    expect(out.reply).toContain('700 000 ₽');
    expect(out.reply).not.toContain('800 000');
    expect(out.greeting).toBeFalsy();
  });
  it('город назван сразу — цена и приветствие для первого ответа', async () => {
    const out = await say('Ноги Москва', true);
    expect(out.kind).toBe('quote');
    expect(out.reply).toContain('800 000 ₽');
    expect(out.greeting).toMatch(/^Здравствуйте/);
  });
});
