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
const say = (text: string, fresh = false) => handleMessage({ companyId: 'test', channel: 'test', threadId: 'sequence', text, fresh });
beforeEach(() => { store.row = null; vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-02T16:13:00Z')); });
afterEach(() => vi.useRealTimers());

describe('последовательности ценового диалога', () => {
  it('ноги → холка: две фиксированные зоны без веса и без общей суммы', async () => {
    const legs = await say('Ноги Каспийск', true);
    expect(legs.kind).toBe('quote');
    const holka = await say('Холка', true);
    expect(holka.kind).toBe('quote');
    expect(holka.state?.zones).toEqual(['holka']);
    expect(holka.state?.weight).toBeNull();
    expect(holka.reply).not.toContain('Итого');
  });
  it('фиксированная → весовая → вес → фиксированная', async () => {
    await say('Холка Каспийск', true);
    const belly = await say('Живот', true);
    expect(belly.kind).toBe('ask');
    expect(belly.state?.city).toBe('kaspiysk');
    expect(belly.reply).toContain('вес');
    expect((await say('65')).kind).toBe('quote');
    const chin = await say('Подбородок', true);
    expect(chin.kind).toBe('quote');
    expect(chin.state?.zones).toEqual(['chin']);
  });
  it('смена города в живом разговоре пересчитывает ту же зону и вес', async () => {
    const first = await say('Живот Москва 65 кг', true);
    const second = await say('А в Каспийске?');
    expect(second.kind).toBe('quote');
    expect(second.state?.weight).toBe(65);
    expect(second.state?.zones).toEqual(first.state?.zones);
    expect(second.reply).not.toBe(first.reply);
  });
  it('новая зона после паузы требует город заново', async () => {
    await say('Холка Каспийск', true);
    vi.advanceTimersByTime(31 * 60_000);
    const out = await say('А липосакция рук?', true);
    expect(out.kind).toBe('ask');
    expect(out.state?.city).toBeNull();
    expect(out.state?.zones).toEqual(['arms']);
    expect(out.state?.confirmAskedAt).toBeTruthy();
    expect((await say('Каспийск')).state?.city).toBe('kaspiysk');
  });
  it('после суток ноги — сразу цена круговой без «Всё верно?», вес не переносится', async () => {
    await say('Живот Москва 65 кг', true);
    vi.advanceTimersByTime(25 * 3600_000);
    const out = await say('Ноги', true);
    // Решение владельца 6 ноября: на ноги сразу цена по обоим городам.
    expect(out.kind).toBe('quote');
    expect(out.state?.confirmAskedAt).toBeFalsy();
    expect(out.reply).not.toContain('65');
    expect(out.state?.zones).toEqual(['legs_circular']);
    const weighted = await say('Живот', true);
    expect(weighted.kind).toBe('ask');
    expect(weighted.state?.weight).toBeNull();
  });
  it('после паузы смена города не использует прежний вес молча', async () => {
    expect((await say('Живот Москва 65 кг', true)).kind).toBe('quote');
    vi.advanceTimersByTime(31 * 60_000);
    const out = await say('А в Каспийске?');
    expect(out.kind).toBe('ask');
    expect(out.state?.weight).toBeNull();
    expect(out.state?.city).toBe('kaspiysk');
  });
  it('холка → Каспийск → руки: город остаётся, новая зона заменяет холку', async () => {
    expect((await say('Холка', true)).kind).toBe('ask');
    expect((await say('Каспийск')).kind).toBe('quote');
    vi.advanceTimersByTime(2 * 60_000);
    const out = await say('А липосакция рук?', true);
    expect(out.state?.city).toBe('kaspiysk');
    expect(out.state?.zones).toEqual(['arms']);
    expect(out.reply).not.toContain('Какой город');
  });
});

// 4 ноября: клиентка получила цену круговой и галифе и переспросила «То есть
// даже с небольшим весом цена 700?». Классификатор снова увидел вопрос о
// цене, опрос начался с нуля, и бот спросил город, который она назвала
// минуту назад, а затем «Какая зона вас интересует?». Решение владельца:
// нет готового ответа в шаблоне — передаём менеджеру.
describe('вопрос по только что названной цене', () => {
  it('уточнение без новых данных уходит администратору, а не в опрос с нуля', async () => {
    expect((await say('Круговая бедер и отдельно галифе. Вес 54', true)).kind).toBe('ask');
    expect((await say('Каспийск')).kind).toBe('quote');
    vi.advanceTimersByTime(2 * 60_000);
    const out = await say('То есть даже с небольшим весом цена 700?', true);
    expect(out.kind).toBe('handover');
    expect(out.reply).toBeNull();
  });
  it('новый вес после цены пересчитывает ту же зону без повторного опроса', async () => {
    expect((await say('Живот Москва 65 кг', true)).kind).toBe('quote');
    vi.advanceTimersByTime(2 * 60_000);
    const out = await say('а если будет 80 кг?', true);
    expect(out.kind).toBe('quote');
    expect(out.state?.city).toBe('moscow');
    expect(out.state?.weight).toBe(80);
    expect(out.state?.zones).toEqual(['belly']);
  });
  it('через сутки тот же общий вопрос — снова новый расчёт', async () => {
    expect((await say('Живот Москва 65 кг', true)).kind).toBe('quote');
    vi.advanceTimersByTime(25 * 3600_000);
    expect((await say('Сколько стоит липосакция?', true)).kind).toBe('ask');
  });
});
