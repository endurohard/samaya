import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SESSION_DIR = process.env.WHATSAPP_SESSION_DIR
  || path.join(__dirname, '../data/session');
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const TEST_MODE = process.env.WHATSAPP_TEST_MODE === 'true';
const SOCKS_PROXY = process.env.WHATSAPP_SOCKS_PROXY || '';

// Белый список получателей — предохранитель для боевой сессии.
// Локальная база — копия прода с настоящими телефонами клиентов, и одна
// случайно запущенная рассылка ушла бы живым людям.
//
// Пустая строка = ограничения нет. Это опасное значение по умолчанию, поэтому
// при пустом списке И выключенном TEST_MODE сервис громко предупреждает на
// старте: молча разрешать отправку 7454 живым людям он не должен.
//
// Номера приводятся к тому же виду, что и получатель в _normalizePhone
// (8… → 7…, без разделителей): иначе «8916…» в списке никогда не совпало бы
// с нормализованным «7916…», и разрешённый номер молча блокировался бы.
function normalizeMsisdn(raw) {
  let d = String(raw || '').replace(/[^0-9]/g, '');
  if (d.startsWith('8')) d = '7' + d.slice(1);
  if (d && !d.startsWith('7')) d = '7' + d;
  return d;
}

const ALLOWLIST = (process.env.WHATSAPP_ALLOWLIST || '')
  .split(',')
  .map(normalizeMsisdn)
  .filter(Boolean);

// Поле ввода сообщения. Порядок важен: сначала footer — в текущей вёрстке
// WhatsApp это единственный устойчивый признак, потому что data-testid с поля
// убрали, а обфусцированные классы меняются от сборки к сборке. Набор взят из
// рабочей реализации в ~/work/pack (whatsappManager.js), проверенной на живых
// отправках.
const COMPOSE_SELECTORS = [
  'footer [contenteditable="true"]',
  'div[contenteditable="true"][data-tab="10"]',
  '[data-testid="conversation-compose-box-input"]',
];
const COMPOSE_SELECTOR = COMPOSE_SELECTORS.join(', ');

// Кнопка отправки. Enter в поле ввода работает не всегда (в некоторых сборках
// он ставит перенос строки), поэтому жмём именно кнопку, а Enter оставляем
// запасным вариантом.
const SEND_SELECTORS = [
  'span[data-icon="send"]',
  '[data-testid="send"]',
  'button[aria-label*="Отправить"]',
  'button[aria-label*="Send"]',
];

class WhatsAppManager {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isReady = false;
    this.qrDataUrl = null;       // base64 QR png
    this.statusMsg = 'not_started';
    this.lastError = null;
    this._initPromise = null;
    // Единственная страница Puppeteer — все операции с ней сериализуем через эту
    // очередь, иначе параллельные отправки перемешивают ввод и сообщение уходит
    // не тому получателю.
    this._queue = Promise.resolve();
    this._healthIv = null;

    if (!fs.existsSync(SESSION_DIR)) {
      fs.mkdirSync(SESSION_DIR, { recursive: true });
    }

