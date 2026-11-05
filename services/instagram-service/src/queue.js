// Очередь ответов по диалогу.
//
// Webhook Meta приносит каждое сообщение отдельным запросом, и раньше на
// каждое сразу запускался свой ответ. Клиент пишет «Москва», через три
// секунды «65» — два ответа готовились одновременно, читали состояние опроса
// до записи друг друга, а после случайной паузы уходили в любом порядке. 4
// ноября так в 54 диалогах бот отвечал на уже устаревшую реплику.
//
// Здесь сообщения одного диалога копятся, пока клиент пишет, и уходят одной
// пачкой через delayMs после ПОСЛЕДНЕГО. Пачки одного диалога строго по
// очереди: пришедшее во время обработки ждёт её конца и идёт следующей
// пачкой. Разные диалоги друг друга не ждут.
//
// Очередь в памяти: экземпляр сервиса один. Перезапуск теряет только
// неотвеченные пачки последних секунд — сами сообщения уже сохранены в БД,
// и администратор их видит.

/**
 * Текст пачки для ассистента: реплики через перевод строки.
 *
 * Подряд одинаковые реплики («?», «?») схлопываются — это один вопрос.
 * Длинная пачка обрезается С НАЧАЛА целыми репликами: ассистенту нужнее
 * последнее, что написал клиент, а предел у /reply — 4000 символов.
 */
export function joinTexts(texts, max = 4000) {
  const lines = [];
  for (const raw of texts) {
    const t = String(raw ?? '').trim();
    if (!t || t === lines.at(-1)) continue;
    lines.push(t);
  }
  while (lines.length > 1 && lines.join('\n').length > max) lines.shift();
  const out = lines.join('\n');
  return out.length > max ? out.slice(-max) : out;
}

/**
 * @param {object} o
 * @param {number} o.delayMs   сколько ждать после последнего сообщения
 * @param {number} [o.jitterMs] случайная добавка к ожиданию: мгновенный
 *   ответ с точностью до секунды читается как бот и клиентом, и антифродом Meta
 * @param {(threadId: string, batch: any[]) => Promise<void>} o.handle
 * @param {(e: Error, threadId: string) => void} [o.onError]
 */
export function createThreadQueue({ delayMs, jitterMs = 0, handle, onError }) {
  /** @type {Map<string, {pending: any[], timer: any, running: boolean}>} */
  const threads = new Map();
  let idleWaiters = [];

  function settleIfIdle() {
    if (threads.size) return;
    const w = idleWaiters;
    idleWaiters = [];
    for (const resolve of w) resolve();
  }

  function schedule(threadId, t) {
    if (t.running) return; // доберётся после текущей пачки
    clearTimeout(t.timer);
    const wait = delayMs + (jitterMs ? Math.floor(Math.random() * jitterMs) : 0);
    t.timer = setTimeout(() => { run(threadId); }, wait);
  }

  async function run(threadId) {
    const t = threads.get(threadId);
    if (!t) return;
    t.timer = null;
    const batch = t.pending.splice(0);
    if (!batch.length) { threads.delete(threadId); settleIfIdle(); return; }
    t.running = true;
    try {
      await handle(threadId, batch);
    } catch (e) {
      try { onError?.(e, threadId); } catch { /* лог не должен ронять очередь */ }
    } finally {
      t.running = false;
      if (t.pending.length) schedule(threadId, t);
      else { threads.delete(threadId); settleIfIdle(); }
    }
  }

  return {
    /** Добавить сообщение диалога; ответ — после паузы в переписке. */
    push(threadId, item) {
      const id = String(threadId);
      let t = threads.get(id);
      if (!t) { t = { pending: [], timer: null, running: false }; threads.set(id, t); }
      t.pending.push(item);
      schedule(id, t);
    },
    /** Сколько диалогов ждут или обрабатываются (для /health и логов). */
    size() { return threads.size; },
    /** Дождаться, пока очередь опустеет. */
    drain() {
      if (!threads.size) return Promise.resolve();
      return new Promise(resolve => idleWaiters.push(resolve));
    },
  };
}
