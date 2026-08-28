// Форматирование и разбор значений для интерфейса.
// Чистые функции: не читают DOM и не трогают состояние приложения.

import { WEEKDAYS_SHORT } from './constants.js';

// Стабильный цвет-заглушка из строки (аватары без фото, цвета услуг).
export function stringToColor(s) {
  let h = 0;
  for (let i = 0; i < (s || '').length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${h % 360} 60% 55%)`;
}

// Payload JWT без проверки подписи — только для UI (роль, права, срок).
export function decodeJwt(token) {
  try {
    const [, payload] = token.split('.');
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch { return null; }
}

export function clientInitial(name) {
  const s = String(name || '').trim();
  return s ? s[0].toUpperCase() : '?';
}

// «31.07.2026 в 14:05»
export function formatRuDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} в ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// «31.07 (пт)» — заголовки колонок графика
export function formatDateShort(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} (${WEEKDAYS_SHORT[d.getDay()]})`;
}

export function isWeekend(dateStr) {
  const dow = new Date(`${dateStr}T00:00:00`).getDay();
  return dow === 0 || dow === 6;
}

export function formatPhonePretty(p) {
  const raw = String(p || '');
  const d = raw.replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || raw.startsWith('+7'))) {
    return `+7 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
  }
  return raw;
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

// Русское склонение по числу: plural(5, ['услуга','услуги','услуг'])
export function plural(n, [one, few, many]) {
  const d10 = n % 10; const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

// ФИО с заглавных букв. Администратор набирает быстро, и в базу попадает
// «магомедова амина» или «МАГОМЕДОВА АМИНА» — в списке клиентов и в
// напоминаниях это видно сразу. Приводим каждое слово к «Магомедова»:
// первая буква заглавная, остальные строчные (иначе капслок так и остаётся).
// Двойные имена и фамилии через дефис — каждая часть отдельно: «Анна-Мария».
export function capitalizeName(raw) {
  return String(raw ?? '')
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map((word) => word
      .split('-')
      .map((part) => (part ? part[0].toLocaleUpperCase('ru') + part.slice(1).toLocaleLowerCase('ru') : part))
      .join('-'))
    .join(' ');
}
