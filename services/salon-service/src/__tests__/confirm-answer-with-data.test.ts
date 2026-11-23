// Пробa на бою 23 ноября: клиент вернулся, бот спросил «В прошлый раз вы
// указывали: город — Москва. Всё верно?», клиент ответил «нет, Каспийск» —
// и ответ ушёл классификатору (тема which_city, черновик администратору)
// вместо пересчёта по новому городу. Голые «да»/«нет» опрос уже ловил, а
// «нет» + новые данные — нет.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ classify: vi.fn(), price: vi.fn() }));
vi.mock('../db', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../ai/classifier', async orig => ({ ...await orig<typeof import('../ai/classifier')>(), classify: mocks.classify, logDecision: vi.fn(), loadTemplates: vi.fn(async () => []) }));
vi.mock('../ai/telegram', () => ({ notifyNeedsReply: vi.fn(async () => ({ ok: true })), sendTelegram: vi.fn(), telegramTarget: vi.fn(), tgDispatcher: vi.fn() }));
vi.mock('../ai/telegram-replies', () => ({ rememberNotification: vi.fn() }));
vi.mock('../ai/intro', () => ({ legsIntroFor: vi.fn(async () => []), markIntroSent: vi.fn(), LEGS_INTRO_TOPIC: 'legs_intro' }));
vi.mock('../ai/price-dialog', () => ({ handleMessage: mocks.price, isCollecting: vi.fn(async () => true), isCitySwitch: vi.fn(async () => false),
  loadPriceDialogPolicy: vi.fn(async () => ({ enabled: true, autosend: true })), isPriceDialogEnabled: vi.fn(async () => true), resetState: vi.fn(), loadZoneCatalog: vi.fn() }));
import router from '../routes/ai';
const replyHandler = (router as any).stack.find((s: any) => s.route?.path === '/reply').route.stack[1].handle;
async function reply(text: string) {
  const json = vi.fn(); const next = vi.fn();
  await replyHandler({ body: { text, thread_id: 'th', channel: 'probe' }, auth: { company_id: 'c' } }, { json }, next);
  expect(next).not.toHaveBeenCalled();
  return json.mock.calls[0][0];
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.classify.mockResolvedValue({ ok: true, topic: 'which_city', action: 'draft', confidence: 0.9, reply: 'x' });
  mocks.price.mockResolvedValue({ kind: 'quote', reply: 'Цена', reason: 'цена', state: { zones: [] } });
});

describe('ответ на «город и вес прежние?» с новыми данными — в опрос', () => {
  it.each(['нет, Каспийск', 'Нет. Москва', 'нет, теперь 80 кг', 'да, Москва', 'нет уже Каспийск 65'])('%j', async t => {
    const r = await reply(t);
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.price).toHaveBeenCalled();
    expect(r.action).toBe('sent');
  });
  it.each(['нет, я хочу записаться', 'нет, а где вы находитесь?'])('%j — не данные опроса, к классификатору', async t => {
    await reply(t);
    expect(mocks.classify).toHaveBeenCalled();
  });
});
