// Решение владельца 23 ноября: ноги отвечаются ОДНИМ ответом — две схемы,
// текст про 7 зон и цена круговой. Отдельные части ног (галифе, внутренняя
// поверхность бедра, голень, колени) бот больше не считает отдельными
// строками: 4 ноября клиентка на «галифе и внутренняя часть бедер» получила
// «внутренняя 300 000 + круговая 700 000 + галифе 250 000, итого 1 250 000» —
// а клиника по своей методике работает комплексно, все 7 зон сразу.
import { beforeEach, describe, it, expect, vi } from 'vitest';

const store = vi.hoisted(() => ({ row: null as any }));
vi.mock('../db', () => ({ pool: { query: async (sql: string, p: any[]) => {
  if (sql.includes('FROM ai.price_zones')) {
    // Боевой прайс: внутренняя поверхность выключена, галифе и голень есть.
    return { rows: [
      { zone_key: 'belly', title: 'живот', by_weight: true, price_kaspiysk: null, price_moscow: null, note: null },
      { zone_key: 'legs_circular', title: 'круговая липосакция ног (от колен и выше)', by_weight: false, price_kaspiysk: 700000, price_moscow: 800000, note: null },
      { zone_key: 'galife', title: 'галифе', by_weight: false, price_kaspiysk: 250000, price_moscow: 300000, note: null },
      { zone_key: 'shin', title: 'голень (круговая)', by_weight: false, price_kaspiysk: 350000, price_moscow: 600000, note: null },
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
import { foldLegParts, parsePriceZones } from '../ai/price';
const say = (text: string, fresh = false) => handleMessage({ companyId: 'test', channel: 'test', threadId: 'legs', text, fresh });
beforeEach(() => { store.row = null; });

describe('отдельные части ног отвечаются как ноги целиком', () => {
  it.each([
    'Москва галифе',
    'Москва, внутренняя поверхность бедра',
    'Москва. Голени.',
    'Москва, ноги, колени',
    'И ноги тоже хотела узнать в Москве зона галифе,и внутренняя часть бедер',
    'Москва бедра и голени',
  ])('%j → только круговая, 800 000', async t => {
    const out = await say(t, true);
    expect(out.kind).toBe('quote');
    expect(out.state?.zones).toEqual(['legs_circular']);
    expect(out.reply).toContain('800 000');
    expect(out.reply).not.toMatch(/галифе|голень|внутренн|Итого/i);
  });

  it('часть ноги вместе с другой зоной: живот + круговая, без галифе', async () => {
    const out = await say('Москва 70 кг живот и галифе', true);
    expect(out.kind).toBe('quote');
    expect([...(out.state?.zones ?? [])].sort()).toEqual(['belly', 'legs_circular']);
    expect(out.reply).not.toMatch(/галифе/i);
  });

  it('без города — обычный вопрос о городе, а не передача администратору', async () => {
    const out = await say('Сколько стоит липосакция внутренней части бедра?', true);
    expect(out.kind).toBe('ask');
    expect(out.state?.zones).toEqual(['legs_circular']);
  });

  it('старое состояние диалога с галифе тоже считается как ноги', async () => {
    store.row = { city: null, weight: null, zones: ['galife', 'shin'], armpits: false, pubis_belly: false,
      quoted_at: null, asked_at: new Date(), confirm_asked_at: null, updated_at: new Date() };
    const out = await say('Москва');
    expect(out.kind).toBe('quote');
    expect(out.state?.zones).toEqual(['legs_circular']);
  });
});

// Прогон по 18 тыс. реальных входящих: «ушк» находилось внутри «девушка» и
// «ловушки», «икр» — внутри «микротоки»/«микроигольчатый». Раньше это давало
// ложную цену галифе/голени, а теперь дало бы схемы ног и цену круговой.
describe('части слов — не зона ног', () => {
  it.each([
    'Девушка, ответьте пожалуйста 🙏',
    'Целлюлит и жировые ловушки вечная моя проблема...',
    'Скажите пожалуйста сколько стоит микротоки ?',
    'Цена рф микроигольчатоголифтинга?',
    'Можно узнать стоимость операции у девушки?',
  ])('%j', t => {
    expect(parsePriceZones(t)).not.toContain('legs_circular');
  });
  it.each(['Ушки 💔', 'ушки на бедрах', 'Икры и руки', 'икроножную часть', 'А на икрах делается?'])(
    '%j — по-прежнему ноги', t => {
      expect(parsePriceZones(t)).toContain('legs_circular');
    });
  // «ноги» рядом с другой зоной раньше терялись: общее слово учитывалось,
  // только когда ничего конкретного не нашлось.
  it.each(['У меня есть жировые ловушки,живот ,ноги,руки!', 'живот+бока+ноги', 'Руки и ножки'])(
    '%j — ноги не теряются рядом с другими зонами', t => {
      expect(parsePriceZones(t)).toContain('legs_circular');
    });
  it.each(['Наращивание ногтей', 'Многое понятно, спасибо'])('%j — не ноги', t => {
    expect(parsePriceZones(t)).not.toContain('legs_circular');
  });
});

describe('foldLegParts', () => {
  it('сворачивает части ног в круговую, сохраняя прочие зоны и порядок', () => {
    expect(foldLegParts(['inner_legs', 'belly', 'galife'])).toEqual(['legs_circular', 'belly']);
    expect(foldLegParts(['arms', 'shin'])).toEqual(['arms', 'legs_circular']);
    expect(foldLegParts(['arms'])).toEqual(['arms']);
  });
});
