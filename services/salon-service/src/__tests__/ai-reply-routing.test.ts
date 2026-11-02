import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ classify: vi.fn(), price: vi.fn(), log: vi.fn(), policy: vi.fn(), collecting: vi.fn(), notify: vi.fn(async () => ({ ok: true })) }));
vi.mock('../db', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
vi.mock('../ai/classifier', () => ({ classify: mocks.classify, logDecision: mocks.log, loadTemplates: vi.fn(), render: vi.fn() }));
vi.mock('../ai/telegram', () => ({ notifyNeedsReply: mocks.notify, sendTelegram: vi.fn(), telegramTarget: vi.fn(), tgDispatcher: vi.fn() }));
vi.mock('../ai/telegram-replies', () => ({ rememberNotification: vi.fn() }));
vi.mock('../ai/intro', () => ({ legsIntroFor: vi.fn(async () => []), markIntroSent: vi.fn(), LEGS_INTRO_TOPIC: 'legs_intro' }));
vi.mock('../ai/price-dialog', () => ({ handleMessage: mocks.price,
  isCollecting: mocks.collecting, isCitySwitch: vi.fn(async () => false),
  loadPriceDialogPolicy: mocks.policy, isPriceDialogEnabled: vi.fn(async () => true), resetState: vi.fn(async () => {}), loadZoneCatalog: vi.fn() }));
import router from '../routes/ai';
const replyHandler = (router as any).stack.find((s: any) => s.route?.path === '/reply').route.stack[1].handle;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.policy.mockResolvedValue({ enabled: true, autosend: true });
  mocks.collecting.mockResolvedValue(true);
  mocks.classify.mockResolvedValue({ ok: true, topic: 'manual_review', action: 'draft', confidence: 0.4, reply: null });
  mocks.price.mockResolvedValue({ kind: 'ask', reply: 'Какой город?', reason: null });
});
const tryHandler = (router as any).stack.find((s: any) => s.route?.path === '/try').route.stack.at(-1).handle;
describe('/try: политика совпадает с /reply', () => {
  it.each([
    ['Липосакция рук', false, 'draft', true],
    ['Сколько стоит эпиляция рук?', true, 'draft', false],
  ])('%s, autosend=%s', async (text, autosend, action, called) => {
    mocks.policy.mockResolvedValue({ enabled: true, autosend });
    const json = vi.fn(); const next = vi.fn();
    await tryHandler({ body: { text }, auth: { company_id: 'test' } }, { json }, next);
    expect(next).not.toHaveBeenCalled();
    expect(json.mock.calls[0][0].action).toBe(action);
    expect(mocks.price.mock.calls.length > 0).toBe(called);
  });
});

describe('/reply: политика шаблонов', () => {
  async function reply(text: string) {
    const json = vi.fn(); const next = vi.fn();
    await replyHandler({ body: { text, thread_id: 'test' }, auth: { company_id: 'test' } }, { json }, next);
    expect(next).not.toHaveBeenCalled();
    return json.mock.calls[0][0];
  }
  it.each([true, false])('autosend=false даёт черновик (collecting=%s)', async collecting => {
    mocks.collecting.mockResolvedValue(collecting);
    mocks.policy.mockResolvedValue({ enabled: true, autosend: false });
    expect((await reply(collecting ? '65' : 'Липосакция рук')).action).toBe('draft');
    expect(mocks.notify).toHaveBeenCalled();
  });
  it('выключенный прайс запрещает fallback', async () => {
    mocks.policy.mockResolvedValue({ enabled: false, autosend: true });
    await reply('Липосакция рук');
    expect(mocks.price).not.toHaveBeenCalled();
  });
  it('выключенная распознанная тема не обходится активным опросом', async () => {
    mocks.classify.mockResolvedValue({ ok: true, topic: 'holka', action: 'skipped', reply: null });
    expect((await reply('Липосакция холки')).action).toBe('skipped');
    expect(mocks.price).not.toHaveBeenCalled();
  });
  it.each(['Сколько стоит эпиляция рук?', 'Стоимость увеличения груди'])('другая услуга не становится липосакцией: %s', async text => {
    await reply(text);
    expect(mocks.price).not.toHaveBeenCalled();
  });
});

describe('/reply: незавершённый опрос не перехватывает другую тему', () => {
  it.each(['Здравствуйте', 'Хочу записаться', 'Хочу записаться на липосакцию рук'])('%s идёт в шаблон', async text => {
    mocks.classify.mockResolvedValue({ ok: true, topic: 'other_topic', confidence: 1,
      action: 'sent', reply: 'Текст существующего шаблона', reason: null });
    const json = vi.fn();
    const next = vi.fn();
    await replyHandler({ body: { text, thread_id: 'test' }, auth: { company_id: 'test' } }, { json }, next);
    expect(next).not.toHaveBeenCalled();
    expect(json.mock.calls[0][0].reply).toBe('Текст существующего шаблона');
    expect(mocks.price).not.toHaveBeenCalled();
  });
  it('непонятая просьба о записи не превращается обратно в расчёт цены', async () => {
    mocks.classify.mockResolvedValue({ ok: true, topic: 'manual_review', confidence: 0.4,
      action: 'draft', reply: null, reason: 'нужен администратор' });
    const json = vi.fn();
    await replyHandler({ body: { text: 'Хочу записаться на липосакцию рук', thread_id: 'test' }, auth: { company_id: 'test' } }, { json }, vi.fn());
    expect(json.mock.calls[0][0].action).toBe('draft');
    expect(mocks.price).not.toHaveBeenCalled();
  });
  it.each(['Каспийск', '65', 'да'])('%s остаётся ответом на опрос', async text => {
    const json = vi.fn();
    await replyHandler({ body: { text, thread_id: 'test' }, auth: { company_id: 'test' } }, { json }, vi.fn());
    expect(mocks.price).toHaveBeenCalled();
    expect(mocks.classify).not.toHaveBeenCalled();
  });
});
