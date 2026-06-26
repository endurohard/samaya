// Чистые утилиты без зависимостей от состояния приложения.

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formatPrice(p) {
  const n = Number(p);
  if (!isFinite(n)) return '—';
  return n.toLocaleString('ru-RU') + ' ₽';
}

export function fmtMoney(n) {
  if (n == null || isNaN(n)) return '—';
  if (n === 0) return '—';
  return n.toLocaleString('ru-RU', { maximumFractionDigits: 2 });
}

export function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  return dateToISO(dt);
}