    if (TEST_MODE) {
      this.isReady = true;
      this.statusMsg = 'test_mode';
      console.log('[WA] TEST MODE — messages will NOT be sent');
    }
  }

  getStatus() {
    return {
      ready: this.isReady,
      status: this.statusMsg,
      test_mode: TEST_MODE,
      has_qr: !!this.qrDataUrl,
      last_error: this.lastError,
      // Сколько номеров в белом списке (сами номера не отдаём). 0 — отправка
      // разрешена всем.
      allowlist_size: ALLOWLIST.length,
    };
  }

  getQR() { return this.qrDataUrl; }

  // Сериализация операций с единственной страницей. Каждая задача ждёт завершения
  // предыдущей; ошибка одной задачи не рвёт цепочку для следующих.
  _enqueue(fn) {
    // _busy взводим на всё время работы с page: проверка живости в этот момент
    // видит промежуточное состояние DOM (идёт переключение чата) и принимает
    // его за разлогин. Занятый сеанс и так доказывает, что он жив.
    const wrapped = async () => {
      this._busy = true;
      try {
        return await fn();
      } finally {
        this._busy = false;
      }
    };
    const run = this._queue.then(() => wrapped(), () => wrapped());
    // держим «хвост» очереди, но проглатываем результат/ошибку, чтобы не копить unhandled
    this._queue = run.then(() => {}, () => {});
    return run;
  }

  // ── Cleanup stale Chrome processes (iTTEST pattern) ──
  async _cleanup() {
    const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    // Это симлинки вида `<hostname>-<pid>`, и после пересоздания контейнера они
    // «битые» — цель не существует. fs.existsSync идёт по ссылке и возвращает
    // false, поэтому раньше очистка не срабатывала: Chromium видел чужой
    // hostname в локе, считал профиль занятым «другим компьютером» и падал
    // с Code 21, а привязанная сессия выглядела потерянной.
    const present = locks.filter((f) => {
      try {
        fs.lstatSync(path.join(SESSION_DIR, f));
        return true;
      } catch {
        return false;
      }
    });
    if (present.length === 0) return;
    console.log('[WA] Cleaning stale Chrome locks…');
    // Убиваем только процессы Chromium этой сессии (по userDataDir), а не все
    // headless-браузеры в контейнере.
    try {
      await execAsync(`pkill -9 -f ${JSON.stringify('user-data-dir=' + SESSION_DIR)} 2>/dev/null`);
    } catch { /* ok */ }
    await new Promise(r => setTimeout(r, 1500));
    for (const f of present) {
      try { fs.unlinkSync(path.join(SESSION_DIR, f)); } catch { /* ok */ }
    }
  }

  async initialize() {
    if (TEST_MODE || this._initPromise) return this._initPromise;
    this._initPromise = this._doInit();
    return this._initPromise;
  }

  async _doInit() {
    this.statusMsg = 'initializing';
    try {
      await this._cleanup();
      const args = [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--disable-web-security',
        `--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36`,
      ];
      if (SOCKS_PROXY) {
        args.push(`--proxy-server=${SOCKS_PROXY}`);
        // Локальные адреса мимо прокси: иначе обращения к самому мосту
        // и к localhost внутри контейнера пошли бы по кругу через туннель.
        args.push('--proxy-bypass-list=<-loopback>');
        // WebRTC в обход прокси показывает настоящий IP сервера — ровно то
        // расхождение, ради устранения которого туннель и поднимается.
        args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
        args.push('--webrtc-ip-handling-policy=disable_non_proxied_udp');
        console.log(`[WA] прокси: ${SOCKS_PROXY}`);
      }

      this.browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        userDataDir: SESSION_DIR,
        protocolTimeout: 300_000,
        args,
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1280, height: 720 });

      console.log('[WA] Opening WhatsApp Web…');
      this.statusMsg = 'loading';

      await this.page.goto('https://web.whatsapp.com', {
        waitUntil: 'networkidle2',
        timeout: 60_000,
      });

      this._pollAuth();
    } catch (err) {
      this.statusMsg = 'error';
      this.lastError = err.message;
      this._initPromise = null;
      // Закрываем частично поднятый браузер, иначе процесс Chromium утекает
      // и накапливается при повторных сбоях инициализации.
      try { if (this.browser) await this.browser.close(); } catch { /* ok */ }
      this.browser = null;
      this.page = null;
      console.error('[WA] Init error:', err.message);
    }
  }

  // Периодическая проверка живости веб-сессии. Если телефон разлогинил сессию,
  // isReady сбрасывается и запускается переинициализация — иначе отправки молча
  // висят по 30 c на waitForSelector, а статус остаётся 'ready'.
  _startHealthCheck() {
    if (this._healthIv) clearInterval(this._healthIv);
    this._healthMisses = 0;
    this._healthIv = setInterval(async () => {
      if (!this.isReady || !this.page) return;
      // Пока идёт работа с чатами, страница переключается, и проверка ловит
      // промежуточное состояние. Занятый сеанс — сам по себе признак жизни.
      if (this._busy) return;
      try {
        const alive = await this.page.evaluate(() => {
          // Боковая панель в новой вёрстке — #pane-side; #side остался не везде.
          return !!(document.querySelector('#side')
            || document.querySelector('#pane-side')
            || document.querySelector('[role="row"]')
            || document.querySelector('[data-testid="chat-list"]'));
        });
        if (alive) { this._healthMisses = 0; return; }
        // Один промах ничего не значит: DOM мог перерисовываться в этот момент.
        // Выход из аккаунта — состояние устойчивое, оно переживёт три проверки.
        this._healthMisses++;
        if (this._healthMisses < 3) {
          console.warn(`[WA] Health check miss ${this._healthMisses}/3`);
          return;
        }
        console.warn('[WA] Session appears logged out — reinitializing');
        this.isReady = false;
        this.statusMsg = 'disconnected';
        clearInterval(this._healthIv);
        this._healthIv = null;
        this.restart().catch(e => console.error('[WA] auto-restart failed:', e.message));
      } catch (e) {
        // «Execution context was destroyed» — это навигация, а не разлогин.
        // Сбрасывать сеанс по такой ошибке нельзя: она возникает штатно, когда
        // монитор открывает чат.
        console.warn('[WA] Health check error:', e.message);
      }
    }, 30_000);
  }

  // Poll until authenticated or QR appears
  _pollAuth() {
    let attempts = 0;
    const MAX = 120; // 10 min
    const iv = setInterval(async () => {
      attempts++;
      try {
        const state = await this.page.evaluate(() => {
          const hasChats = !!document.querySelector('[data-testid="chat-list"]');
          const hasSide  = !!document.querySelector('#side');
          const hasUser  = !!document.querySelector('[data-testid="default-user"]');
          const noLanding = !document.querySelector('.landing-main');
          const hasQRCanvas = !!document.querySelector('canvas');
          return { hasChats, hasSide, hasUser, noLanding, hasQRCanvas };
        });

        const authScore = [state.hasChats, state.hasSide, state.hasUser, state.noLanding]
          .filter(Boolean).length;

        if (authScore >= 2) {
          clearInterval(iv);
          this.isReady = true;
          this.qrDataUrl = null;
          this.statusMsg = 'ready';
          console.log('[WA] Ready!');
          this._startHealthCheck();
          return;
        }

        // QR code visible — capture it
        if (state.hasQRCanvas) {
          this.statusMsg = 'waiting_qr_scan';
          try {
            const dataUrl = await this.page.evaluate(() => {
              const c = document.querySelector('canvas');
              return c ? c.toDataURL('image/png') : null;
            });
            if (dataUrl) this.qrDataUrl = dataUrl;
          } catch { /* ok */ }
        }

        if (attempts >= MAX) {
          clearInterval(iv);
          this.statusMsg = 'timeout';
          this.lastError = 'Auth timeout (10 min)';
          console.error('[WA] Auth timeout');
        }
      } catch (e) {
        console.warn('[WA] Poll error:', e.message);
      }
    }, 5_000);
  }

  // ── Phone normalization ──
  // Бросает при мусорном/слишком коротком вводе, иначе можно отправить на «7».
  _normalizePhone(raw) {
    const d = normalizeMsisdn(raw);
    if (d.length < 11 || d.length > 15) {
      throw new Error(`invalid phone: ${raw}`);
    }
    return d;
  }

  // ── Open chat then send text ──
  async _openChat(phone) {
    const url = `https://web.whatsapp.com/send?phone=${phone}`;
    // Всегда goto, а не присваивание window.location: при присваивании
    // навигация продолжается уже после возврата из evaluate, и следующий
    // waitForSelector падает с «execution context was destroyed» через
    // секунду-две, не дожидаясь своего таймаута. Выглядело это как «поле
    // ввода не найдено», хотя поле на месте.
    await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });

    // Чат открывается не мгновенно даже после networkidle2; даём вёрстке
    // дорисоваться и только потом ждём поле.
    await this.page.waitForSelector(COMPOSE_SELECTOR, { timeout: 45_000 });
    await new Promise(r => setTimeout(r, 1000));
  }

  async sendMessage(phone, message) {
    // Валидируем номер до постановки в очередь, чтобы плохой ввод не занимал слот.
    const clean = this._normalizePhone(phone);

    // Предохранитель: с непустым allowlist уходят только разрешённые номера.
    // Проверка здесь, а не в роуте, — так её не обойдёт ни /send, ни
    // /broadcast, ни напоминания из booking-service. И до ветки TEST_MODE:
    // иначе тестовый прогон рапортует success на номер, который в боевом
    // режиме был бы заблокирован, и предохранитель нельзя проверить заранее.
    if (ALLOWLIST.length > 0 && !ALLOWLIST.includes(clean)) {
      throw new Error(`blocked by allowlist: ${clean}`);
    }

    if (TEST_MODE) {
      console.log(`[WA][TEST] → ${clean}: ${message.slice(0, 80)}`);
      return { success: true, test_mode: true, phone: clean };
    }

    // Все операции с this.page строго последовательны — см. _enqueue.
    return this._enqueue(async () => {
      if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
      console.log(`[WA] Sending to ${clean}…`);

      // Сначала пробуем открыть уже существующий чат кликом по списку. Ссылка
      // /send?phone= у аккаунта с ограничением «нельзя начинать новые чаты»
      // открывает экран вообще без поля ввода, даже когда переписка с этим
      // номером есть. Клик по строке списка такого ограничения не касается.
      await this.dismissDialogs();
      const opened = await this.openChatByRow(clean);
      if (!opened.ok) {
        // Чата в списке нет — это новый собеседник, тут без ссылки никак.
        await this._openChat(clean);
      } else {
        await new Promise(r => setTimeout(r, 2000));
      }

      // Поле ввода: ждём любой из известных селекторов.
      await this.page.waitForSelector(COMPOSE_SELECTOR, { timeout: 30_000 })
        .catch(() => { throw new Error('поле ввода недоступно (ограничение аккаунта или чат не открылся)'); });

      const input = await this.page.$(COMPOSE_SELECTOR);
      if (!input) throw new Error('поле ввода не найдено');
      await input.click();
      await new Promise(r => setTimeout(r, 300));

      // Многострочный текст: перевод строки — Shift+Enter, иначе каждая строка
      // ушла бы отдельным сообщением.
      const lines = message.split('\n');
      for (let i = 0; i < lines.length; i++) {
        await this.page.keyboard.type(lines[i]);
        if (i < lines.length - 1) {
          await this.page.keyboard.down('Shift');
          await this.page.keyboard.press('Enter');
          await this.page.keyboard.up('Shift');
        }
      }
      await new Promise(r => setTimeout(r, 400));

      // Отправка кнопкой: Enter в некоторых сборках только переносит строку.
      let sent = false;
      for (const sel of SEND_SELECTORS) {
        const btn = await this.page.$(sel);
        if (btn) { await btn.click(); sent = true; break; }
      }
      if (!sent) await this.page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 1500));

      // Подтверждение отправки: поле ввода должно очиститься. Если текст остался —
      // сообщение не ушло (сетевой лаг/зависание), не рапортуем ложный success.
      const stillHasText = await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        return !!(el && el.textContent && el.textContent.trim().length > 0);
      }, COMPOSE_SELECTOR).catch(() => false);
      if (stillHasText) {
        throw new Error('message not sent (compose box not cleared)');
      }

      console.log(`[WA] Sent to ${clean}`);
      return { success: true, phone: clean };
    });
  }

  // Разведка структуры страницы: по ней пишутся селекторы монитора. WhatsApp
  // меняет вёрстку без предупреждения, поэтому единственный надёжный источник
  // — живая страница, а не документация.
  async probe(phone) {
    if (TEST_MODE) return { test_mode: true };
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      if (phone) {
        await this._openChatRaw(this._normalizePhone(phone));
      }
      return this.page.evaluate(() => {
        const attrs = (el) => {
          const o = {};
          for (const a of el.attributes) {
            if (/^(id|role|title|aria-label|aria-placeholder|data-)/.test(a.name)) o[a.name] = a.value;
          }
          return o;
        };
        const editables = [...document.querySelectorAll('[contenteditable="true"]')].map(attrs);
        // Список чатов: ищем контейнер с прокруткой и строки в нём.
        const pane = document.querySelector('#pane-side');
        const rows = pane ? [...pane.querySelectorAll('[role="listitem"], [role="row"]')] : [];
        // Пузыри сообщений в открытом чате.
        const bubbles = [...document.querySelectorAll('[data-id]')]
          .filter(e => /(true|false)_/.test(e.getAttribute('data-id') || ''))
          .slice(-3)
          .map(e => ({
            data_id: e.getAttribute('data-id'),
            classes: (e.className || '').toString().slice(0, 80),
            text: (e.innerText || '').slice(0, 60),
          }));
        return {
          url: location.href,
          has_side: !!document.querySelector('#side'),
          pane_side: !!pane,
          chat_rows: rows.length,
          chat_row_sample: rows.slice(0, 2).map(r => ({
            attrs: attrs(r),
            text: (r.innerText || '').replace(/\n/g, ' | ').slice(0, 80),
          })),
          editables,
          bubbles,
          // Кнопка отправки и панель ввода — по ним понимаем, открыт ли чат.
          send_btn: !!document.querySelector('[data-icon="send"], [aria-label="Отправить"], [aria-label="Send"]'),
          footer: !!document.querySelector('footer'),
        };
      });
    });
  }

  // Переход в чат без ожидания поля ввода — для probe, которому нужно увидеть
  // страницу как есть, даже если привычные селекторы больше не совпадают.
  async _openChatRaw(phone) {
    const url = `https://web.whatsapp.com/send?phone=${phone}`;
    await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
    await new Promise(r => setTimeout(r, 4000));
  }

  // Снимок экрана живой страницы — иногда единственный способ понять, что
  // происходит: селекторы могут не находиться из-за баннера, оверлея или
  // экрана загрузки, а не из-за смены вёрстки.
  async screenshot() {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(() => this.page.screenshot({ encoding: 'base64', fullPage: false }));
  }

  // Закрыть модальные окна поверх интерфейса: WhatsApp периодически
  // показывает «Что нового», подсказки и предложения обновиться. Пока такое
  // окно открыто, кликов по чату не видно и область сообщений недоступна —
  // монитор должен снимать их сам, а не ждать человека.
  async dismissDialogs() {
    return this.page.evaluate(() => {
      const closed = [];
      for (const dlg of document.querySelectorAll('[role="dialog"]')) {
        if (!dlg.offsetParent) continue;
        const btn = dlg.querySelector(
          '[aria-label="Закрыть"], [aria-label="Close"], [data-icon="x"], [data-icon="close"]',
        );
        if (btn) { btn.click(); closed.push('x'); continue; }
        // Кнопки вида «Продолжить» / «ОК» / «Понятно» — если крестика нет.
        const ok = [...dlg.querySelectorAll('button, [role="button"]')]
          .find(b => /продолж|понятн|ок|got it|continue|ok/i.test(b.innerText || ''));
        if (ok) { ok.click(); closed.push(ok.innerText.slice(0, 20)); }
      }
      return closed;
    });
  }

  // Открыть чат кликом по строке в списке. Ссылка /send?phone= у аккаунта с
  // ограничением «нельзя начинать новые чаты» ведёт на экран без поля ввода,
  // даже если переписка с этим номером уже существует.
  //
  // Клик делаем настоящей мышью по координатам, а не element.click(): React в
  // WhatsApp вешает обработчики на pointer-события, и синтетический click по
  // произвольному вложенному div он игнорирует — строка подсвечивается, но
  // чат не открывается.
  async openChatByRow(phoneDigits) {
    const box = await this.page.evaluate((digits) => {
      const pane = document.querySelector('#pane-side');
      if (!pane) return { ok: false, reason: 'нет списка чатов' };
      const rows = [...pane.querySelectorAll('[role="row"], [role="listitem"]')];
      const onlyDigits = (s) => (s || '').replace(/[^0-9]/g, '');
      const tail = digits.slice(-10);
      const row = rows.find(r => onlyDigits(r.innerText).includes(tail));
      if (!row) return { ok: false, reason: 'чат не найден в списке', rows: rows.length };
      const r = row.getBoundingClientRect();
      return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, phoneDigits);

    if (!box.ok) return box;
    await this.page.mouse.click(box.x, box.y);
    return { ok: true };
  }

  // Прочитать сообщения открытого чата. Разбор устроен «от данных»: у каждого
  // пузыря есть стабильный data-id, а направление берём из строки
  // .copyable-text — её data-pre-wrap содержит подпись вида
  // «[10:44, 15.09.2026] Имя:». Классы вроде message-in/message-out в текущей
  // вёрстке отсутствуют, а обфусцированные (x1n2onr6…) меняются от сборки к
  // сборке — на них опираться нельзя.
  async readChat(phone, limit = 50) {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      const digits = this._normalizePhone(phone);
      const dismissed = await this.dismissDialogs();
      if (dismissed.length) await new Promise(r => setTimeout(r, 1200));
      const opened = await this.openChatByRow(digits);
      if (!opened.ok) return { ok: false, ...opened };
      await new Promise(r => setTimeout(r, 2500));

      const items = await this.page.evaluate((max) => {
        const main = document.querySelector('#main');
        if (!main) return [];
        const out = [];
        for (const node of main.querySelectorAll('[data-id]')) {
          const id = node.getAttribute('data-id');
          if (!id) continue;
          const copy = node.querySelector('.copyable-text');
          // Системные плашки (шифрование, «Сегодня») своей подписи не имеют —
          // по её отсутствию их и отсекаем.
          const meta = copy?.getAttribute('data-pre-plain-text');
          if (!meta) continue;
          const textEl = node.querySelector('.selectable-text, span.selectable-text');
          const body = (textEl?.innerText ?? '').trim();
          // Вложение: у медиа-сообщений текста нет, но есть картинка/иконка.
          const img = node.querySelector('img[src^="blob:"], img[src^="data:"]');
          const hasMedia = !!img || !!node.querySelector('[data-icon="audio-play"], [data-icon="document"]');
          out.push({ wa_id: id, meta: meta.trim(), body, has_media: hasMedia });
        }
        return out.slice(-max);
      }, limit);

      // Подпись WhatsApp: «[10:44, 15.09.2026] Автор: ». Автор — это тот, кто
      // отправил; сравниваем с номером собеседника, чтобы понять направление.
      const parsed = items.map((m) => {
        const mt = m.meta.match(/\[(\d{1,2}:\d{2}),\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4})\]\s*(.*?):?$/);
        const time = mt?.[1] || null;
        const date = mt?.[2] || null;
        const author = (mt?.[3] || '').trim();
        const authorDigits = author.replace(/[^0-9]/g, '');
        // Входящее — если подпись содержит номер собеседника.
        const fromMe = !(authorDigits && digits.endsWith(authorDigits.slice(-10)));
        return { ...m, time, date, author, from_me: fromMe };
      });
      return { ok: true, phone: digits, count: parsed.length, items: parsed };
    });
  }

  // Подробный разбор области сообщений: по нему пишется парсер монитора.
  async inspectChat(phone) {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      const digits = this._normalizePhone(phone);
      const dismissed = await this.dismissDialogs();
      if (dismissed.length) await new Promise(r => setTimeout(r, 1500));
      const opened = await this.openChatByRow(digits);
      await new Promise(r => setTimeout(r, 3000));
      const dom = await this.page.evaluate(() => {
        // #main — исторический id контейнера чата; на новой вёрстке его может
        // не быть, поэтому ищем область сообщений по роли application/log или
        // по самому контейнеру с прокруткой справа от списка.
        const main = document.querySelector('#main')
          || document.querySelector('[role="application"]')
          || document.querySelector('[data-testid="conversation-panel-messages"]');
        if (!main) {
          // Не нашли — отдаём карту верхнего уровня, чтобы было видно, за что
          // цепляться: id, роли и размеры крупных блоков.
          const blocks = [...document.querySelectorAll('div')]
            .filter(d => d.offsetWidth > 400 && d.offsetHeight > 300)
            .slice(0, 8)
            .map(d => ({
              id: d.id || null,
              role: d.getAttribute('role'),
              testid: d.getAttribute('data-testid'),
              cls: (d.className || '').toString().slice(0, 45),
              size: `${d.offsetWidth}x${d.offsetHeight}`,
              text: (d.innerText || '').replace(/\n/g, ' ').slice(0, 45),
            }));
          return { main: false, blocks };
        }
        // Кандидаты на «пузырь сообщения»: у них обычно есть data-id вида
        // <fromMe>_<chatId>_<msgId> либо класс message-in/message-out.
        const withDataId = [...main.querySelectorAll('[data-id]')].slice(-5).map(e => ({
          data_id: e.getAttribute('data-id'),
          cls: (e.className || '').toString().slice(0, 70),
          text: (e.innerText || '').replace(/\n/g, ' ').slice(0, 50),
        }));
        const inOut = [...main.querySelectorAll('.message-in, .message-out')].slice(-5).map(e => ({
          cls: (e.className || '').toString().slice(0, 70),
          text: (e.innerText || '').replace(/\n/g, ' ').slice(0, 50),
        }));
        const rows = [...main.querySelectorAll('[role="row"]')].slice(-5).map(e => ({
          cls: (e.className || '').toString().slice(0, 50),
          text: (e.innerText || '').replace(/\n/g, ' ').slice(0, 50),
        }));
        return {
          main: true,
          header: (main.querySelector('header')?.innerText || '').replace(/\n/g, ' ').slice(0, 60),
          with_data_id: withDataId,
          in_out: inOut,
          rows,
          copyable: main.querySelectorAll('.copyable-text').length,
        };
      });
      return { opened, dom };
    });
  }

  // Клик и ввод в живом окне: ими управляет страница «Экран WhatsApp» в
  // админке. Координаты приходят в масштабе реального окна (1280x720), его же
  // размер выставлен во вьюпорте, поэтому пересчёт не нужен.
  async clickAt(x, y) {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      await this.page.mouse.click(x, y);
      return { ok: true };
    });
  }

  async typeText(text, pressEnter = false) {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      await this.page.keyboard.type(text);
      if (pressEnter) await this.page.keyboard.press('Enter');
      return { ok: true };
    });
  }

  async pressKey(key) {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      await this.page.keyboard.press(key);
      return { ok: true };
    });
  }

  // Список чатов из боковой панели. Нужен монитору, чтобы знать, какие
  // диалоги обходить: отдельного API у страницы нет, читаем то же, что видит
  // человек. Возвращаются только личные чаты — группы и рассылки в CRM не
  // нужны и отсеиваются по отсутствию номера в заголовке.
  async listChats() {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      await this.dismissDialogs();
      const rows = await this.page.evaluate(() => {
        const out = [];
        // Строки списка чатов помечены role="row" (не listitem — это проверено
        // на живой странице). Заголовок с именем или номером лежит в span[title].
        for (const el of document.querySelectorAll('[role="row"]')) {
          const title = el.querySelector('span[title]')?.getAttribute('title') || '';
          if (!title) continue;
          const text = el.innerText || '';
          // Счётчик непрочитанных: WhatsApp помечает его aria-label вида
          // «3 непрочитанных сообщения». По нему монитор понимает, какие чаты
          // нужно открыть, и не листает всю переписку подряд.
          let unread = 0;
          const badge = el.querySelector('[aria-label*="непрочит"], [aria-label*="unread"]');
          if (badge) {
            const n = (badge.getAttribute('aria-label') || '').match(/\d+/);
            unread = n ? Number(n[0]) : 1;
          }
          // Время последнего сообщения — вторая опора: по нему видно, что в
          // чате что-то поменялось, даже если счётчик уже сброшен.
          const lines = text.split('\n');
          out.push({
            title,
            preview: lines.slice(1).join(' ').trim(),
            last_time: (lines[1] || '').trim(),
            unread,
          });
        }
        return out;
      });
      // Номер вытаскиваем из заголовка: если контакт не сохранён, WhatsApp
      // показывает сам номер, если сохранён — имя, и тогда чат пропускаем
      // (сопоставить его с клиентом по имени ненадёжно).
      return rows
        .map(r => ({ ...r, digits: String(r.title).replace(/[^0-9]/g, '') }))
        .filter(r => r.digits.length >= 10);
    });
  }

  // Что находится в подвале чата вместо поля ввода. Нужно, чтобы отличить
  // ограничение аккаунта от обычной неудачи с селектором: в первом случае
  // WhatsApp рисует там текстовый баннер, во втором — поле просто под другим
  // селектором.
  async footerProbe() {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      return this.page.evaluate(() => {
        const f = document.querySelector('footer');
        if (!f) return { footer: false };
        return {
          footer: true,
          text: (f.innerText || '').trim().slice(0, 400),
          editables: f.querySelectorAll('[contenteditable="true"]').length,
          buttons: Array.from(f.querySelectorAll('button, [role="button"]'))
            .map(b => b.getAttribute('aria-label') || b.getAttribute('data-icon') || '')
            .filter(Boolean).slice(0, 12),
          links: Array.from(f.querySelectorAll('a, [role="link"]'))
            .map(a => (a.innerText || '').trim()).filter(Boolean).slice(0, 5),
        };
      });
    });
  }

  // Чем наш браузер представляется странице. WhatsApp ограничивает связанные
  // устройства, которые определяет как автоматизированные или неподдерживаемые,
  // поэтому важно знать, что именно он видит.
  async envProbe() {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      return this.page.evaluate(() => ({
        ua: navigator.userAgent,
        webdriver: navigator.webdriver,
        platform: navigator.platform,
        languages: navigator.languages,
        plugins: navigator.plugins.length,
        headless: /Headless/i.test(navigator.userAgent),
      }));
    });
  }

  async restart() {
    this.isReady = false;
    this.statusMsg = 'restarting';
    this.qrDataUrl = null;
    this._initPromise = null;
    if (this._healthIv) { clearInterval(this._healthIv); this._healthIv = null; }
    try {
      if (this.browser) await this.browser.close();
    } catch { /* ok */ }
    this.browser = null;
    this.page = null;
    await this.initialize();
  }
}

const manager = new WhatsAppManager();
export default manager;
