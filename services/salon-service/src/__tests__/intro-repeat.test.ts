// Повторный запрос про круговую липосакцию ног обязан снова отправить
// полное вступление: две схемы и описание. Старая отметка thread_intro не
// должна навсегда выключать материалы для этого диалога.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { query, flags } = vi.hoisted(() => {
  const flags = { enabled: true, autosend: true };
  return {
    flags,
    query: vi.fn(async (sql: string) => {
      if (sql.includes('FROM ai.thread_intro')) return { rows: [{ '?column?': 1 }] };
      if (sql.includes('FROM ai.reply_templates')) {
        return {
          rows: [
            {
              topic: 'legs_intro', enabled: flags.enabled, autosend: flags.autosend,
              body: [
                '--- фото: legs-zones-front',
                '--- фото: legs-zones-back',
                '--- текст',
                'Пришлите фото ног прямо, сбоку и со спины 🤍',
              ].join('\n'),
            },
            {
              topic: 'legs_method', enabled: true, autosend: true,
              body: 'Описание авторской методики и семи зон ног.',
            },
          ],
        };
      }
      return { rows: [] };
    }),
  };
});
vi.mock('../db', () => ({ pool: { query } }));

import { legsIntroFor } from '../ai/intro';

const ask = (text = 'На липосакцию ног') => legsIntroFor({
  companyId: '00000000-0000-0000-0000-000000000001',
  channel: 'instagram',
  threadId: 'thread-with-old-intro',
  text,
});

beforeEach(() => { flags.enabled = true; flags.autosend = true; });

describe('повторное вступление про ноги', () => {
  it('несмотря на старую отметку возвращает две фотографии и текст про 7 зон', async () => {
    const parts = await ask();

    expect(parts.filter(p => p.type === 'image')).toEqual([
      { type: 'image', asset: 'legs-zones-front' },
      { type: 'image', asset: 'legs-zones-back' },
    ]);
    // Текст самого вступления автоответом больше не уходит (решение
    // владельца 6 ноября) — остаётся только текст про 7 зон.
    expect(parts.filter(p => p.type === 'text')).toHaveLength(1);
  });
});

// 4 ноября вступление ушло автоматически в 104 диалога, хотя у шаблона
// legs_intro стоит autosend=false: проверялся только enabled. Политика
// шаблонов одна для всех веток — без autosend текст сам клиенту не уходит.
describe('вступление про ноги соблюдает политику шаблона', () => {
  it('autosend=false не отдаёт частей для автоотправки', async () => {
    flags.autosend = false;
    expect(await ask()).toEqual([]);
  });

  it('enabled=false не отдаёт частей', async () => {
    flags.enabled = false;
    expect(await ask()).toEqual([]);
  });
});
