// ЧПУ услуги из названия: транслитерация RU→latin + чистка.
// Должна давать тот же результат, что бэкфилл в миграции 041.

const MULTI: Record<string, string> = {
  ж: 'zh', ч: 'ch', ш: 'sh', щ: 'sch', ю: 'yu', я: 'ya', ё: 'yo', х: 'kh',
};
const SINGLE: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', з: 'z', и: 'i', й: 'j',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', ц: 'c', ы: 'y', ь: '-', ъ: '-', э: 'e',
  ' ': '-', '+': '-', '/': '-',
};

export function slugify(name: string): string {
  const out: string[] = [];
  for (const ch of name.toLowerCase()) {
    if (MULTI[ch] !== undefined) out.push(MULTI[ch]);
    else if (SINGLE[ch] !== undefined) out.push(SINGLE[ch]);
    else if (/[a-z0-9-]/.test(ch)) out.push(ch);
  }
  return out.join('').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
}

// Уникальный slug внутри компании: base, base-2, base-3, …
// exists — проверка занятости (исключая, при правке, саму услугу).
export async function uniqueSlug(
  base: string,
  exists: (slug: string) => Promise<boolean>,
  fallback: string,
): Promise<string> {
  const root = base || fallback;
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? root : `${root}-${i}`;
    if (!(await exists(candidate))) return candidate;
  }
  return `${root}-${Date.now()}`;
}
