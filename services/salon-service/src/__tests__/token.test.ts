import { describe, it, expect } from 'vitest';
import { newCatalogToken, CATALOG_TOKEN_RE } from '../token';

describe('catalog token', () => {
  it('is url-safe and matches the public route guard', () => {
    for (let i = 0; i < 50; i++) {
      const t = newCatalogToken();
      expect(t).toHaveLength(16);
      expect(CATALOG_TOKEN_RE.test(t)).toBe(true);
    }
  });

  it('is unique across generations', () => {
    const set = new Set(Array.from({ length: 1000 }, () => newCatalogToken()));
    expect(set.size).toBe(1000);
  });

  it('guard rejects junk that could reach the SQL query', () => {
    for (const bad of ['', 'abc', "x'; DROP", 'a b c d e f g h i j k l', 'ы'.repeat(16), 'a'.repeat(33)]) {
      expect(CATALOG_TOKEN_RE.test(bad)).toBe(false);
    }
  });
});
