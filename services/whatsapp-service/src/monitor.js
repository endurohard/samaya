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
import { saveScraped, digitsOf, clientPhoneIndex, staffNames } from './store.js';

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
// Копировать только чаты, чей номер есть в базе клиентов.
//
// Умолчание true, и это важнее, чем кажется: без фильтра постоянный обход
// складывает в CRM всю переписку рабочего номера — личные чаты владельца,
// курьеров, поставщиков. Разовый импорт такой фильтр имел с самого начала
// (importAll({onlyClients})), а постоянный монитор — нет, и включение
// монитора «чтобы была история» незаметно означало совсем другое.
//
// Чат незнакомого номера при этом не теряется: новый клиент пишет, в CRM
// заводится карточка, и со следующего прохода его переписка копируется.
const CLIENTS_ONLY = process.env.WHATSAPP_MONITOR_CLIENTS_ONLY !== 'false';

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
    console.log(`[WA][monitor] enabled, watch=${WATCH_MS}ms full=${FULL_MS}ms`
      + `, только клиенты=${CLIENTS_ONLY ? 'да' : 'НЕТ (все чаты подряд)'}`);
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
      clients_only: CLIENTS_ONLY,
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
   * Отсеять чаты, которых нет в базе клиентов.
   *
   * Сопоставление по последним 10 цифрам — так же, как в разовом импорте:
   * «+7 (999)…» в карточке и «7999…» в заголовке чата должны сойтись.
   *
   * Сбой чтения базы НЕ должен приводить к копированию всех чатов подряд:
   * при ошибке возвращаем пустой список и пишем причину. Лучше пропустить
   * проход, чем один раз залить в CRM личную переписку — удалять её потом
   * придётся руками.
   */
  async _onlyClients(list) {
    if (!CLIENTS_ONLY) return list;
    try {
      const index = await clientPhoneIndex();
      // Имена клиентов — второй ключ сопоставления.
      //
      // Зачем: в строке списка WhatsApp показывает НОМЕР, только если
      // контакт не сохранён в телефоне. У сохранённого там стоит имя
      // («Юсуф Айти»), цифр нет вовсе — и фильтр по номеру отсеивал такой
      // чат как «вне базы клиентов». Из-за этого присланное фото не
      // доходило до CRM: в логе шло «пропущено N чат(ов)», а чат при этом
      // принадлежал настоящему клиенту.
      //
      // Храним СПИСОК карточек на имя, а не одну: в базе 7522 клиента, и
      // тёзки есть (два «Юсуфа» с разными номерами). Map имя→карточка
      // молча оставлял последнего, и чат мог уйти под чужой номер.
      const byName = new Map();
      for (const c of index.values()) {
        const n = String(c.name || '').toLowerCase().trim();
        if (n.length <= 3) continue;
        if (!byName.has(n)) byName.set(n, []);
        byName.get(n).push(c);
      }

      const keep = list.filter((c) => {
        const d = digitsOf(c.digits).slice(-10);
        if (d.length === 10 && index.has(d)) return true;
        const t = String(c.title || '').toLowerCase().trim();
        if (!t) return false;
        // Имя в списке и имя в карточке совпадают: в CRM «Юсуф», в WhatsApp
        // «Юсуф Айти» — сверяем вхождением в обе стороны.
        //
        // Если подошло НЕСКОЛЬКО карточек (в базе 7522 клиента, тёзки
        // неизбежны), чат пропускаем: лучше не прочитать, чем записать
        // переписку не тому человеку.
        const hits = [];
        for (const [name, clients] of byName) {
          if (t === name || t.includes(name) || name.includes(t)) hits.push(...clients);
          if (hits.length > 4) break;
        }
        if (!hits.length) return false;
        if (hits.length === 1) {
          // Номер берём из карточки: в строке списка его нет, а _readChats
          // открывает чат именно по номеру.
          c.digits = hits[0].digits;
          return true;
        }
        // Тёзки. Номер выберем позже, открыв чат и сверив заголовок, —
        // здесь просто запоминаем кандидатов.
        c.candidates = hits.map(x => x.digits);
        return true;
      });
      const skipped = list.length - keep.length;
      if (skipped) {
        console.log(`[WA][monitor] пропущено ${skipped} чат(ов) вне базы клиентов`);
      }
      return keep;
    } catch (e) {
      this.lastError = `база клиентов недоступна: ${e.message}`;
      console.error('[WA][monitor]', this.lastError);
      return [];
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

      const unread = await this._onlyClients(list.filter(c => c.unread > 0));
      const take = unread.slice(0, CHATS_PER_PASS);
      if (!take.length) return { chats: 0, saved: 0 };

      const r = await this._readChats(take);
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
      const picked = await this._onlyClients(full ? list : list.filter(c => c.unread > 0));
      const targets = picked.slice(0, CHATS_PER_PASS);
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
   * Разовый импорт истории переписки.
   *
   * Два режима:
   *   onlyClients=false — все доступные чаты подряд (как было);
   *   onlyClients=true  — только те чаты, чей номер есть в базе клиентов.
   *
   * Второй режим — основной рабочий: в списке WhatsApp хватает курьеров,
   * коллег и спама, тащить их переписку в CRM незачем. Сопоставление идёт
   * по последним 10 цифрам, поэтому «+7 (999)…» в карточке и «7999…» в
   * заголовке чата сходятся.
   *
   * Список чатов читается с прокруткой: WhatsApp держит в DOM только
   * видимые строки, и без неё импорт видел бы лишь первый экран.
   *
   * Идёт в фоне и переживает разрыв: состояние держим в this.importState,
   * чтобы прогресс был виден в админке. Запускать лучше в нерабочее время —
   * пока идёт импорт, сеанс занят и отправка ждёт очереди.
   */
  async importAll({ pauseMs = 4000, limit = 0, onlyClients = true, byClientBase = false } = {}) {
    if (this.importState?.running) return { error: 'импорт уже идёт' };
    if (!this.wa.isReady) return { error: 'WhatsApp не подключён' };

    let targets = [];
    let listLen = 0;
    let clientsTotal = 0;

    if (byClientBase) {
      // Идём ОТ БАЗЫ КЛИЕНТОВ, а не от видимого списка чатов. Каждый номер
      // ищется через строку поиска WhatsApp, поэтому находится и чат, лежащий
      // пятисотым, и чат сохранённого контакта, где вместо номера показано имя.
      // Список чатов при этом не нужен вовсе.
      const index = await clientPhoneIndex();
      clientsTotal = index.size;
      targets = [...index.values()].map((c) => ({ digits: c.digits, name: c.name }));
      console.log(`[WA][import] режим «по базе»: номеров клиентов ${clientsTotal}`);
    } else {
      // Прокрутка обязательна: иначе в списке будет десяток строк с экрана.
      const list = await this.wa.listChats({ scroll: true });
      listLen = list.length;
      targets = list;
      if (onlyClients) {
        const index = await clientPhoneIndex();
        clientsTotal = index.size;
        targets = list.filter((c) => index.has(digitsOf(c.digits).slice(-10)));
        console.log(`[WA][import] чатов в списке ${list.length}, `
          + `номеров клиентов ${clientsTotal}, совпало ${targets.length}`);
      }
    }
    const matched = targets.length;
    if (limit) targets = targets.slice(0, limit);

    this.importState = {
      running: true,
      mode: byClientBase ? 'by_client_base' : (onlyClients ? 'clients' : 'all'),
      chats_seen: listLen,
      clients_total: clientsTotal,
      matched,
      total: targets.length,
      done: 0,
      saved: 0,
      linked: 0,
      found: 0,
      not_found: 0,
      errors: 0,
      started_at: new Date().toISOString(),
      finished_at: null,
    };
    console.log(`[WA][import] старт: ${targets.length} номеров`);

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
            const res = await this.wa.readChat(digits, MSGS_PER_CHAT, await staffNames());
            const items = res?.items || [];
            if (res?.ok) this.importState.found++;
            else this.importState.not_found++;
            if (items.length) {
              const r = await saveScraped(digits, items);
              this.importState.saved += r.saved;
              this.importState.linked += r.linked || 0;
              // Под каким именем клиент записан в телефоне — ценная сверка
              // для администратора: в CRM он может быть записан иначе.
              if (res.title) {
                console.log(`[WA][import] ${digits} → «${res.title}»`
                  + (chat.name ? ` (в CRM: ${chat.name})` : ''));
              }
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
          console.log(`[WA][import] ${this.importState.done}/${this.importState.total}, `
            + `найдено ${this.importState.found}, сохранено ${this.importState.saved}`);
        }
        // Пауза между чатами больше обычной: импорт идёт долго, и частые
        // переключения подряд — самый заметный для WhatsApp признак бота.
        await new Promise(r => setTimeout(r, pauseMs));
      }
      this.importState.running = false;
      this.importState.finished_at = new Date().toISOString();
      console.log(`[WA][import] готово: найдено ${this.importState.found} чатов, `
        + `${this.importState.saved} сообщений, не найдено ${this.importState.not_found}`);
    })();

    return {
      started: true,
      total: targets.length,
      chats_seen: listLen,
      clients_total: clientsTotal,
      matched,
    };
  }

  importStatus() {
    return this.importState || { running: false };
  }

  // Общая часть дозора и полного обхода: открыть чаты и сохранить сообщения.
  async _readChats(targets) {
    let chats = 0; let saved = 0; let linked = 0;
    for (const chat of targets) {
      // Тёзки: имя в списке подошло нескольким карточкам. Перебираем их
      // номера — readChat сам сверяет заголовок открытого чата с
      // запрошенным номером и отказывается читать чужую переписку,
      // поэтому подойдёт ровно тот кандидат, чей чат это на самом деле.
      const tries = chat.candidates?.length ? chat.candidates : [digitsOf(chat.digits)];
      for (const digits of tries) {
        if (!digits) continue;
        try {
          // readChat возвращает объект-конверт {ok, count, items}, а не массив.
          const res = await this.wa.readChat(digits, MSGS_PER_CHAT, await staffNames());
          if (!res?.ok) continue;           // не тот номер — пробуем следующего
          const items = res.items || [];
          if (items.length) {
            const r = await saveScraped(digits, items);
            saved += r.saved;
            linked += r.linked || 0;
          }
          chats++;
          break;                            // нужный кандидат найден
        } catch (e) {
          // Один сломанный чат не должен прерывать обход остальных.
          console.error(`[WA][monitor] chat ${digits}:`, e.message);
        }
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
