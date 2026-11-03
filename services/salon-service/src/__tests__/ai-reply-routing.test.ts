import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(async (..._args: any[]) => ({ rows: [] as any[] })), templates: vi.fn(), classify: vi.fn(), price: vi.fn(), log: vi.fn(), policy: vi.fn(), collecting: vi.fn(), notify: vi.fn(async () => ({ ok: true })) }));
vi.mock('../db', () => ({ pool: { query: mocks.query } }));
vi.mock('../ai/classifier', async importOriginal => ({ ...await importOriginal<typeof import('../ai/classifier')>(), classify: mocks.classify, logDecision: mocks.log, loadTemplates: mocks.templates }));
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
  mocks.query.mockReset().mockResolvedValue({ rows: [] });
  mocks.templates.mockResolvedValue([]);
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
  it('плюс после доставленного приглашения даёт Contour Lift только черновиком при autosend=false', async () => {
    mocks.query.mockResolvedValue({ rows: [{ topic: 'price_chin', action: 'sent',
      reply: 'Если хотите узнать подробнее о Contour Lift— оставьте «+», и мы расскажем 🤍', delivered: true }] });
    mocks.templates.mockResolvedValue([{ id: 'contour', topic: 'contour_lift', title: 'Contour Lift',
      body: 'Одобренный текст Contour Lift', enabled: true, autosend: false }]);
    const result = await reply('+');
    expect(result).toMatchObject({ topic: 'contour_lift', action: 'draft', reply: 'Одобренный текст Contour Lift' });
    expect(mocks.price).not.toHaveBeenCalled();
    expect(mocks.classify).not.toHaveBeenCalled();
    expect(mocks.notify).toHaveBeenCalled();
  });
  it('плюс при удалённом целевом шаблоне не возвращается в старый ценовой опрос', async () => {
    mocks.query.mockResolvedValue({ rows: [{ topic: 'price_chin', action: 'sent',
      reply: 'Подробнее о Contour Lift — оставьте «+»', delivered: true }] });
    const result = await reply('+');
    expect(result).toMatchObject({ topic: 'contour_lift', action: 'draft', reply: null });
    expect(mocks.price).not.toHaveBeenCalled();
  });
  it.each([
    [false, true, 'skipped'], [false, false, 'skipped'], [true, true, 'sent'],
  ])('плюс соблюдает enabled=%s, autosend=%s', async (enabled, autosend, action) => {
    mocks.query.mockResolvedValue({ rows: [{ topic: 'price_chin', action: 'sent',
      reply: 'Подробнее о Contour Lift — оставьте «+»', delivered: true }] });
    mocks.templates.mockResolvedValue([{ id: 'contour', topic: 'contour_lift', title: 'Contour Lift',
      body: 'Одобренный текст Contour Lift', enabled, autosend }]);
    expect(await reply('+')).toMatchObject({ topic: 'contour_lift', action,
      reply: enabled ? 'Одобренный текст Contour Lift' : null });
    expect(mocks.price).not.toHaveBeenCalled();
    expect(mocks.log.mock.calls[0][1].template.id).toBe('contour');
  });
  it.each([
    { topic: 'price_chin', action: 'draft', delivered: true, reply: 'Contour Lift — оставьте «+»' },
    { topic: 'price_chin', action: 'sent', delivered: false, reply: 'Contour Lift — оставьте «+»' },
    { topic: 'price_chin', action: 'sent', delivered: true, reply: 'Contour Lift без приглашения' },
    { topic: 'booking', action: 'sent', delivered: true, reply: 'Contour Lift — оставьте «+»' },
    null,
  ])('плюс без актуального доставленного приглашения не разрешает Contour: %s', async previous => {
    mocks.collecting.mockResolvedValue(false);
    mocks.query.mockResolvedValue({ rows: previous ? [previous] : [] });
    expect((await reply('+')).topic).toBe('manual_review');
    expect(mocks.templates).not.toHaveBeenCalled();
  });
  it('ошибка чтения контекста плюса не разрешает автоответ старого опроса', async () => {
    mocks.query.mockRejectedValue(new Error('DB unavailable'));
    expect((await reply('+')).action).toBe('draft');
    expect(mocks.price).not.toHaveBeenCalled();
  });
  it.each([true, false])('autosend=false даёт черновик (collecting=%s)', async collecting => {
    mocks.collecting.mockResolvedValue(collecting);
    mocks.policy.mockResolvedValue({ enabled: true, autosend: false });
    expect((await reply(collecting ? '65' : 'Липосакция рук')).action).toBe('draft');
    expect(mocks.notify).toHaveBeenCalled();
  });
  it.each([
    ['Сколько стоит ЛЛ ?', 0.66],
    ['Холка сколько стоит ?', 0.66],
    ['Сколько стоит холка ?', 0.50],
    ['Сколько стоит липосакция холки ?', 0.79],
  ])('разрешённый прайс не путает низкую уверенность с autosend=false: %s', async (text, confidence) => {
    mocks.classify.mockResolvedValue({ ok: true, topic: 'liposakciya_ruk',
      template: { id: 'price', enabled: true, autosend: true }, confidence,
      action: 'draft', reply: 'Шаблон опроса', reason: 'низкая уверенность — нужна проверка' });
    expect((await reply(text)).action).toBe('sent');
    expect(mocks.price).toHaveBeenCalled();
    expect(mocks.notify).not.toHaveBeenCalled();
  });
  it('запрет автоотправки выбранного шаблона не обходится прайсом', async () => {
    mocks.classify.mockResolvedValue({ ok: true, topic: 'liposakciya_ruk',
      template: { id: 'price', enabled: true, autosend: false }, confidence: 0.99,
      action: 'draft', reply: null });
    expect((await reply('Липосакция рук')).action).toBe('draft');
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
