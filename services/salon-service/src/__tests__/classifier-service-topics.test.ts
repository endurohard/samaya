// Служебные ручные шаблоны не должны конкурировать с ценовым модулем в Jev.
// Иначе «Сколько стоит холка» одновременно подходит под три темы, уверенность
// падает ниже порога, и готовый ценовой ответ уходит администратору.
import { describe, it, expect, vi } from 'vitest';

const { query } = vi.hoisted(() => ({
  query: vi.fn(async () => ({ rows: [] })),
}));
vi.mock('../db', () => ({ pool: { query } }));

import { loadTemplates } from '../ai/classifier';

describe('варианты тем для Jev', () => {
  it('не передаёт служебный шаблон холки классификатору', async () => {
    await loadTemplates('00000000-0000-0000-0000-000000000001');

    const [, params] = query.mock.calls[0];
    expect(params[1]).toContain('holka_shoulders');
  });
});
