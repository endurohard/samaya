// Монитор переписки: следит за окном WhatsApp Web и складывает сообщения в БД.
//
// Почему обход страницы, а не события библиотеки: whatsapp-web.js не работает
// с текущей вёрсткой WhatsApp (внутренний Store не инициализируется), а
// официального API у веб-версии нет. Читаем то же, что видит человек.
//
// Два цикла с разной ценой действия:
//
//   «дозор» (WATCH_MS, часто) — только чтение списка чатов. Это разбор уже
//   отрисованного DOM: без кликов, переключений и переходов. Для WhatsApp
//   такой проход неотличим от простого нахождения страницы открытой, поэтому
//   его не страшно делать раз в несколько секунд. Именно он даёт быстрое
//   уведомление: увидели счётчик непрочитанных — сразу читаем этот чат.
//
//   «полный обход» (FULL_MS, редко) — заходит во все чаты подряд. Нужен на
//   случай, когда чат прочитали с телефона и счётчик непрочитанных сбросился
//   раньше, чем дозор его увидел. Открытие чата — самое заметное для WhatsApp
//   действие, поэтому оно остаётся редким.
import { saveScraped, digitsOf } from './store.js';

const WATCH_MS = Number(process.env.WHATSAPP_MONITOR_WATCH_MS || 8_000);
const FULL_MS = Number(process.env.WHATSAPP_MONITOR_FULL_MS || 900_000);
const CHATS_PER_PASS = Number(process.env.WHATSAPP_MONITOR_CHATS || 10);
const MSGS_PER_CHAT = Number(process.env.WHATSAPP_MONITOR_DEPTH || 50);
// Монитор включается ТОЛЬКО явным WHATSAPP_MONITOR=true.
// Раньше условие было «!== 'false'», то есть при отсутствии переменной обход
// чатов стартовал сам. На боевом номере клиники это значит, что сервис без
// спроса вычитает всю переписку — включая личные чаты владельца — и сложит её
// в базу. Такое решение принимает человек, а не значение по умолчанию.
const ENABLED = process.env.WHATSAPP_MONITOR === 'true';

export class Monitor {
  constructor(wa) {
    this.wa = wa;
    this.watchTimer = null;
    this.fullTimer = null;
    this.running = false;
    this.lastRun = null;
    this.lastWatch = null;
    this.lastError = null;
    this.importState = null;
    this.stats = { watches: 0, fulls: 0, chats: 0, saved: 0 };
  }

  start() {
    if (!ENABLED || this.watchTimer) return;
    // Первые проходы с задержкой: после старта сеанс ещё синхронизируется с
    // телефоном, и список чатов может быть неполным.
    this.watchTimer = setTimeout(() => this._watchLoop(), 30_000);
    this.fullTimer = setTimeout(() => this._fullLoop(), 60_000);
    console.log(`[WA][monitor] enabled, watch=${WATCH_MS}ms full=${FULL_MS}ms`);
  }

  stop() {
    if (this.watchTimer) clearTimeout(this.watchTimer);
    if (this.fullTimer) clearTimeout(this.fullTimer);
    this.watchTimer = null;
    this.fullTimer = null;
  }

  status() {
    return {
      enabled: ENABLED,
      running: this.running,
      watch_ms: WATCH_MS,
      full_ms: FULL_MS,
      last_run: this.lastRun,
      last_watch: this.lastWatch,
      last_error: this.lastError,
      ...this.stats,
    };
  }

  async _watchLoop() {
    try {
      await this.watch();
    } catch (e) {
      this.lastError = e.message;
    } finally {
      // Планируем следующий дозор в любом случае: разовая ошибка (сеанс занят,
      // страница перерисовывается) не должна останавливать слежение навсегда.
      this.watchTimer = setTimeout(() => this._watchLoop(), WATCH_MS);
    }
  }

  async _fullLoop() {
    try {
      await this.runOnce(true);
    } catch (e) {
      this.lastError = e.message;
      console.error('[WA][monitor]', e.message);
    } finally {
      this.fullTimer = setTimeout(() => this._fullLoop(), FULL_MS);
    }
  }

  /**
   * Дозор: смотрим только список чатов и читаем те, где есть непрочитанные.
   * Если нового нет — не трогаем страницу вообще.
   */
  async watch() {
    if (this.running || !this.wa.isReady) return { skipped: true };
    this.running = true;
    try {
      const list = await this.wa.listChats();
      this.stats.watches++;
      this.lastWatch = new Date().toISOString();

      const unread = list.filter(c => c.unread > 0).slice(0, CHATS_PER_PASS);
      if (!unread.length) return { chats: 0, saved: 0 };

      const r = await this._readChats(unread);
      if (r.saved) console.log(`[WA][monitor] watch: ${r.saved} new message(s)`);
      return r;
    } finally {
      this.running = false;
    }
  }

