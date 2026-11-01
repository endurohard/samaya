// Порядок вопросов ценового опросника на первом сообщении.
//
// Пока зона неизвестна, нельзя спрашивать вес: для части услуг цена
// фиксированная. Сначала узнаём город и зону, затем — только при
// необходимости — вес.
import { describe, it, expect, vi } from 'vitest';

const query = vi.fn(async (sql: string) => {
  if (sql.includes('FROM ai.price_dialog')) return { rows: [] };
  if (sql.includes('FROM ai.price_zones')) return { rows: [] };
  if (sql.includes('FROM ai.reply_templates') && sql.includes('SELECT body')) {
    return {
      rows: [{
        body: 'Здравствуйте 🌹\n\nУкажите пожалуйста:\n\n'
          + '1️⃣Какой город вас интересует Каспийск или Москва\n\n'
          + '2️⃣Ваш вес ?\n\n'
          + '3️⃣Какая зона вас интересует? 🤍',
      }],
    };
  }
  return { rows: [] };
});

vi.mock('../db', () => ({
  pool: { query: (...args: unknown[]) => query(String(args[0])) },
}));

import { handleMessage } from '../ai/price-dialog';

describe('порядок вопросов о цене', () => {
  it('пока зона неизвестна, сначала спрашивает город и зону без веса', async () => {
    const out = await handleMessage({
      companyId: '00000000-0000-0000-0000-000000000001',
      channel: 'test',
      threadId: 'unknown-zone',
      text: 'Сколько стоит липосакция?',
      fresh: true,
    });

    expect(out.kind).toBe('ask');
    expect(out.reply).toContain('Какой город');
    expect(out.reply).toContain('Какая зона');
    expect(out.reply).not.toContain('Ваш вес');
  });
});
