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
    // Автоподъём после сбоя инициализации. Без него сервис оставался живым
    // HTTP-сервером с мёртвым браузером: initialize() зовётся один раз при
    // старте, _doInit гасит ошибку внутри себя, и повторить попытку было
    // некому — сеанс лежал сутками при исправном окружении.
    this._retryTimer = null;
    this._retryAttempt = 0;
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
      // Успешный запуск снимает счётчик повторов: следующая авария начнёт
      // отсчёт с короткой паузы, а не с накопленной за прошлые падения.
      this._retryAttempt = 0;
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
      this._scheduleRetry();
    }
  }

  // Повтор инициализации с нарастающей паузой: 30 с, 1, 2, 4, 8 мин, дальше
  // раз в 15 мин. Верхний предел нужен, чтобы при долгой аварии (упал прокси,
  // нет сети) сервис не долбил Chromium каждые полминуты, но и не сдавался:
  // окружение чинится само, а без повтора сеанс не поднимется никогда.
  _scheduleRetry() {
    if (TEST_MODE || this._retryTimer) return;
    const STEPS = [30_000, 60_000, 120_000, 240_000, 480_000];
    // После исчерпания шагов — раз в 15 минут. Индекс не зажимаем в длину
    // массива: иначе ветка «долгая авария» никогда бы не наступила.
    const delay = STEPS[this._retryAttempt] ?? 900_000;
    this._retryAttempt++;
    console.warn(`[WA] Повтор инициализации через ${Math.round(delay / 1000)} с `
      + `(попытка ${this._retryAttempt})`);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.initialize().catch((e) => console.error('[WA] retry failed:', e.message));
    }, delay);
    // Таймер не должен держать процесс: при остановке сервиса ждать паузу незачем.
    if (typeof this._retryTimer.unref === 'function') this._retryTimer.unref();
  }

  // Периодическая проверка живости веб-сессии. Если телефон разлогинил сессию,
  // isReady сбрасывается и запускается переинициализация — иначе отправки молча
  // висят по 30 c на waitForSelector, а статус остаётся 'ready'.
  _startHealthCheck() {
    if (this._healthIv) clearInterval(this._healthIv);
    this._healthMisses = 0;
    this._healthIv = setInterval(async () => {
      // Браузер отвалился (упал Chromium, оборвался CDP) — страницы нет, а
      // повторов инициализации никто не заводил: раньше сеанс так и оставался
      // мёртвым до ручного рестарта контейнера. Поднимаем сами.
      if (!this.browser || !this.page) {
        if (this.statusMsg !== 'initializing' && this.statusMsg !== 'restarting') {
          console.warn('[WA] Браузер отсутствует — планирую переподъём');
          this.isReady = false;
          this._scheduleRetry();
        }
        return;
      }
      if (!this.isReady) return;
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
          // Признаки рабочего окна. Ищем именно список чатов и панель слева:
          // это то, что появляется ТОЛЬКО у привязанного аккаунта.
          const hasChats = !!document.querySelector('[data-testid="chat-list"], [aria-label="Chat list"], [data-testid="chatlist-panel"]');
          const hasSide  = !!document.querySelector('#side, #pane-side');
          const hasUser  = !!document.querySelector('[data-testid="default-user"], header [data-testid="avatar"]');
          // QR: канвас или контейнер с кодом.
          const hasQRCanvas = !!document.querySelector('canvas, [data-ref], [data-testid="qrcode"]');
          const text = (document.body.innerText || '').slice(0, 400);
          return { hasChats, hasSide, hasUser, hasQRCanvas, url: location.href, text };
        });

        // Готовность — только по положительным признакам рабочего окна.
        //
        // Раньше в счёт шёл ещё и noLanding («нет посадочной страницы»), и на
        // экране разлогина (?post_logout=1) он давал очко на пустом месте:
        // посадочной там нет, но и аккаунта тоже. Сервис рапортовал Ready!,
        // хотя чатов не было и отправка падала с «WhatsApp not ready».
        const authScore = [state.hasChats, state.hasSide, state.hasUser].filter(Boolean).length;
        const loggedOut = /[?&]post_logout=1/.test(state.url || '');
        // Синхронизация после долгого простоя: аккаунт привязан, но чаты ещё
        // качаются («Загрузка чатов [72 %]», «Идет скачивание сообщений»).
        // Признаков рабочего окна на этом экране нет, и раньше он попадал под
        // таймер обновления QR: перезагрузка сбрасывала скачивание в ноль,
        // и сеанс не мог подняться в принципе. Экран сам просит не закрывать
        // окно — ждём столько, сколько нужно.
        const syncing = /Загрузка чатов|скачивание сообщений|Downloading messages|Loading your chats/i
          .test(state.text || '');

        if (authScore >= 1 && !loggedOut) {
          clearInterval(iv);
          this.isReady = true;
          this.qrDataUrl = null;
          this.statusMsg = 'ready';
          console.log('[WA] Ready!');
          this._startHealthCheck();
          return;
        }

        // Экран разлогина сам по себе QR не покажет: на нём висит кнопка
        // повторного входа, а страница остаётся статичной до перезагрузки.
        // Возвращаемся на чистый адрес, иначе ждали бы код все 10 минут.
        if (loggedOut) {
          this.statusMsg = 'relogin';
          console.log('[WA] экран разлогина — открываю заново');
          try {
            await this.page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
          } catch { /* следующая итерация попробует снова */ }
          return;
        }

        // QR code visible — capture it
        if (state.hasQRCanvas && !syncing) {
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
          // Идёт скачивание истории — перезагружать нельзя: прогресс сбросится
          // в ноль и следующие 10 минут кончатся тем же самым. Держим счётчик
          // взведённым и ждём: как только чаты догрузятся, сработает authScore.
          if (syncing) {
            attempts = MAX - 12; // ещё минута ожидания до следующей проверки
            this.statusMsg = 'syncing';
            console.log('[WA] Идёт загрузка истории чатов — жду, не перезагружаю');
            return;
          }
          // Раньше опрос здесь останавливался совсем: страница оставалась
          // открытой, но QR на ней протухал каждые ~20 секунд, а обновлять
          // его было уже некому. Человек открывал админку через час, видел
          // мёртвую картинку и сканировал впустую.
          // Теперь перезагружаем страницу и продолжаем ждать: сеанс нужен
          // круглосуточно, а привязать его могут не сразу.
          attempts = 0;
          this.statusMsg = 'waiting_qr_scan';
          this.lastError = null;
          console.log('[WA] QR не отсканирован за 10 мин — обновляю код');
          try {
            await this.page.goto('https://web.whatsapp.com/', { waitUntil: 'domcontentloaded', timeout: 60_000 });
          } catch { /* следующая итерация попробует снова */ }
        }
      } catch (e) {
        console.warn('[WA] Poll error:', e.message);
        // Страница умерла под нами — дальше опрос будет сыпать одной и той же
        // ошибкой каждые 5 с и никогда не поднимет сеанс. Останавливаемся и
        // отдаём управление повтору инициализации.
        if (!this.page || !this.browser || this.page.isClosed?.()) {
          clearInterval(iv);
          this.isReady = false;
          this.statusMsg = 'error';
          this.lastError = e.message;
          this._scheduleRetry();
        }
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

  // Отправка фото/видео с подписью. Отдельный метод, а не флаг в sendMessage:
  // путь принципиально другой — файл скармливаем скрытому input[type=file]
  // на странице, а текст идёт подписью в том же сообщении, а не вторым.
  //
  // Предохранители те же и в том же порядке, что в sendMessage: allowlist
  // проверяется до TEST_MODE, иначе тестовый прогон рапортует success на
  // номер, который в бою был бы заблокирован.
  async sendMedia(phone, filePath, caption = '') {
    const clean = this._normalizePhone(phone);

    if (ALLOWLIST.length > 0 && !ALLOWLIST.includes(clean)) {
      throw new Error(`blocked by allowlist: ${clean}`);
    }
    if (!fs.existsSync(filePath)) throw new Error(`файл не найден: ${filePath}`);

    if (TEST_MODE) {
      console.log(`[WA][TEST] → ${clean}: медиа ${path.basename(filePath)} «${caption.slice(0, 60)}»`);
      return { success: true, test_mode: true, phone: clean };
    }

    return this._enqueue(async () => {
      if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
      console.log(`[WA] Sending media to ${clean}…`);

      await this.dismissDialogs();
      const opened = await this.openChatByRow(clean);
      if (!opened.ok) await this._openChat(clean);
      else await new Promise(r => setTimeout(r, 2000));

      await this.page.waitForSelector(COMPOSE_SELECTOR, { timeout: 30_000 })
        .catch(() => { throw new Error('поле ввода недоступно (ограничение аккаунта или чат не открылся)'); });

      // Кнопку «скрепка» не нажимаем: меню вложений перерисовывается и его
      // пункты скачут между сборками. Файл кладём прямо в input[type=file],
      // который WhatsApp держит в DOM постоянно, — это устойчивее к вёрстке.
      const inputs = await this.page.$$('input[type="file"]');
      if (!inputs.length) throw new Error('input[type=file] не найден — изменилась вёрстка WhatsApp');
      // Элементов несколько (фото/документ/контакт); тот, что принимает
      // изображения и видео, объявляет это в accept.
      let target = null;
      for (const el of inputs) {
        const accept = await el.evaluate((n) => n.getAttribute('accept') || '');
        if (/image|video/i.test(accept)) { target = el; break; }
      }
      if (!target) target = inputs[0];
      await target.uploadFile(filePath);

      // Предпросмотр открывается не мгновенно: ждём поле подписи.
      const CAPTION_SELECTORS = [
        'div[aria-label*="одпис"][contenteditable="true"]',
        'div[aria-label*="aption"][contenteditable="true"]',
        'div[data-testid="media-caption-input-container"] div[contenteditable="true"]',
        'div[contenteditable="true"][data-tab="10"]',
      ];
      let captionBox = null;
      for (let i = 0; i < 30 && !captionBox; i++) {
        for (const sel of CAPTION_SELECTORS) {
          captionBox = await this.page.$(sel);
          if (captionBox) break;
        }
        if (!captionBox) await new Promise(r => setTimeout(r, 500));
      }
      if (!captionBox) throw new Error('окно предпросмотра медиа не открылось');

      if (caption) {
        await captionBox.click();
        await new Promise(r => setTimeout(r, 300));
        const lines = caption.split('\n');
        for (let i = 0; i < lines.length; i++) {
          await this.page.keyboard.type(lines[i]);
          if (i < lines.length - 1) {
            await this.page.keyboard.down('Shift');
            await this.page.keyboard.press('Enter');
            await this.page.keyboard.up('Shift');
          }
        }
        await new Promise(r => setTimeout(r, 400));
      }

      let sent = false;
      for (const sel of SEND_SELECTORS) {
        const btn = await this.page.$(sel);
        if (btn) { await btn.click(); sent = true; break; }
      }
      if (!sent) await this.page.keyboard.press('Enter');

      // Видео уходит дольше картинки: ждём, пока закроется предпросмотр.
      // Пустое поле подписи доказательством не служит — оно исчезает вместе
      // с окном, поэтому проверяем именно отсутствие окна предпросмотра.
      let gone = false;
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 1000));
        gone = !(await this.page.$(CAPTION_SELECTORS[0]))
          && !(await this.page.$('div[data-testid="media-caption-input-container"]'));
        if (gone) break;
      }
      if (!gone) throw new Error('медиа не отправилось (окно предпросмотра не закрылось)');

      console.log(`[WA] Media sent to ${clean}`);
      return { success: true, phone: clean, media: true };
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
    const closed = await this.page.evaluate(() => {
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

      // Полноэкранные шторки (настройки, профиль, «Обновления статуса»).
      // Это НЕ role="dialog", поэтому цикл выше их не видел: WhatsApp
      // помечает их data-testid="drawer-fullscreen". Такая шторка
      // перекрывает интерфейс целиком — пропадает и #main, и список чатов,
      // и чтение чата падает с «чат не найден в списке». Разово открытая
      // (например, при диагностике) она висит до перезапуска сеанса и тихо
      // ломает весь обход.
      for (const drawer of document.querySelectorAll('[data-testid="drawer-fullscreen"]')) {
        if (!drawer.offsetParent) continue;
        const back = drawer.querySelector(
          '[aria-label="Назад"], [aria-label="Back"], [data-icon="back"],'
          + ' [aria-label="Закрыть"], [aria-label="Close"], [data-icon="x"]',
        );
        if (back) { back.click(); closed.push('drawer'); }
      }
      return closed;
    });

    // Шторка могла не иметь кнопки «назад» (вёрстка меняется) — добьём
    // клавишей Escape и проверим, что интерфейс вернулся. Проверка важнее
    // самого нажатия: без неё мы бы снова считали, что всё закрыто.
    const stuck = await this.page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="drawer-fullscreen"]')]
        .some(d => !!d.offsetParent));
    if (stuck) {
      for (let i = 0; i < 3; i++) {
        await this.page.keyboard.press('Escape');
        await new Promise(r => setTimeout(r, 500));
        const still = await this.page.evaluate(() =>
          [...document.querySelectorAll('[data-testid="drawer-fullscreen"]')]
            .some(d => !!d.offsetParent));
        if (!still) { closed.push('drawer-esc'); break; }
      }
    }
    return closed;
  }

  /**
   * Что сейчас на странице похоже на строку поиска. Диагностика: вёрстка
   * WhatsApp меняется, и вместо угадывания селекторов вслепую смотрим, какие
   * поля ввода реально есть, где они и как подписаны.
   */
  async searchProbe() {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      const dismissed = await this.dismissDialogs();
      if (dismissed.length) await new Promise(r => setTimeout(r, 1000));
      return this.page.evaluate(() => {
        const fields = [];
        const sel = '[contenteditable="true"], input[type="text"], input[type="search"], [role="textbox"], [role="searchbox"]';
        for (const el of document.querySelectorAll(sel)) {
          const r = el.getBoundingClientRect();
          fields.push({
            tag: el.tagName,
            tab: el.getAttribute('data-tab'),
            aria: (el.getAttribute('aria-label') || '').slice(0, 50),
            placeholder: (el.getAttribute('data-placeholder') || el.getAttribute('placeholder') || '').slice(0, 40),
            testid: el.getAttribute('data-testid'),
            role: el.getAttribute('role'),
            visible: r.width > 0 && r.height > 0,
            x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width),
          });
        }
        // Кнопки/иконки поиска — иногда поле появляется только после клика.
        const buttons = [];
        for (const el of document.querySelectorAll('[data-icon], button[aria-label]')) {
          const aria = (el.getAttribute('aria-label') || '');
          const icon = (el.getAttribute('data-icon') || '');
          if (!/поиск|search|искать/i.test(aria + ' ' + icon)) continue;
          const r = el.getBoundingClientRect();
          buttons.push({
            icon, aria: aria.slice(0, 40),
            x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
            visible: r.width > 0,
          });
        }
        return { fields, buttons, paneRows: document.querySelectorAll('#pane-side [role="row"]').length };
      });
    });
  }

  /**
   * Открыть чат через строку поиска WhatsApp.
   *
   * Зачем, если есть openChatByRow: тот ищет строку в отрисованной части
   * списка, а WhatsApp держит в DOM только видимый экран. Для чата, лежащего
   * пятисотым, строки нет — импорт молча получал пустой результат (61 чат
   * обошли, сохранилось 7 сообщений).
   *
   * Поиск решает и вторую задачу: WhatsApp ищет ПО НОМЕРУ даже тогда, когда
   * контакт сохранён и в списке показано имя. Такие чаты раньше выпадали из
   * импорта целиком — номер из заголовка было не достать.
   *
   * Возвращает { ok, title } — title это подпись чата (имя из телефонной
   * книги или сам номер), по ней видно, под каким именем записан клиент.
   */
  async searchAndOpen(phoneDigits) {
    const digits = String(phoneDigits).replace(/[^0-9]/g, '');
    const tail = digits.slice(-10);

    // Строка поиска. Селекторы выведены из живой страницы (searchProbe), а не
    // из документации: в текущей вёрстке это обычный <input data-tab="3"> с
    // aria-label «Поиск или новый чат». Прежний contenteditable-вариант не
    // находился вовсе, и поиск падал с «строка поиска не найдена».
    const box = await this.page.evaluate(() => {
      const cands = [
        'input[data-tab="3"]',
        'input[aria-label*="Поиск"]',
        'input[aria-label*="Search"]',
        '#side input[type="text"]',
        // Старая вёрстка — на случай отката версии WhatsApp.
        '[contenteditable="true"][data-tab="3"]',
      ];
      for (const sel of cands) {
        const el = document.querySelector(sel);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          return { ok: true, sel, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }
      }
      return { ok: false };
    });
    if (!box.ok) return { ok: false, reason: 'строка поиска не найдена' };

    await this.page.mouse.click(box.x, box.y);
    await new Promise(r => setTimeout(r, 400));
    // Чистим прежний запрос: иначе номера склеиваются и поиск даёт пусто.
    // Тройной клик выделяет содержимое и в input, и в contenteditable.
    await this.page.mouse.click(box.x, box.y, { clickCount: 3 });
    await this.page.keyboard.press('Backspace');
    await new Promise(r => setTimeout(r, 250));

    // Вводим без кода страны: WhatsApp находит и «79…», и «+7 9…».
    await this.page.keyboard.type(tail, { delay: 60 });
    // Поиск идёт по сети, мгновенного результата не бывает.
    await new Promise(r => setTimeout(r, 2200));

    const hit = await this.page.evaluate((t) => {
      const pane = document.querySelector('#pane-side');
      if (!pane) return { ok: false, reason: 'нет панели результатов' };
      const onlyDigits = (s) => (s || '').replace(/[^0-9]/g, '');
      for (const row of pane.querySelectorAll('[role="row"], [role="listitem"]')) {
        const text = row.innerText || '';
        // Совпадение по номеру в самой строке — самый надёжный признак.
        if (onlyDigits(text).includes(t)) {
          const r = row.getBoundingClientRect();
          const title = row.querySelector('span[title]')?.getAttribute('title') || '';
          return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, title };
        }
      }
      // Контакт сохранён: номера в строке нет, показано имя. Берём первую
      // НАСТОЯЩУЮ строку чата, а не просто первый узел.
      //
      // Раньше здесь стоял `pane.querySelector(row)` — первый попавшийся
      // элемент. В панели результатов первым идёт заголовок секции («Чаты»),
      // у него тоже role="row": клик по нему не открывает ничего, а код
      // считал, что чат открыт, и читал прежнюю переписку. Отсюда и
      // сообщения одного клиента в карточке другого.
      //
      // Признак настоящей строки — span[title] с названием чата и заметная
      // высота: у заголовков секций его нет.
      const rows = [...pane.querySelectorAll('[role="row"], [role="listitem"]')];
      const first = rows.find((row) => {
        const title = row.querySelector('span[title]')?.getAttribute('title');
        if (!title) return false;
        const rect = row.getBoundingClientRect();
        return rect.height > 40 && rect.width > 100;
      });
      if (first) {
        const r = first.getBoundingClientRect();
        const title = first.querySelector('span[title]')?.getAttribute('title') || '';
        return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, title, by_name: true };
      }
      return { ok: false, reason: 'чат не найден' };
    }, tail);

    if (!hit.ok) {
      await this.page.keyboard.press('Escape');
      return hit;
    }

    // Клик и ПРОВЕРКА, что чат действительно сменился.
    //
    // Раньше здесь стоял один клик и безусловный `ok: true`. Если клик не
    // срабатывал (React в WhatsApp привязан к pointer-событиям, а строка
    // результатов успевает перерисоваться после подгрузки аватарки), чтение
    // шло по ТОМУ ЖЕ чату, что был открыт до поиска. Внешне всё выглядело
    // успешно: сообщения возвращались, просто чужие. Так переписка одного
    // клиента могла попасть в карточку другого.
    //
    // Признак открытого чата — поле ввода сообщения. Заголовка мало: у
    // сохранённого контакта в нём стоит имя («Юсуф Айти»), а не номер, и
    // сверять с искомым нечего.
    const state = async () => this.page.evaluate(() => {
      // ВАЖНО: именно заголовок ЧАТА, а не первый header на странице —
      // первым идёт шапка левой панели («WhatsApp» со счётчиком
      // непрочитанных), из-за чего сверка видела «18» вместо имени чата.
      const head = document.querySelector('#main header')
        || [...document.querySelectorAll('header')].pop();
      const t = head?.innerText || '';
      const compose = document.querySelector(
        '[data-testid="conversation-compose-box-input"], footer [contenteditable="true"]',
      );
      return {
        digits: t.replace(/[^0-9]/g, ''),
        title: (t.split('\n')[0] || '').trim(),
        open: !!compose,
      };
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.page.mouse.click(hit.x, hit.y);
      await new Promise(r => setTimeout(r, 2000));
      const st = await state();
      if (st.open) {
        // Чат открыт. Если в заголовке есть номер — сверяем с искомым;
        // если там имя — сверяем с названием строки, по которой кликали.
        if (st.digits.includes(tail)) {
          return { ok: true, title: hit.title || st.title || null, by_name: !!hit.by_name };
        }
        if (hit.title && st.title && st.title === hit.title.trim()) {
          // Возвращаем заголовок ЧАТА, а не строки списка: по нему потом
          // сверяется readChat, и они должны совпадать дословно.
          return { ok: true, title: st.title, by_name: true };
        }
        // Открылся не тот чат — это опаснее, чем не открыть ничего.
        if (attempt === 3) {
          return { ok: false, reason: `открыт другой чат: «${st.title || '—'}»` };
        }
      }
      // Не открылось — перечитываем координаты строки: она могла сдвинуться,
      // пока подгружались аватарки.
      if (attempt < 3) {
        const again = await this.page.evaluate((t) => {
          const pane = document.querySelector('#pane-side');
          if (!pane) return null;
          const onlyDigits = (s) => (s || '').replace(/[^0-9]/g, '');
          const rows = [...pane.querySelectorAll('[role="row"], [role="listitem"]')]
            .filter(r => !!r.querySelector('span[title]'));
          const row = rows.find(r => onlyDigits(r.innerText).includes(t)) || rows[0];
          if (!row) return null;
          const r = row.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, tail);
        if (again) { hit.x = again.x; hit.y = again.y; }
        await new Promise(r => setTimeout(r, 600));
      }
    }

    // Три попытки не открыли нужный чат. Возвращаем неудачу, а НЕ успех:
    // прочитать чужую переписку хуже, чем пропустить проход.
    const st = await state();
    return {
      ok: false,
      reason: `чат не открылся: в заголовке «${st.title || '—'}», ожидали ${tail}`,
    };
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
      // Только строки с названием чата: у заголовков секций («Чаты»,
      // «Контакты») тоже role="row", и клик по ним ничего не открывает.
      const real = rows.filter(r => !!r.querySelector('span[title]'));
      const row = real.find(r => onlyDigits(r.innerText).includes(tail));
      if (!row) return { ok: false, reason: 'чат не найден в списке', rows: real.length };
      const r = row.getBoundingClientRect();
      // Название строки пригодится вызывающему: у сохранённого контакта в
      // заголовке чата стоит имя, и сверять его с номером бесполезно.
      const rowTitle = row.querySelector('span[title]')?.getAttribute('title') || '';
      return { ok: true, x: r.left + r.width / 2, y: r.top + r.height / 2, rowTitle };
    }, phoneDigits);

    if (!box.ok) return box;
    await this.page.mouse.click(box.x, box.y);
    // Проверяем, что открылся именно нужный чат. Без этого readChat читал
    // переписку, открытую ДО вызова: клик по строке не всегда срабатывает с
    // первого раза, а возвращаемый ok:true это скрывал — в карточку клиента
    // попадали чужие сообщения.
    await new Promise(r => setTimeout(r, 1500));
    const tail = String(phoneDigits).replace(/[^0-9]/g, '').slice(-10);
    const st = await this.page.evaluate(() => {
      // ВАЖНО: именно заголовок ЧАТА, а не первый header на странице —
      // первым идёт шапка левой панели («WhatsApp» со счётчиком
      // непрочитанных), из-за чего сверка видела «18» вместо имени чата.
      const head = document.querySelector('#main header')
        || [...document.querySelectorAll('header')].pop();
      const t = head?.innerText || '';
      const compose = document.querySelector(
        '[data-testid="conversation-compose-box-input"], footer [contenteditable="true"]',
      );
      return {
        digits: t.replace(/[^0-9]/g, ''),
        title: (t.split('\n')[0] || '').trim(),
        open: !!compose,
      };
    });
    if (st.open && st.digits.includes(tail)) return { ok: true, title: st.title || null };
    // Номера в заголовке нет, но он совпал с названием строки, по которой
    // кликали, — это тот самый чат: у сохранённого контакта WhatsApp
    // показывает имя вместо номера.
    if (st.open && box.rowTitle && st.title && st.title === box.rowTitle.trim()) {
      return { ok: true, title: st.title };
    }
    // Не открылось или открылось не то — пусть вызывающий уходит в поиск по
    // номеру: там есть свои повторы и сверка.
    return { ok: false, reason: 'чат по строке списка не открылся', title: st.title || null };
  }

  // Прочитать сообщения открытого чата. Разбор устроен «от данных»: у каждого
  // пузыря есть стабильный data-id, а направление берём из строки
  // .copyable-text — её data-pre-wrap содержит подпись вида
  // «[10:44, 15.09.2026] Имя:». Классы вроде message-in/message-out в текущей
  // вёрстке отсутствуют, а обфусцированные (x1n2onr6…) меняются от сборки к
  // сборке — на них опираться нельзя.
  async readChat(phone, limit = 50, staffNames = []) {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      const digits = this._normalizePhone(phone);
      const dismissed = await this.dismissDialogs();
      if (dismissed.length) await new Promise(r => setTimeout(r, 1200));
      // Сначала дешёвый путь — строка в видимой части списка. Если её там
      // нет (чат далеко внизу или контакт сохранён под именем), идём через
      // поиск по номеру: он находит чат независимо от позиции и подписи.
      let title = null;
      let opened = await this.openChatByRow(digits);
      // Открыт ли чат уже проверено внутри openChatByRow/searchAndOpen —
      // обе сверяют заголовок и поле ввода. Запоминаем, что проверка
      // пройдена, чтобы не делать её второй раз по другим правилам.
      let verifiedTitle = opened.ok ? opened.title : null;
      if (!opened.ok) {
        const found = await this.searchAndOpen(digits);
        if (!found.ok) return { ok: false, ...found };
        title = found.title;
        verifiedTitle = found.title;
        opened = { ok: true };
      }
      await new Promise(r => setTimeout(r, 2500));

      // Последняя сверка перед чтением: открытый чат должен относиться к
      // запрошенному номеру. Защита от того, что сообщения чужого чата
      // попадут в карточку клиента — читать не то хуже, чем не прочитать.
      //
      // У сохранённого контакта в заголовке имя, а не номер, поэтому опорой
      // служит название строки, по которой открывали (title из searchAndOpen).
      const st = await this.page.evaluate(() => {
        // ВАЖНО: именно заголовок ЧАТА, а не первый header на странице —
      // первым идёт шапка левой панели («WhatsApp» со счётчиком
      // непрочитанных), из-за чего сверка видела «18» вместо имени чата.
      const head = document.querySelector('#main header')
        || [...document.querySelectorAll('header')].pop();
      const t = head?.innerText || '';
        const compose = document.querySelector(
          '[data-testid="conversation-compose-box-input"], footer [contenteditable="true"]',
        );
        return {
          digits: t.replace(/[^0-9]/g, ''),
          title: (t.split('\n')[0] || '').trim(),
          open: !!compose,
        };
      });
      const tail = digits.slice(-10);
      // Заголовок совпадает с тем, что увидела уже пройденная проверка
      // открытия, — значит это тот самый чат. Сверка по имени нужна,
      // потому что у сохранённого контакта номера в заголовке нет.
      const byTitle = verifiedTitle && st.title && st.title === String(verifiedTitle).trim();
      if (!st.open || (!st.digits.includes(tail) && !byTitle)) {
        return {
          ok: false,
          phone: digits,
          reason: st.open
            ? `открыт другой чат: «${st.title || '—'}»`
            : 'чат не открыт',
        };
      }

      const items = await this.page.evaluate(async (max) => {
        const main = document.querySelector('#main');
        if (!main) return [];

        // Прочитать blob:/data: ссылку как base64. Внутри страницы такая
        // ссылка доступна (она принадлежит origin WhatsApp), а снаружи —
        // нет, поэтому скачивание делается здесь, а не в Node.
        const fetchAsBase64 = async (url) => {
          try {
            const resp = await fetch(url);
            if (!resp.ok) return null;
            const buf = await resp.arrayBuffer();
            // Больше 25 МБ в CRM не тащим: это уже не просмотр переписки.
            if (buf.byteLength > 25 * 1024 * 1024) return null;
            let bin = '';
            const bytes = new Uint8Array(buf);
            const CHUNK = 0x8000; // по частям: иначе стек падает на больших файлах
            for (let i = 0; i < bytes.length; i += CHUNK) {
              bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
            }
            return {
              b64: btoa(bin),
              mime: resp.headers.get('content-type') || null,
              size: buf.byteLength,
            };
          } catch { return null; }
        };

        const out = [];
        for (const node of main.querySelectorAll('[data-id]')) {
          const id = node.getAttribute('data-id');
          if (!id) continue;
          const copy = node.querySelector('.copyable-text');
          // Системные плашки (шифрование, «Сегодня») своей подписи не имеют —
          // по её отсутствию их и отсекаем.
          //
          // НО: у вложения без подписи (фото «как есть», без текста) этого
          // атрибута тоже нет — WhatsApp кладёт его только к текстовым
          // пузырям. Из-за `continue` такие сообщения отбрасывались целиком,
          // и фото никогда не доходило до сохранения: readChat возвращал
          // «0 сообщений» на чате, где фото видно глазами.
          //
          // Поэтому пузырь без подписи не выбрасываем сразу: если в нём есть
          // вложение, разбираем его, а время берём из видимой метки внутри
          // пузыря («07:04») и направление — из data-id (true_… это
          // входящие, false_… исходящие).
          const meta = copy?.getAttribute('data-pre-plain-text');
          const hasAttachment = !!node.querySelector(
            'video, audio, img[src^="blob:"],'
            + ' [data-icon="media-play"], [data-icon="audio-play"], [data-icon="ptt-play"],'
            + ' [data-icon="document"], [data-icon="msg-video"]',
          );
          if (!meta && !hasAttachment) continue;
          const textEl = node.querySelector('.selectable-text, span.selectable-text');
          const body = (textEl?.innerText ?? '').trim();

          // ── Тип вложения ────────────────────────────────────────────────
          // Раньше признаком медиа считался ЛЮБОЙ img с blob:/data: внутри
          // пузыря. Так в «медиа» попадали обычные тексты: такие картинки
          // есть и у превью ссылок, и у цитаты ответа, и у стикеров в
          // соседнем узле. В базе 104 текстовых сообщения получили
          // msg_type='media' — поэтому признаки теперь точные.
          //
          // Цитату исключаем: внутри пузыря лежит превью сообщения, НА
          // которое отвечают, и его картинку принимать за вложение нельзя.
          const quoted = node.querySelector('[data-pre-plain-text] blockquote, blockquote');
          const inQuote = (el) => !!el && !!quoted && quoted.contains(el);

          // Видео: у пузыря есть <video> либо иконка воспроизведения.
          const videoEl = node.querySelector('video');
          const playIcon = node.querySelector('[data-icon="media-play"], [data-icon="video-camera"], span[data-icon="msg-video"]');
          // Голосовое: своя иконка и ползунок длительности.
          const voiceIcon = node.querySelector('[data-icon="audio-play"], [data-icon="ptt-play"], [data-icon="audio-pause"]');
          // Документ: иконка файла.
          const docIcon = node.querySelector('[data-icon="document"], [data-icon="msg-document"], [data-icon="poll-doc"]');
          // Картинка: img внутри ссылки-открытия просмотрщика. Именно такой
          // img принадлежит самому вложению, а не оформлению пузыря.
          let imgEl = node.querySelector('div[role="button"] img[src^="blob:"], a img[src^="blob:"], img[data-testid="image-thumb"]');
          if (!imgEl) {
            const cand = node.querySelector('img[src^="blob:"]');
            if (cand && !inQuote(cand) && cand.naturalWidth > 80 && cand.naturalHeight > 80) imgEl = cand;
          }
          if (inQuote(imgEl)) imgEl = null;

          let kind = null;
          let media = null;
          if (videoEl || playIcon) {
            kind = 'video';
            // У видео в пузыре лежит только кадр-превью: сам файл WhatsApp
            // подгружает после нажатия. Забираем превью — по нему в CRM
            // видно, что прислали, а полный файл открывается в WhatsApp.
            const src = videoEl?.getAttribute('src') || videoEl?.querySelector('source')?.getAttribute('src');
            const poster = videoEl?.getAttribute('poster');
            const thumb = node.querySelector('img[src^="blob:"]');
            const url = (src && src.startsWith('blob:')) ? src
              : (poster && poster.startsWith('blob:')) ? poster
                : (thumb && !inQuote(thumb) ? thumb.getAttribute('src') : null);
            if (url) media = await fetchAsBase64(url);
          } else if (voiceIcon) {
            kind = 'voice';
            const audio = node.querySelector('audio');
            const url = audio?.getAttribute('src');
            if (url && url.startsWith('blob:')) media = await fetchAsBase64(url);
          } else if (docIcon) {
            kind = 'document';
          } else if (imgEl) {
            kind = 'image';
            const url = imgEl.getAttribute('src');
            if (url) media = await fetchAsBase64(url);
          }

          out.push({
            wa_id: id,
            meta: meta ? meta.trim() : '',
            // Для пузыря без подписи — видимая метка времени внутри него
            // («07:04»). Направление для таких берётся из соседних
            // сообщений уже снаружи.
            fallback_time: meta ? null : (node.innerText.match(/\b(\d{1,2}:\d{2})\b/) || [])[1] || null,
            body,
            kind,
            has_media: !!kind,
            media,
          });
        }
        return out.slice(-max);
      }, limit);

      // Подпись WhatsApp: «[10:44, 15.09.2026] Автор: ». Автор — это тот, кто
      // отправил; сравниваем с номером собеседника, чтобы понять направление.
      //
      // У вложения без подписи этого атрибута нет — там опираемся на
      // видимую метку времени в пузыре и на префикс data-id. Дату в таком
      // случае берём сегодняшнюю: пузыри без подписи встречаются только
      // среди свежих сообщений на экране, а старые подгружаются с подписью.
      const today = (() => {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
      })();
      // Наш сотрудник или собеседник: сверяем по словам — в CRM
      // «Балакеримова Зухра», в WhatsApp может стоять «Зухра Балакеримова».
      const isStaff = (name) => {
        const a = String(name || '').toLowerCase();
        if (!a || !staffNames.length) return false;
        return staffNames.some((n) => {
          const parts = String(n).split(/\s+/).filter(w => w.length > 2);
          return parts.length > 0 && parts.every(w => a.includes(w));
        });
      };

      const parsed = items.map((m, i) => {
        const mt = (m.meta || '').match(/\[(\d{1,2}:\d{2}),\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4})\]\s*(.*?):?$/);
        if (!mt) {
          // Подписи нет — это вложение, отправленное без текста. Направление
          // берём у ближайшего соседа с подписью: переписка идёт блоками,
          // и фото почти всегда рядом с репликой того же человека.
          let near = null;
          for (let d = 1; d < items.length && !near; d++) {
            const a = items[i - d];
            const b = items[i + d];
            near = (a && a.meta) ? a : ((b && b.meta) ? b : null);
          }
          const nm = near ? (near.meta || '').match(/\]\s*(.*?):?$/) : null;
          const nearAuthor = nm ? nm[1].trim() : '';
          const nd = nearAuthor.replace(/[^0-9]/g, '');
          let fm = false;
          if (nd) fm = !digits.endsWith(nd.slice(-10));
          else if (nearAuthor) fm = isStaff(nearAuthor);
          return { ...m, time: m.fallback_time, date: today, author: '', from_me: fm };
        }
        const time = mt?.[1] || null;
        const date = mt?.[2] || null;
        const author = (mt?.[3] || '').trim();
        const authorDigits = author.replace(/[^0-9]/g, '');

        // Направление.
        //
        // Подпись WhatsApp — «[10:32, 25.10.2026] Асланова Шанисе БАРТЕР:».
        // Автор в ней — НОМЕР, когда контакт не сохранён, и ИМЯ, когда
        // сохранён. Старое условие смотрело только цифры: при имени
        // authorDigits пуст, и сообщение объявлялось нашим исходящим — весь
        // чат с сохранённым контактом приходил как OUT, включая реплики
        // клиента («Я хочу начать массаж LPG»).
        //
        // Порядок опор:
        //   1) цифры в подписи — сверяем с номером собеседника;
        //   2) имя совпадает с именем сотрудника клиники (их список
        //      передаётся снаружи) — значит писали мы;
        //   3) иначе это имя собеседника — входящее.
        //
        // Геометрия пузыря опорой не стала: проверка на живой странице
        // показала, что вся переписка лежит в одной колонке, и сторона
        // ничего не различает.
        let fromMe;
        if (authorDigits) {
          fromMe = !digits.endsWith(authorDigits.slice(-10));
        } else if (author) {
          fromMe = isStaff(author);
        } else {
          fromMe = false;
        }
        return { ...m, time, date, author, from_me: fromMe };
      });
      return { ok: true, phone: digits, title, count: parsed.length, items: parsed };
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
  /**
   * Список чатов из боковой панели.
   *
   * @param {object} opts
   * @param {boolean} opts.scroll  прокрутить панель до конца и собрать ВСЕ чаты.
   *
   * Без прокрутки WhatsApp держит в DOM только видимые строки (виртуальный
   * список) — это десяток-полтора чатов. Для дозора этого хватает: новое
   * всегда наверху. Но для импорта по базе клиентов нужен полный список,
   * иначе 7000 клиентов сопоставляются с десятком строк на экране.
   */
  async listChats({ scroll = false } = {}) {
    if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
    return this._enqueue(async () => {
      await this.dismissDialogs();

      // Сбор строк из текущего DOM. Вынесен в функцию: при прокрутке
      // вызывается многократно, и накопитель живёт снаружи.
      const grab = () => this.page.evaluate(() => {
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

      const byTitle = new Map();
      const absorb = (rows) => {
        for (const r of rows) if (!byTitle.has(r.title)) byTitle.set(r.title, r);
      };

      absorb(await grab());

      if (scroll) {
        // Крутим панель вниз, пока появляются новые строки. Ограничители —
        // и число шагов, и «сколько раз подряд ничего нового»: у аккаунта с
        // тысячами чатов бесконечный цикл был бы хуже неполного списка.
        let idle = 0;
        for (let step = 0; step < 400 && idle < 4; step++) {
          const moved = await this.page.evaluate(() => {
            const pane = document.querySelector('#pane-side');
            if (!pane) return false;
            const before = pane.scrollTop;
            pane.scrollTop = before + pane.clientHeight * 0.8;
            return pane.scrollTop > before;
          });
          // Виртуальному списку нужно время дорисовать новую порцию.
          await new Promise(r => setTimeout(r, 450));
          const before = byTitle.size;
          absorb(await grab());
          if (byTitle.size === before) idle++; else idle = 0;
          if (!moved) break;
        }
        // Возвращаем панель наверх: дозор ждёт свежие чаты на первом экране.
        await this.page.evaluate(() => {
          const pane = document.querySelector('#pane-side');
          if (pane) pane.scrollTop = 0;
        });
      }

      // Номер вытаскиваем из заголовка: если контакт не сохранён, WhatsApp
      // показывает сам номер, если сохранён — имя, и тогда чат пропускаем
      // (сопоставить его с клиентом по имени ненадёжно).
      return [...byTitle.values()]
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
    // Снимаем отложенный автоповтор: иначе он сработает поверх ручного
    // рестарта и в один профиль полезут два Chromium разом.
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    this._retryAttempt = 0;
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
