import { describe, it, expect } from 'vitest';
import { diffFields } from '../audit';

// История изменений — источник правды в спорах «кто снизил цену».
// Если diff врёт, разбирательство упирается в пустой или лживый журнал.

describe('diffFields — что попадает в историю изменений', () => {
  it('фиксирует изменение поля с прежним и новым значением', () => {
    const changes = diffFields(
      { total_price: 10_000 },
      { total_price: 8000 },
      ['total_price'],
    );
    expect(changes).toEqual({ total_price: { from: 10_000, to: 8000 } });
  });

  it('не пишет ничего, когда сохранили без правок', () => {
    const before = { notes: 'привет', status: 'confirmed' };
    const after = { notes: 'привет', status: 'confirmed' };
    expect(diffFields(before, after, ['notes', 'status'])).toEqual({});
  });

  it('поля вне списка игнорируются', () => {
    const changes = diffFields({ secret: 'a' }, { secret: 'b' }, ['notes']);
    expect(changes).toEqual({});
  });

  it('поле, которого нет в новом состоянии, не считается изменением', () => {
    // PATCH присылает только часть полей — отсутствие поля означает
    // «не трогали», а не «стёрли».
    expect(diffFields({ notes: 'текст' }, {}, ['notes'])).toEqual({});
  });

  it('undefined в новом состоянии тоже означает «не трогали»', () => {
    expect(diffFields({ notes: 'текст' }, { notes: undefined }, ['notes'])).toEqual({});
  });

  it('null записывается как очистка поля', () => {
    const changes = diffFields({ notes: 'текст' }, { notes: null }, ['notes']);
    expect(changes).toEqual({ notes: { from: 'текст', to: null } });
  });

  it('даты сравниваются по моменту времени, а не по строковому виду', () => {
    const a = new Date('2026-07-20T10:00:00.000Z');
    const b = new Date('2026-07-20T10:00:00.000Z');
    expect(diffFields({ starts_at: a }, { starts_at: b }, ['starts_at'])).toEqual({});
  });

  it('реальный перенос записи попадает в историю', () => {
    const a = new Date('2026-07-20T10:00:00.000Z');
    const b = new Date('2026-07-21T12:00:00.000Z');
    const changes = diffFields({ starts_at: a }, { starts_at: b }, ['starts_at']);
    expect(changes.starts_at).toEqual({ from: a, to: b });
  });

  it('числа из БД приходят строками — «10000» и 10000 не считаются правкой', () => {
    expect(diffFields({ total_price: '10000' }, { total_price: 10_000 }, ['total_price'])).toEqual({});
  });

  it('собирает несколько изменений сразу', () => {
    const changes = diffFields(
      { notes: 'a', total_price: 100, status: 'pending' },
      { notes: 'b', total_price: 200, status: 'pending' },
      ['notes', 'total_price', 'status'],
    );
    expect(Object.keys(changes).sort()).toEqual(['notes', 'total_price']);
  });
});
