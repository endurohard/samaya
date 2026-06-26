// Неблокирующие уведомления вместо alert(). Самодостаточный модуль:
// создаёт контейнер и инжектит свои стили один раз.

let container = null;

function ensureContainer() {
  if (container) return container;
  const style = document.createElement('style');
  style.textContent = `
    .toast-stack { position: fixed; top: 16px; right: 16px; z-index: 9999;
      display: flex; flex-direction: column; gap: 8px; max-width: 360px; }
    .toast { padding: 12px 16px; border-radius: 10px; color: #fff;
      font-size: 14px; line-height: 1.4; box-shadow: 0 6px 24px rgba(0,0,0,.18);
      opacity: 0; transform: translateY(-8px); transition: opacity .2s, transform .2s;
      word-break: break-word; }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast-info  { background: #334155; }
    .toast-success { background: #16a34a; }
    .toast-error { background: #dc2626; }
    @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
  `;
  document.head.appendChild(style);
  container = document.createElement('div');
  container.className = 'toast-stack';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  document.body.appendChild(container);
  return container;
}

// Если тип не задан явно — выводим его из текста сообщения.
function inferType(msg) {
  const s = String(msg ?? '').toLowerCase();
  if (/ошибк|не удалось|слишком|нет\s|пуст|заполни|выбери|добавь|сначала|формат/.test(s)) return 'error';
  if (/перенесено|сохранено|начислено|отправлено|списано|применен|готов|успешн/.test(s)) return 'success';
  return 'info';
}

/** type: 'info' | 'success' | 'error' (по умолчанию выводится из текста) */
export function toast(message, type, timeoutMs = 4000) {
  if (type === undefined) type = inferType(message);
  const root = ensureContainer();
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = String(message ?? '');
  root.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  const remove = () => {
    el.classList.remove('show');
    setTimeout(() => el.remove(), 200);
  };
  setTimeout(remove, timeoutMs);
  el.addEventListener('click', remove);
  return el;
}
