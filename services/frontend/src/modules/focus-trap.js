// Удержание фокуса внутри модального окна + возврат фокуса при закрытии.
// Использование: const release = trapFocus(modalEl); ... release();

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled])',
  'select:not([disabled])', 'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

export function trapFocus(modal) {
  const prevActive = document.activeElement;

  function focusables() {
    return Array.from(modal.querySelectorAll(FOCUSABLE))
      .filter((el) => el.offsetParent !== null);
  }

  function onKeydown(e) {
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault(); last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault(); first.focus();
    }
  }

  modal.addEventListener('keydown', onKeydown);
  // первичный фокус — на первый интерактивный элемент
  const items = focusables();
  if (items.length) items[0].focus();

  return function release() {
    modal.removeEventListener('keydown', onKeydown);
    if (prevActive && typeof prevActive.focus === 'function') prevActive.focus();
  };
}
