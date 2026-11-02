import { beforeEach, describe, expect, it, vi } from 'vitest';
const query = vi.hoisted(() => vi.fn());
vi.mock('../db', () => ({ pool: { query } }));
import { isPriceDialogEnabled } from '../ai/price-dialog';
beforeEach(() => { query.mockReset(); });
describe('допуск ценового опросника', () => {
  it('отсутствующий шаблон не разрешает fallback', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await isPriceDialogEnabled('company')).toBe(false);
  });
  it('ошибка чтения не разрешает fallback', async () => {
    query.mockRejectedValue(new Error('недоступна БД'));
    expect(await isPriceDialogEnabled('company')).toBe(false);
  });
  it('выключенный шаблон запрещён', async () => {
    query.mockResolvedValue({ rows: [{ enabled: false, autosend: true }] });
    expect(await isPriceDialogEnabled('company')).toBe(false);
  });
});
