// Повторный запрос про круговую липосакцию ног обязан снова отправить
// полное вступление: две схемы и описание. Старая отметка thread_intro не
// должна навсегда выключать материалы для этого диалога.
import { describe, it, expect, vi } from 'vitest';

const { query } = vi.hoisted(() => ({
  query: vi.fn(async (sql: string) => {
    if (sql.includes('FROM ai.thread_intro')) return { rows: [{ '?column?': 1 }] };
    if (sql.includes('FROM ai.reply_templates')) {
      return {
        rows: [
          {
            topic: 'legs_intro', enabled: true,
            body: [
              '--- фото: legs-zones-front',
              '--- фото: legs-zones-back',
              '--- текст',
              'Пришлите фото ног прямо, сбоку и со спины 🤍',
            ].join('\n'),
          },
          {
            topic: 'legs_method', enabled: true,
            body: 'Описание авторской методики и семи зон ног.',
          },
        ],
      };
    }
    return { rows: [] };
  }),
}));
vi.mock('../db', () => ({ pool: { query } }));

import { legsIntroFor } from '../ai/intro';

describe('повторное вступление про ноги', () => {
  it('несмотря на старую отметку возвращает две фотографии и описание', async () => {
    const parts = await legsIntroFor({
      companyId: '00000000-0000-0000-0000-000000000001',
      channel: 'instagram',
      threadId: 'thread-with-old-intro',
      text: 'На липосакцию ног',
    });

    expect(parts.filter(p => p.type === 'image')).toEqual([
      { type: 'image', asset: 'legs-zones-front' },
      { type: 'image', asset: 'legs-zones-back' },
    ]);
    expect(parts.filter(p => p.type === 'text')).toHaveLength(2);
  });
});