  async runOnce(full = false) {
    if (this.running) return { skipped: 'already running' };
    if (!this.wa.isReady) return { skipped: 'not ready' };

    this.running = true;
    try {
      const list = await this.wa.listChats();
      const targets = (full ? list : list.filter(c => c.unread > 0)).slice(0, CHATS_PER_PASS);
      if (full) this.stats.fulls++;
      if (!targets.length) {
        this.lastRun = new Date().toISOString();
        this.lastError = null;
        return { chats: 0, saved: 0, linked: 0, mode: full ? 'full' : 'unread-only' };
      }
      const r = await this._readChats(targets);
      this.lastRun = new Date().toISOString();
      this.lastError = null;
      if (r.saved || r.linked) {
        console.log(`[WA][monitor] pass: ${r.chats} chats, ${r.saved} new, ${r.linked} linked`);
      }
      return { ...r, mode: full ? 'full' : 'unread-only' };
    } finally {
      this.running = false;
    }
  }

  /**
   * Разовый импорт всей истории: проход по всем чатам подряд.
   *
   * Нужен один раз при подключении боевого номера, где уже накоплены сотни
   * чатов: обычный цикл разгребал бы их сутки. Запускать в нерабочее время —
   * пока идёт импорт, сеанс занят и отправка сообщений ждёт очереди.
   *
   * Идёт в фоне и переживает разрыв: состояние держим в this.importState,
   * чтобы прогресс был виден в админке.
   */
  async importAll({ pauseMs = 4000, limit = 0 } = {}) {
    if (this.importState?.running) return { error: 'импорт уже идёт' };
    if (!this.wa.isReady) return { error: 'WhatsApp не подключён' };

    const list = await this.wa.listChats();
    const targets = limit ? list.slice(0, limit) : list;
    this.importState = {
      running: true,
      total: targets.length,
      done: 0,
      saved: 0,
      linked: 0,
      errors: 0,
      started_at: new Date().toISOString(),
      finished_at: null,
    };
    console.log(`[WA][import] старт: ${targets.length} чатов`);

    // Не ждём завершения: обход часами держал бы HTTP-запрос открытым.
    void (async () => {
      for (const chat of targets) {
        const digits = digitsOf(chat.digits);
        try {
          // Ждём, пока освободится сеанс: дозор и отправка имеют приоритет,
          // импорт фоновый и может подождать.
          while (this.running) await new Promise(r => setTimeout(r, 1000));
          this.running = true;
          try {
            const res = await this.wa.readChat(digits, MSGS_PER_CHAT);
            const items = res?.items || [];
            if (items.length) {
              const r = await saveScraped(digits, items);
              this.importState.saved += r.saved;
              this.importState.linked += r.linked || 0;
            }
          } finally {
            this.running = false;
          }
        } catch (e) {
          this.importState.errors++;
          console.error(`[WA][import] chat ${digits}:`, e.message);
        }
        this.importState.done++;
        if (this.importState.done % 25 === 0) {
          console.log(`[WA][import] ${this.importState.done}/${this.importState.total}, сохранено ${this.importState.saved}`);
        }
        // Пауза между чатами больше обычной: импорт идёт долго, и частые
        // переключения подряд — самый заметный для WhatsApp признак бота.
        await new Promise(r => setTimeout(r, pauseMs));
      }
      this.importState.running = false;
      this.importState.finished_at = new Date().toISOString();
      console.log(`[WA][import] готово: ${this.importState.saved} сообщений из ${this.importState.done} чатов`);
    })();

    return { started: true, total: targets.length };
  }

  importStatus() {
    return this.importState || { running: false };
  }

  // Общая часть дозора и полного обхода: открыть чаты и сохранить сообщения.
  async _readChats(targets) {
    let chats = 0; let saved = 0; let linked = 0;
    for (const chat of targets) {
      const digits = digitsOf(chat.digits);
      try {
        // readChat возвращает объект-конверт {ok, count, items}, а не массив.
        const res = await this.wa.readChat(digits, MSGS_PER_CHAT);
        const items = res?.items || [];
        if (items.length) {
          const r = await saveScraped(digits, items);
          saved += r.saved;
          linked += r.linked || 0;
        }
        chats++;
      } catch (e) {
        // Один сломанный чат не должен прерывать обход остальных.
        console.error(`[WA][monitor] chat ${digits}:`, e.message);
      }
      // Пауза между чатами: подряд идущие переключения выглядят как
      // автоматизация и нагружают страницу.
      if (targets.length > 1) await new Promise(r => setTimeout(r, 2000));
    }
    this.stats.chats += chats;
    this.stats.saved += saved;
    return { chats, saved, linked };
  }
}
