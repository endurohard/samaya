import { describe, it, expect } from 'vitest';
import { parseParts } from '../ai/parts';
import { mentionsLegs, orderIntroParts } from '../ai/intro';
import type { ReplyPart } from '../ai/parts';

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

describe('orderIntroParts', () => {
  // Порядок задан владельцем: сначала клиент видит СХЕМЫ ЗОН, потом читает
  // про методику и 7 зон, и только последним — просьбу прислать свои фото.
  const own = parseParts([
    '--- фото: legs-zones-front',
    '--- фото: legs-zones-back',
    '--- текст',
    'Пришлите, пожалуйста, фото ног прямо, сбоку и со спины 🤍',
  ].join('\n'));
  const method = parseParts('Уникальная авторская методика… Выше показали, какие именно 7 зон 🤍');

  it('ставит схемы зон первыми, просьбу о фото — последней', () => {
    const parts = orderIntroParts(own, method);
    expect(parts.map((p: ReplyPart) => p.type)).toEqual(['image', 'image', 'text', 'text']);
    expect(parts[0]).toEqual({ type: 'image', asset: 'legs-zones-front' });
    expect(parts[1]).toEqual({ type: 'image', asset: 'legs-zones-back' });
    // Текст про 7 зон обязан идти СРАЗУ за картинками: он на них ссылается
    // словами «Выше показали».
    expect((parts[2] as { text: string }).text).toContain('Выше показали');
    expect((parts[3] as { text: string }).text).toContain('Пришлите');
  });

  it('не теряет и не дублирует части', () => {
    const parts = orderIntroParts(own, method);
    expect(parts).toHaveLength(own.length + method.length);
    const texts = parts.filter((p: ReplyPart) => p.type === 'text').map((p) => (p as { text: string }).text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it('без второй темы отправляет только свои части', () => {
    const parts = orderIntroParts(own, []);
    expect(parts.map((p: ReplyPart) => p.type)).toEqual(['image', 'image', 'text']);
  });
});
