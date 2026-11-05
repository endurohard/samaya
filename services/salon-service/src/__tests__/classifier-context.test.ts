// Jev видел только текущее сообщение клиента. Короткие ответы на вопрос
// клиники («Круговая», «Живот,талия», «О первой») без контекста уходили в
// manual_review, и опрос переспрашивал то, на что клиент уже ответил: 4
// ноября повторный вопрос о зоне ушёл в 43 диалога. Теперь в описание
// ситуации добавляется последняя реплика клиники в этом диалоге.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';

const { query } = vi.hoisted(() => ({
  query: vi.fn(async (..._a: any[]) => ({ rows: [
    { id: 't1', topic: 'liposakciya_ruk', title: 'Цена', matcher: 'Вопрос о цене липосакции',
      body: 'Опрос', autosend: true, enabled: true },
  ] })),
}));
vi.mock('../db', () => ({ pool: { query } }));

let classify: typeof import('../ai/classifier').classify;
const sent: any[] = [];

beforeAll(async () => {
  vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: any) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ answers: { theme: { choice: 'liposakciya_ruk', confidence: 0.95 } } }) };
  }));
  ({ classify } = await import('../ai/classifier'));
});
beforeEach(() => { sent.length = 0; });

describe('контекст диалога для Jev', () => {
  it('передаёт предыдущую реплику клиники вместе с сообщением клиента', async () => {
    await classify('co', 'Круговая', null, {
      previous: 'У нас есть два варианта лазерной липосакции ног: круговая и локальная. О какой рассказать?',
    });
    expect(sent[0].state).toContain('Круговая');
    expect(sent[0].state).toContain('О какой рассказать?');
  });

  it('без контекста описание прежнее', async () => {
    await classify('co', 'Сколько стоит?', null);
    expect(sent[0].state).toBe('Сообщение клиента в Instagram Direct клиники косметологии: "Сколько стоит?"');
  });

  it('длинная реплика клиники обрезается', async () => {
    await classify('co', 'Да', null, { previous: 'х'.repeat(5000) });
    expect(sent[0].state.length).toBeLessThan(2600);
  });
});
