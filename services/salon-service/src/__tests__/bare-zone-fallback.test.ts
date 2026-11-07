// it.izberbash 7 ноября: после цены ног «А галифе» ушло администратору
// («тема не определена»): классификатор не уверен (0.47), а запасная
// проверка «это вопрос про ЛЛ» знала только руки/ноги/живот/холку…
// Любая зона из прайса, названная коротко, — продолжение ценового разговора.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ classify: vi.fn(), price: vi.fn() }));
vi.mock('../db', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../ai/classifier', async orig => ({ ...await orig<typeof import('../ai/classifier')>(), classify: mocks.classify, logDecision: vi.fn(), loadTemplates: vi.fn(async () => []) }));
vi.mock('../ai/telegram', () => ({ notifyNeedsReply: vi.fn(async () => ({ ok: true })), sendTelegram: vi.fn(), telegramTarget: vi.fn(), tgDispatcher: vi.fn() }));
vi.mock('../ai/telegram-replies', () => ({ rememberNotification: vi.fn() }));
vi.mock('../ai/intro', () => ({ legsIntroFor: vi.fn(async () => []), markIntroSent: vi.fn(), LEGS_INTRO_TOPIC: 'legs_intro' }));
vi.mock('../ai/price-dialog', () => ({ handleMessage: mocks.price, isCollecting: vi.fn(async () => false), isCitySwitch: vi.fn(async () => false),
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
  mocks.classify.mockResolvedValue({ ok: true, topic: 'manual_review', action: 'draft', confidence: 0.47, reply: null });
  mocks.price.mockResolvedValue({ kind: 'quote', reply: 'Цена', reason: 'цена', state: { zones: [] } });
});

describe('коротко названная зона — в ценовой разговор', () => {
  it.each(['А галифе', 'А голень?', 'Ягодицы', 'а лобок', 'А подбородок сколько?', 'Галифе и голень'])('%j', async t => {
    const r = await reply(t);
    expect(mocks.price).toHaveBeenCalled();
    expect(r.action).toBe('sent');
  });
  it.each(['Спасибо', 'А врач кто?', 'Где вы находитесь?'])('%j — не зона, к администратору', async t => {
    const r = await reply(t);
    expect(mocks.price).not.toHaveBeenCalled();
    expect(r.action).toBe('draft');
  });
});
