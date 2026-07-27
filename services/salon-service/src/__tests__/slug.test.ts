import { describe, it, expect } from 'vitest';
import { slugify, uniqueSlug } from '../slug';

describe('slugify', () => {
  it('транслитерирует кириллицу', () => {
    expect(slugify('ЛЛ живота')).toBe('ll-zhivota');
    expect(slugify('Чистка лица')).toBe('chistka-lica');
    expect(slugify('Массаж спины')).toBe('massazh-spiny');
  });

  it('чистит спецсимволы и схлопывает дефисы', () => {
    expect(slugify('Пилинг (кислотный), 30%')).toBe('piling-kislotnyj-30');
    expect(slugify('  --Уход--  ')).toBe('ukhod');
  });

  it('латиница и цифры проходят как есть', () => {
    expect(slugify('RF-лифтинг 2.0')).toBe('rf-lifting-20');
  });

  it('пустой результат для названий без допустимых символов', () => {
    expect(slugify('***')).toBe('');
  });
});

describe('uniqueSlug', () => {
  it('возвращает base, если свободен', async () => {
    expect(await uniqueSlug('piling', async () => false, 'fb')).toBe('piling');
  });

  it('добавляет -2, -3 при коллизиях', async () => {
    const taken = new Set(['piling', 'piling-2']);
    expect(await uniqueSlug('piling', async (s) => taken.has(s), 'fb')).toBe('piling-3');
  });

  it('пустой base заменяется fallback', async () => {
    expect(await uniqueSlug('', async () => false, 'service-x')).toBe('service-x');
  });
});
