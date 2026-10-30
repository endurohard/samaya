import { describe, it, expect } from 'vitest';
import { parseParts } from '../ai/parts';
import { mentionsLegs } from '../ai/intro';

describe('parseParts', () => {
  it('разбирает текст-фото-фото-текст в том же порядке', () => {
    const parts = parseParts([
      '--- текст',
      'Первый абзац.',
      '',
      'Второй абзац.',
      '--- фото: legs-zones-front',
      '--- фото: legs-zones-back',
      '--- текст',
      'Выше показали 7 зон.',
    ].join('\n'));

    expect(parts).toEqual([
      { type: 'text', text: 'Первый абзац.\n\nВторой абзац.' },
      { type: 'image', asset: 'legs-zones-front' },
      { type: 'image', asset: 'legs-zones-back' },
      { type: 'text', text: 'Выше показали 7 зон.' },
    ]);
  });

  it('пустой шаблон даёт пустой список, а не часть с пустым текстом', () => {
    expect(parseParts('')).toEqual([]);
    expect(parseParts('--- текст\n\n\n')).toEqual([]);
  });

  it('текст без разметки целиком становится одной частью', () => {
    expect(parseParts('Просто текст')).toEqual([{ type: 'text', text: 'Просто текст' }]);
  });

  it('отбрасывает имя файла с выходом за каталог', () => {
    const parts = parseParts('--- фото: ../../etc/passwd\n--- фото: legs-zones-front');
    expect(parts).toEqual([{ type: 'image', asset: 'legs-zones-front' }]);
  });
});

describe('mentionsLegs', () => {
  // Дословные формулировки из переписки: по ним и должно срабатывать.
  it.each([
    'Круговая липосакция ног сколько стоит?',
    'ляшки хочу убрать',
    'интересует липосакция бедер',
    'ноги',
  ])('ловит «%s»', (text) => {
    expect(mentionsLegs(text)).toBe(true);
  });

  // Внутренняя поверхность ног — ДРУГАЯ зона прайса (вдвое дешевле), и
  // вступление про круговую проработку 7 зон к ней не относится.
  it.each([
    'внутренняя поверхность ног до колен',
    'Сколько стоит живот?',
    'Здравствуйте',
  ])('не срабатывает на «%s»', (text) => {
    expect(mentionsLegs(text)).toBe(false);
  });
});
