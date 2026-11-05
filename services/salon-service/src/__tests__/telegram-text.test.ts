// Текст уведомления в Telegram: запрос на запись выделяется заголовком,
// чтобы администратор не пропустил его среди обычных «нужен ответ».
import { describe, it, expect, vi } from 'vitest';
vi.mock('../db', () => ({ pool: { query: vi.fn(async () => ({ rows: [] })) } }));
import { needsReplyText } from '../ai/telegram';

describe('текст уведомления', () => {
  it('запись — свой заголовок', () => {
    const t = needsReplyText({ channel: 'instagram', who: '@client', question: 'Хочу записаться', kind: 'booking' });
    expect(t).toContain('Хочет записаться');
    expect(t).not.toContain('Нужен ответ');
    expect(t).toContain('instagram.com/client');
  });
  it('обычный вопрос — прежний заголовок', () => {
    const t = needsReplyText({ channel: 'instagram', who: '@client', question: 'Где вы?' });
    expect(t).toContain('Нужен ответ');
  });
});
