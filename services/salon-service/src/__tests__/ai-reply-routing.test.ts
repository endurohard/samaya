import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(async (..._args: any[]) => ({ rows: [] as any[] })), templates: vi.fn(), classify: vi.fn(), price: vi.fn(), log: vi.fn(), policy: vi.fn(), collecting: vi.fn(), notify: vi.fn(async () => ({ ok: true })), intro: vi.fn(async (..._args: any[]) => [] as any[]) }));
vi.mock('../db', () => ({ pool: { query: mocks.query } }));
vi.mock('../ai/classifier', async importOriginal => ({ ...await importOriginal<typeof import('../ai/classifier')>(), classify: mocks.classify, logDecision: mocks.log, loadTemplates: mocks.templates }));
vi.mock('../ai/telegram', () => ({ notifyNeedsReply: mocks.notify, sendTelegram: vi.fn(), telegramTarget: vi.fn(), tgDispatcher: vi.fn() }));
vi.mock('../ai/telegram-replies', () => ({ rememberNotification: vi.fn() }));
vi.mock('../ai/intro', () => ({ legsIntroFor: mocks.intro, markIntroSent: vi.fn(), LEGS_INTRO_TOPIC: 'legs_intro' }));
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
  mocks.intro.mockResolvedValue([]);
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

// Вступление про ноги уходило из любой ветки, в том числе когда ответ сам
// остался черновиком: 4 ноября клиенты, спросившие про внутреннюю поверхность
// бедра, получали схемы круговой процедуры, пока администратор ещё не видел
// сообщения. Материалы — часть ответа и уходят только вместе с ним.
describe('/reply: вступление про ноги только вместе с отправленным ответом', () => {
  const INTRO = [{ type: 'image', asset: 'legs-zones-front' }, { type: 'text', text: 'Описание' }];
  async function reply(text: string) {
    const json = vi.fn(); const next = vi.fn();
    await replyHandler({ body: { text, thread_id: 'test', channel: 'instagram' }, auth: { company_id: 'test' } }, { json }, next);
    expect(next).not.toHaveBeenCalled();
    return json.mock.calls[0][0];
  }
  it('черновик не несёт вступления', async () => {
    mocks.collecting.mockResolvedValue(false);
    mocks.intro.mockResolvedValue(INTRO);
    mocks.classify.mockResolvedValue({ ok: true, topic: 'manual_review', action: 'draft', confidence: 0.6, reply: null });
    const r = await reply('внутренняя поверхность бедра');
    expect(r.action).toBe('draft');
    expect(r.reply_parts).toEqual([]);
    expect(r.intro_key).toBeNull();
  });
  it('отправленный ответ несёт вступление', async () => {
    mocks.collecting.mockResolvedValue(false);
    mocks.intro.mockResolvedValue(INTRO);
    mocks.classify.mockResolvedValue({ ok: true, topic: 'liposakciya_ruk',
      template: { id: 'price', enabled: true, autosend: true }, action: 'sent', confidence: 0.95, reply: 'Опрос' });
    const r = await reply('Круговая липосакция ног');
    expect(r.action).toBe('sent');
    expect(r.reply_parts).toEqual(INTRO);
    expect(r.intro_key).toBe('legs_intro');
  });
});

// 4 ноября бот ответил поверх менеджера в 138 диалогах из 287: менеджер
// представлялся или спрашивал вес, а бот следом слал приветствие или
// «уточните город». Ещё бот дублировал автоответ самого Instagram на
// рекламное сообщение. Когда в диалоге уже участвует человек или клиенту уже
// ответили, готовый ответ бота становится черновиком для администратора.
describe('/reply: бот не вмешивается в диалог, который ведёт человек', () => {
  const SENT = { ok: true, topic: 'greeting', template: { id: 'g', enabled: true, autosend: true },
    action: 'sent', confidence: 0.99, reply: 'Здравствуйте!', reason: null };
  function takeover(row: { human?: boolean; answered?: boolean } | Error) {
    mocks.query.mockImplementation(async (sql: string) => {
      if (!String(sql).includes('instagram.messages')) return { rows: [] };
      if (row instanceof Error) throw row;
      return { rows: [{ human: !!row.human, answered: !!row.answered }] };
    });
  }
  async function reply(text = 'Добрый день', channel = 'instagram') {
    const json = vi.fn(); const next = vi.fn();
    await replyHandler({ body: { text, thread_id: 'th1', channel }, auth: { company_id: 'test' } }, { json }, next);
    expect(next).not.toHaveBeenCalled();
    return json.mock.calls[0][0];
  }
  beforeEach(() => {
    mocks.collecting.mockResolvedValue(false);
    mocks.classify.mockResolvedValue(SENT);
  });
  it('ручное сообщение менеджера в окне паузы превращает ответ в черновик', async () => {
    takeover({ human: true });
    mocks.intro.mockResolvedValue([{ type: 'text', text: 'Описание' }]);
    const r = await reply();
    expect(r).toMatchObject({ action: 'draft', reply: 'Здравствуйте!', reply_parts: [] });
    expect(r.reason).toMatch(/администратор/);
    expect(mocks.notify).toHaveBeenCalled();
    expect(mocks.log.mock.calls[0][1].action).toBe('draft');
  });
  it('клиенту уже ответили после его сообщения — черновик, а не второй ответ', async () => {
    takeover({ answered: true });
    const r = await reply();
    expect(r.action).toBe('draft');
    expect(r.reason).toMatch(/уже ответили/);
  });
  it('ошибка проверки не разрешает автоответ', async () => {
    takeover(new Error('DB unavailable'));
    expect((await reply()).action).toBe('draft');
  });
  it('без участия человека ответ уходит', async () => {
    takeover({});
    expect((await reply()).action).toBe('sent');
  });
  it('ответ ценового опроса тоже проверяется', async () => {
    mocks.collecting.mockResolvedValue(true);
    takeover({ human: true });
    expect((await reply('Каспийск')).action).toBe('draft');
  });
  it('пробный канал не читает переписку Instagram', async () => {
    takeover({ human: true });
    expect((await reply('Добрый день', 'probe')).action).toBe('sent');
  });
});

// Канал склеивает пачку сообщений клиента, написанных подряд, в один запрос
// через перевод строки. Каждая строка пачки должна разбираться так же, как
// если бы пришла отдельно: «Москва» и «65» — ответы на опрос, «живот» —
// интерес к липосакции. Иначе склейка ухудшила бы разбор коротких ответов.
describe('/reply: склеенная пачка сообщений', () => {
  async function reply(text: string) {
    const json = vi.fn(); const next = vi.fn();
    await replyHandler({ body: { text, thread_id: 'test', channel: 'probe' }, auth: { company_id: 'test' } }, { json }, next);
    expect(next).not.toHaveBeenCalled();
    return json.mock.calls[0][0];
  }
  it.each(['Москва\n65', 'Каспийск\n74 кг', 'да\nМосква'])('строки-ответы на опрос идут в опрос без классификатора: %j', async text => {
    await reply(text);
    expect(mocks.price).toHaveBeenCalled();
    expect(mocks.classify).not.toHaveBeenCalled();
  });
  it('строка с зоной в пачке остаётся интересом к липосакции, если Jev не понял', async () => {
    mocks.collecting.mockResolvedValue(false);
    await reply('Здравствуйте\nживот');
    expect(mocks.classify).toHaveBeenCalled();
    expect(mocks.price).toHaveBeenCalled();
  });
  it('пачка с вопросом не считается ответом на опрос', async () => {
    await reply('Москва\nа сколько длится реабилитация?');
    expect(mocks.classify).toHaveBeenCalled();
  });
});
