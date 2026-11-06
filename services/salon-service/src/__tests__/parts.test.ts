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

  // Решение владельца (6 ноября): на вопрос про ноги автоответ — схемы
  // зон и текст про 7 зон, затем цена круговой. Текст шаблона-вступления
  // («Круговая… пришлите фото ног») автоответом больше не уходит: он
  // остаётся менеджеру под кодом 6.
  it('схемы зон, затем текст про 7 зон — без текста вступления', () => {
    const parts = orderIntroParts(own, method);
    expect(parts.map((p: ReplyPart) => p.type)).toEqual(['image', 'image', 'text']);
    expect(parts[0]).toEqual({ type: 'image', asset: 'legs-zones-front' });
    expect(parts[1]).toEqual({ type: 'image', asset: 'legs-zones-back' });
    expect((parts[2] as { text: string }).text).toContain('Выше показали');
    expect(JSON.stringify(parts)).not.toContain('Пришлите');
  });

  it('без текста про 7 зон — только схемы', () => {
    const parts = orderIntroParts(own, []);
    expect(parts.map((p: ReplyPart) => p.type)).toEqual(['image', 'image']);
  });
});
