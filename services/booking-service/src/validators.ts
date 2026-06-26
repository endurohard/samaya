import { z } from 'zod';

// Дата YYYY-MM-DD с проверкой реальности (regex пропускает 2026-13-99 — Postgres
// потом падает 500; refine отбраковывает несуществующие даты на уровне валидации → 400).
export function isoDate() {
  return z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    .refine((s) => {
      const [y, m, d] = s.split('-').map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d));
      return (
        dt.getUTCFullYear() === y &&
        dt.getUTCMonth() === m - 1 &&
        dt.getUTCDate() === d
      );
    }, 'invalid calendar date');
}
