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

// Решение владельца (6 ноября): на вопрос про ноги — схемы, текст про 7 зон
// и сразу цена КРУГОВОЙ, без вопроса о городе. Вес для ног не нужен, а город
// неизвестен — называем обе цены, клиент сам видит свою.
describe('ноги: цена круговой сразу', () => {
  it('город не назван — цена по обоим городам, без вопросов', async () => {
    const out = await say('Сколько стоит ноги сделать ?', true);
    expect(out.kind).toBe('quote');
    expect(out.reply).toContain('Каспийск');
    expect(out.reply).toContain('Москва');
    expect(out.reply).toMatch(/Каспийск[^\n]*700 000 ₽/);
    expect(out.reply).toMatch(/Москва[^\n]*800 000 ₽/);
    expect(out.reply).not.toMatch(/Какой город|Ваш вес/);
    expect(out.state?.zones).toEqual(['legs_circular']);
  });

  it('город назван — цена только его', async () => {
    const out = await say('Липосакция ног Москва', true);
    expect(out.kind).toBe('quote');
    expect(out.reply).toContain('800 000 ₽');
    expect(out.reply).not.toContain('700 000');
  });

  it('вернувшийся клиент не получает «Всё верно?» — сразу обе цены', async () => {
    await say('Живот Москва 65 кг', true);
    vi.advanceTimersByTime(25 * 3600_000);
    const out = await say('Ноги', true);
    expect(out.kind).toBe('quote');
    expect(out.reply).not.toContain('Всё верно');
    expect(out.reply).toMatch(/Каспийск[^\n]*700 000 ₽/);
  });

  it('после обеих цен клиент называет город — цена его города', async () => {
    await say('Сколько стоит липосакция ног?', true);
    const out = await say('Каспийск');
    expect(out.kind).toBe('quote');
    expect(out.reply).toContain('700 000 ₽');
    expect(out.reply).not.toContain('800 000');
  });

  it('ноги вместе с весовой зоной — обычный опрос', async () => {
    const out = await say('Ноги и живот', true);
    expect(out.kind).toBe('ask');
  });
});
