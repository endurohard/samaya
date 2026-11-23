// Клиент вернулся с новым вопросом — бот помнит его город (и вес, если он
// нужен для расчёта) и не спрашивает всё заново, а уточняет: «В прошлый раз
// вы указывали: город — Москва. Всё верно?». «Да» — считаем по прежним,
// «нет, Каспийск» — по новым. Проверка владельца 23 ноября, вместе с
// правилом «части ног = ноги целиком».
//
// Мок повторяет SQL loadState/saveState: живое состояние живёт сутки
// (fresh), снимок города/веса (prior_*) — неделю и пополняется только
// непустыми значениями.
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';

const store = vi.hoisted(() => ({ row: null as any }));
const HOUR = 3600_000;
vi.mock('../db', () => ({ pool: { query: async (sql: string, p: any[]) => {
  if (sql.includes('FROM ai.price_zones')) {
    return { rows: [
      { zone_key: 'belly', title: 'живот', by_weight: true, price_kaspiysk: null, price_moscow: null, note: null },
      { zone_key: 'legs_circular', title: 'круговая липосакция ног (от колен и выше)', by_weight: false, price_kaspiysk: 700000, price_moscow: 800000, note: null },
      { zone_key: 'galife', title: 'галифе', by_weight: false, price_kaspiysk: 250000, price_moscow: 300000, note: null },
    ] };
  }
  if (sql.includes('FROM ai.price_steps')) {
    return { rows: [
      { zone_key: 'belly', max_weight: 75, price_kaspiysk: 250000, price_moscow: 350000 },
      { zone_key: 'belly', max_weight: null, price_kaspiysk: 300000, price_moscow: 400000 },
    ] };
  }
  if (sql.includes('FROM ai.price_dialog')) {
    const r = store.row;
    if (!r) return { rows: [] };
    const now = Date.now();
    const priorOk = r.prior_at && now - r.prior_at.getTime() < 7 * 24 * HOUR;
    return { rows: [{ ...r,
      prior_city: priorOk ? r.prior_city : null, prior_weight: priorOk ? r.prior_weight : null,
      fresh: now - r.updated_at.getTime() < 24 * HOUR }] };
  }
  if (sql.includes('INSERT INTO ai.price_dialog')) {
    const old = store.row ?? {};
    const filled = p[3] != null || p[4] != null;
    store.row = { city: p[3], weight: p[4], zones: p[5], armpits: p[6], pubis_belly: p[7],
      quoted_at: p[8], asked_at: p[9], confirm_asked_at: p[10],
      prior_city: p[3] ?? old.prior_city ?? null, prior_weight: p[4] ?? old.prior_weight ?? null,
      prior_at: filled ? new Date() : (old.prior_at ?? null), updated_at: new Date() };
  }
  return { rows: [] };
} } }));
import { handleMessage } from '../ai/price-dialog';
const say = (text: string, fresh = false) => handleMessage({ companyId: 'test', channel: 'test', threadId: 'ret', text, fresh });

beforeEach(() => { store.row = null; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-20T10:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('возврат клиента: прежние данные подтверждаются, а не спрашиваются заново', () => {
  it('ноги → через 2 дня «а галифе?» → «город Москва, верно?» → «да» → цена ног в Москве', async () => {
    expect((await say('Москва ноги', true)).reply).toContain('800 000');
    vi.advanceTimersByTime(48 * HOUR);
    const ask = await say('Здравствуйте, а галифе сколько стоит?', true);
    expect(ask.kind).toBe('ask');
    expect(ask.reply).toContain('Москва');
    expect(ask.reply).not.toContain('вес');           // для ног вес не нужен
    const out = await say('да');
    expect(out.kind).toBe('quote');
    expect(out.state?.zones).toEqual(['legs_circular']);
    expect(out.reply).toContain('800 000');
  });

  it('«нет, теперь Каспийск» — считает по новому городу', async () => {
    await say('Москва ноги', true);
    vi.advanceTimersByTime(48 * HOUR);
    await say('сколько стоят голени?', true);
    const out = await say('нет, Каспийск');
    expect(out.kind).toBe('quote');
    expect(out.reply).toContain('700 000');
  });

  it('весовая зона: подтверждаются и город, и вес', async () => {
    expect((await say('Москва 70 кг живот', true)).reply).toContain('350 000');
    vi.advanceTimersByTime(30 * HOUR);
    const ask = await say('а живот сколько?', true);
    expect(ask.kind).toBe('ask');
    expect(ask.reply).toContain('Москва');
    expect(ask.reply).toContain('70 кг');
    const out = await say('всё верно');
    expect(out.kind).toBe('quote');
    expect(out.reply).toContain('350 000');
  });

  it('вернулась через 2 часа в тот же день — тоже подтверждение, а не опрос с нуля', async () => {
    await say('Каспийск ноги', true);
    vi.advanceTimersByTime(2 * HOUR);
    const ask = await say('Сколько стоит липосакция внутренней части бедра?', true);
    expect(ask.kind).toBe('ask');
    expect(ask.reply).toContain('Каспийск');
    expect((await say('+')).reply).toContain('700 000');
  });

  it('через 8 дней прежние данные забыты — обычный вопрос о городе', async () => {
    await say('Москва ноги', true);
    vi.advanceTimersByTime(8 * 24 * HOUR);
    const ask = await say('сколько стоят ноги?', true);
    expect(ask.kind).toBe('ask');
    expect(ask.reply).toContain('Какой город');
    expect(ask.reply).not.toContain('В прошлый раз');
  });
});
