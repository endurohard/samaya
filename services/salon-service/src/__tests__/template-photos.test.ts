// Фото в обычном шаблоне ответа. Админка уже умела дописывать в тело строку
// «--- фото: имя», но автоответ отправлял тело целиком ТЕКСТОМ: клиент
// получил бы служебную строку вместо картинки. Теперь шаблон с фото уходит
// частями в том порядке, в каком написан, а текст ответа — без разметки.
import { describe, it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn(async (..._a: any[]) => ({ rows: [] as any[] })), classify: vi.fn(), intro: vi.fn(async (..._a: any[]) => [] as any[]) }));
vi.mock('../db', () => ({ pool: { query: mocks.query } }));
vi.mock('../ai/classifier', async orig => ({ ...await orig<typeof import('../ai/classifier')>(), classify: mocks.classify, logDecision: vi.fn(), loadTemplates: vi.fn(async () => []) }));
vi.mock('../ai/telegram', () => ({ notifyNeedsReply: vi.fn(async () => ({ ok: true })), sendTelegram: vi.fn(), telegramTarget: vi.fn(), tgDispatcher: vi.fn() }));
vi.mock('../ai/telegram-replies', () => ({ rememberNotification: vi.fn() }));
vi.mock('../ai/intro', () => ({ legsIntroFor: mocks.intro, markIntroSent: vi.fn(), LEGS_INTRO_TOPIC: 'legs_intro' }));
vi.mock('../ai/price-dialog', () => ({ handleMessage: vi.fn(), isCollecting: vi.fn(async () => false), isCitySwitch: vi.fn(async () => false),
  loadPriceDialogPolicy: vi.fn(async () => ({ enabled: false, autosend: false })), isPriceDialogEnabled: vi.fn(async () => false), resetState: vi.fn(), loadZoneCatalog: vi.fn() }));
import router from '../routes/ai';
import { render } from '../ai/classifier';
const replyHandler = (router as any).stack.find((s: any) => s.route?.path === '/reply').route.stack[1].handle;

const BODY = 'Вот наши результаты 🤍\n--- фото: tpl-ab12-1\n--- фото: tpl-ab12-2\n--- текст\nЗапишитесь на консультацию';

async function reply(d: any, text = 'покажите результаты') {
  mocks.classify.mockResolvedValue({ ok: true, topic: 'results', template: { id: 't', topic: 'results', title: 'Результаты' }, confidence: 0.95, ...d });
  const json = vi.fn(); const next = vi.fn();
  await replyHandler({ body: { text, thread_id: 'th', channel: 'probe' }, auth: { company_id: 'c' } }, { json }, next);
  expect(next).not.toHaveBeenCalled();
  return json.mock.calls[0][0];
}

beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue({ rows: [] }); mocks.intro.mockResolvedValue([]); });

describe('шаблон с фото', () => {
  it('отправляемый ответ уходит частями по порядку, текст без разметки', async () => {
    const r = await reply({ action: 'sent', reply: BODY });
    expect(r.reply_parts).toEqual([
      { type: 'text', text: 'Вот наши результаты 🤍' },
      { type: 'image', asset: 'tpl-ab12-1' },
      { type: 'image', asset: 'tpl-ab12-2' },
      { type: 'text', text: 'Запишитесь на консультацию' },
    ]);
    expect(r.reply_in_parts).toBe(true);
    expect(r.reply).toBe('Вот наши результаты 🤍\n\nЗапишитесь на консультацию');
    // Это не вступление про ноги — отметку «схемы ног показаны» ставить нельзя.
    expect(r.intro_key).toBeNull();
  });

  it('черновик администратору — без служебных строк и без отправки фото', async () => {
    const r = await reply({ action: 'draft', reply: BODY });
    expect(r.reply).toBe('Вот наши результаты 🤍\n\nЗапишитесь на консультацию');
    expect(r.reply_parts).toEqual([]);
    expect(r.reply_in_parts).toBeFalsy();
  });

  it('вступление про ноги и фото шаблона идут вместе: сначала вступление', async () => {
    const INTRO = [{ type: 'image', asset: 'legs-zones-front' }];
    mocks.intro.mockResolvedValue(INTRO);
    const r = await reply({ action: 'sent', reply: BODY, legsIntro: true }, 'ноги');
    expect(r.reply_parts[0]).toEqual(INTRO[0]);
    expect(r.reply_parts).toHaveLength(5);
    expect(r.intro_key).toBe('legs_intro');
  });

  it('шаблон без фото работает как раньше', async () => {
    const r = await reply({ action: 'sent', reply: 'Просто текст' });
    expect(r).toMatchObject({ reply: 'Просто текст', reply_parts: [] });
    expect(r.reply_in_parts).toBeFalsy();
  });
});

describe('подстановка имени не склеивает строки', () => {
  it('без имени переносы строк остаются — иначе пропадает разметка фото', () => {
    expect(render('Здравствуйте, {name}!\n\nТекст\n--- фото: x')).toBe('Здравствуйте!\n\nТекст\n--- фото: x');
  });
});
