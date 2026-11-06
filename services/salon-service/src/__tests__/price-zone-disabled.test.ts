// Бот называет цены только по действующему прайсу владельца. Зона, которой
// в прайсе нет (выключена в ai.price_zones), — это разговор с
// администратором. Раньше расчёт молча пропускал такую зону, и на «живот и
// внутренняя поверхность» клиент получил бы цену одного живота как ответ на
// оба вопроса.
import { beforeEach, describe, it, expect, vi } from 'vitest';

const store = vi.hoisted(() => ({ row: null as any }));
vi.mock('../db', () => ({ pool: { query: async (sql: string, p: any[]) => {
  if (sql.includes('FROM ai.price_zones')) {
    // Действующий прайс без внутренней поверхности ног.
    return { rows: [
      { zone_key: 'belly', title: 'живот', by_weight: true, price_kaspiysk: null, price_moscow: null, note: null },
      { zone_key: 'galife', title: 'галифе', by_weight: false, price_kaspiysk: 250000, price_moscow: 300000, note: null },
    ] };
  }
  if (sql.includes('FROM ai.price_steps')) {
    return { rows: [
      { zone_key: 'belly', max_weight: 75, price_kaspiysk: 250000, price_moscow: 350000 },
      { zone_key: 'belly', max_weight: null, price_kaspiysk: 300000, price_moscow: 400000 },
    ] };
  }
  if (sql.includes('FROM ai.price_dialog')) return { rows: store.row ? [{ ...store.row, fresh: true }] : [] };
  if (sql.includes('INSERT INTO ai.price_dialog')) {
    store.row = { city: p[3], weight: p[4], zones: p[5], armpits: p[6], pubis_belly: p[7],
      quoted_at: p[8], asked_at: p[9], confirm_asked_at: p[10], updated_at: new Date() };
  }
  return { rows: [] };
} } }));
import { handleMessage } from '../ai/price-dialog';
const say = (text: string, fresh = false) => handleMessage({ companyId: 'test', channel: 'test', threadId: 'off', text, fresh });
beforeEach(() => { store.row = null; });

describe('зона, которой нет в действующем прайсе', () => {
  it('сразу передаётся администратору, без вопросов о городе', async () => {
    const out = await say('Внутренняя поверхность бедра', true);
    expect(out.kind).toBe('handover');
  });
  it('вместе с зоной из прайса — тоже администратору, а не половина цены', async () => {
    const out = await say('Москва 70 кг живот и внутренняя поверхность бедра', true);
    expect(out.kind).toBe('handover');
  });
  it('зона из прайса считается как обычно', async () => {
    const out = await say('Москва галифе', true);
    expect(out.kind).toBe('quote');
    expect(out.reply).toContain('300 000');
  });
});
