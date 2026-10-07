// Сеанс Instagram Direct на puppeteer.
//
// Устроен так же, как whatsapp-service: один headless Chromium с постоянным
// профилем в томе, одна вкладка на instagram.com/direct/inbox, все операции
// сериализованы очередью. Причина та же — страница одна, и параллельные
// действия перемешивают ввод, отправляя текст не в тот диалог.
//
// Чем Instagram отличается от WhatsApp и что из этого следует:
//
//  * Нет QR. Вход — либо перенос cookie уже залогиненной сессии (основной
//    путь, см. importCookies), либо ручной ввод через живое окно. Пароль
//    сервис не хранит и не принимает.
//  * Instagram жёстче относится к автоматизации: чекпоинт прилетает за темп,
//    за смену IP и за «нечеловеческий» ввод. Поэтому печать посимвольная с
//    задержкой, обход диалогов редкий, а выход — через тот же VLESS-мост,
//    что и WhatsApp (локальный IP; переезд сессии на голландский адрес
//    сервера — типичная причина блокировки).
//  * Разлогин и чекпоинт выглядят по-разному и требуют разной реакции:
//    разлогин лечится повторным входом, чекпоинт — только человеком. Их
//    нельзя смешивать в одном статусе, иначе сервис будет бесконечно
//    переподнимать браузер на экране «подтвердите, что это вы».
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SESSION_DIR = process.env.INSTAGRAM_SESSION_DIR
  || path.join(__dirname, '../data/session');
const CHROMIUM_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';
const TEST_MODE = process.env.INSTAGRAM_TEST_MODE === 'true';
const SOCKS_PROXY = process.env.INSTAGRAM_SOCKS_PROXY || '';
const INBOX_URL = 'https://www.instagram.com/direct/inbox/';

// Белый список получателей — предохранитель для боевой сессии, как в
// whatsapp-service. Локальная база — копия прода, и одна случайно запущенная
// отправка ушла бы живым людям. Здесь это ники (без @), в нижнем регистре.
const ALLOWLIST = (process.env.INSTAGRAM_ALLOWLIST || '')
  .split(',')
  .map(s => s.trim().replace(/^@/, '').toLowerCase())
  .filter(Boolean);

// Поле ввода сообщения. Порядок важен: сначала устойчивая роль textbox внутри
// формы диалога, обфусцированные классы Instagram меняются от сборки к сборке
// и опорой быть не могут.
const COMPOSE_SELECTORS = [
  'div[role="textbox"][contenteditable="true"]',
  'textarea[placeholder]',
  'div[aria-label*="Сообщение"][contenteditable="true"]',
  'div[aria-label*="Message"][contenteditable="true"]',
];
const COMPOSE_SELECTOR = COMPOSE_SELECTORS.join(', ');

// Человеческая пауза. Нужна и между символами, и между действиями: ровный
// машинный темп — первое, по чему Instagram опознаёт автоматизацию.
const rnd = (min, max) => Math.floor(min + Math.random() * (max - min));
const sleep = ms => new Promise(r => setTimeout(r, ms));

class InstagramManager {
  constructor() {
    this.browser = null;
    this.page = null;
    this.isReady = false;
    // not_started | initializing | loading | login_required | checkpoint |
    // ready | disconnected | error | restarting
    this.statusMsg = 'not_started';
    this.lastError = null;
    this.selfUser = null;      // ник аккаунта, под которым вошли
    this._initPromise = null;
    this._retryTimer = null;
    this._retryAttempt = 0;
    this._queue = Promise.resolve();
    this._busy = false;
    this._healthIv = null;
    this._healthMisses = 0;

    if (!fs.existsSync(SESSION_DIR)) fs.mkdirSync(SESSION_DIR, { recursive: true });

    if (TEST_MODE) {
      this.isReady = true;
      this.statusMsg = 'test_mode';
      console.log('[IG] ТЕСТОВЫЙ РЕЖИМ — сообщения НЕ отправляются');
    } else if (!ALLOWLIST.length) {
      console.warn('[IG] ВНИМАНИЕ: белый список пуст — отправка разрешена всем');
    }
  }

  getStatus() {
    return {
      ready: this.isReady,
      status: this.statusMsg,
      test_mode: TEST_MODE,
      account: this.selfUser,
      last_error: this.lastError,
      allowlist_size: ALLOWLIST.length,
      // Чекпоинт отдаём отдельным флагом: на него фронт обязан отреагировать
      // не «подождите», а «зайдите в аккаунт с телефона и подтвердите вход».
      needs_human: this.statusMsg === 'checkpoint' || this.statusMsg === 'login_required',
    };
  }

  // Сериализация операций с единственной страницей.
  _enqueue(fn) {
    const wrapped = async () => {
      this._busy = true;
      try {
        return await fn();
      } finally {
        this._busy = false;
      }
    };
    const next = this._queue.then(wrapped, wrapped);
    // Ошибку гасим только в цепочке, вызывающему она возвращается как есть:
    // иначе один упавший вызов обрывал бы все последующие.
    this._queue = next.then(() => {}, () => {});
    return next;
  }

  async _cleanup() {
    try { if (this.browser) await this.browser.close(); } catch { /* уже мёртв */ }
    this.browser = null;
    this.page = null;
    this.isReady = false;
    // Локи профиля — симлинки вида <hostname>-<pid>; после пересоздания
    // контейнера они битые, и Chromium отказывается стартовать. existsSync
    // идёт по ссылке и битую не видит — проверяем lstatSync.
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      const p = path.join(SESSION_DIR, name);
      try { fs.lstatSync(p); fs.unlinkSync(p); } catch { /* нет лока — хорошо */ }
    }
  }

  async initialize() {
    if (TEST_MODE) return;
    if (this._initPromise) return this._initPromise;
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
        '--lang=ru-RU,ru',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          + ' (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      ];
      if (SOCKS_PROXY) {
        args.push(`--proxy-server=${SOCKS_PROXY}`);
        args.push('--proxy-bypass-list=<-loopback>');
        // WebRTC в обход прокси показывает настоящий IP сервера — ровно то
        // расхождение, ради устранения которого туннель и поднимается.
        args.push('--force-webrtc-ip-handling-policy=disable_non_proxied_udp');
        args.push('--webrtc-ip-handling-policy=disable_non_proxied_udp');
        console.log(`[IG] прокси: ${SOCKS_PROXY}`);
      }

      this.browser = await puppeteer.launch({
        executablePath: CHROMIUM_PATH,
        headless: true,
        userDataDir: SESSION_DIR,
        protocolTimeout: 300_000,
        args,
      });

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1280, height: 900 });
      // Часовой пояс и язык как у клиники: расхождение между локалью браузера
      // и регионом аккаунта — ещё один сигнал автоматизации.
      try { await this.page.emulateTimezone('Europe/Moscow'); } catch { /* не критично */ }
      await this.page.setExtraHTTPHeaders({ 'Accept-Language': 'ru-RU,ru;q=0.9' });

      this.statusMsg = 'loading';
      console.log('[IG] Открываю Instagram Direct…');
      await this.page.goto(INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

      await this._detectState();
      this._startHealthCheck();
      this._retryAttempt = 0;
    } catch (err) {
      this.statusMsg = 'error';
      this.lastError = err.message;
      this._initPromise = null;
      try { if (this.browser) await this.browser.close(); } catch { /* ok */ }
      this.browser = null;
      this.page = null;
      console.error('[IG] Ошибка инициализации:', err.message);
      this._scheduleRetry();
    }
  }

  // Что сейчас на экране. Три исхода требуют трёх разных реакций, и путать их
  // нельзя: на чекпоинте перезагрузка страницы бесполезна и только добавляет
  // Instagram поводов считать аккаунт подозрительным.
  async _detectState() {
    if (!this.page) return 'error';
    const st = await this.page.evaluate(() => {
      const url = location.href;
      const text = (document.body?.innerText || '').slice(0, 3000);
      const has = sel => !!document.querySelector(sel);
      return {
        url,
        text,
        // Список диалогов: ссылки вида /direct/t/<id>/ — самый устойчивый
        // признак рабочего инбокса, он переживает смену вёрстки.
        inbox: !!document.querySelector('a[href^="/direct/t/"]')
          || has('div[role="grid"]')
          || /Ваши сообщения|Your messages/i.test(text),
        loginForm: has('input[name="username"]') || has('input[name="password"]'),
      };
    });

    if (/\/challenge|\/accounts\/suspended|\/accounts\/disabled/.test(st.url)
        || /подтвердите|confirm it.s you|suspicious login|необычн/i.test(st.text)) {
      this.isReady = false;
      this.statusMsg = 'checkpoint';
      this.lastError = 'Instagram требует подтверждения входа — нужен человек';
      console.warn('[IG] ЧЕКПОИНТ: требуется подтверждение входа вручную');
      return this.statusMsg;
    }
    if (st.loginForm || /\/accounts\/login/.test(st.url)) {
      this.isReady = false;
      this.statusMsg = 'login_required';
      console.warn('[IG] Нужен вход: сессии нет или она истекла');
      return this.statusMsg;
    }
    if (st.inbox) {
      this.isReady = true;
      this.statusMsg = 'ready';
      this.lastError = null;
      this.selfUser = await this._readSelfUser();
      console.log(`[IG] Сеанс готов${this.selfUser ? ` (@${this.selfUser})` : ''}`);
      return this.statusMsg;
    }
    // Ни то ни другое: страница ещё грузится. Это не ошибка — Direct
    // подтягивается несколькими запросами и на медленном канале рисуется
    // заметно позже domcontentloaded.
    this.isReady = false;
    this.statusMsg = 'loading';
    return this.statusMsg;
  }

  // Ник текущего аккаунта. Нужен, чтобы отличать свои сообщения от чужих и
  // чтобы в интерфейсе было видно, под кем сервис сидит.
  async _readSelfUser() {
    try {
      return await this.page.evaluate(() => {
        // Instagram кладёт данные сессии в глобальный конфиг страницы.
        const u = window._sharedData?.config?.viewer?.username;
        if (u) return u;
        const m = document.documentElement.innerHTML.match(/"username":"([^"]{1,40})","is_private"/);
        return m ? m[1] : null;
      });
    } catch { return null; }
  }

  // Повтор инициализации с нарастающей паузой: 30 с, 1, 2, 4, 8 мин, дальше
  // раз в 15 минут. Индекс не зажимаем в длину массива — иначе ветка «долгая
  // авария» недостижима и сервис вечно долбит браузер максимальным шагом.
  _scheduleRetry() {
    if (TEST_MODE || this._retryTimer) return;
    // Чекпоинт автоматикой не лечится: повторные заходы только усиливают
    // подозрение. Ждём человека.
    if (this.statusMsg === 'checkpoint') {
      console.warn('[IG] Повтор не планирую: чекпоинт снимается только вручную');
      return;
    }
    const STEPS = [30_000, 60_000, 120_000, 240_000, 480_000];
    const delay = STEPS[this._retryAttempt] ?? 900_000;
    this._retryAttempt++;
    console.warn(`[IG] Повтор инициализации через ${Math.round(delay / 1000)} с `
      + `(попытка ${this._retryAttempt})`);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      this.initialize().catch(e => console.error('[IG] повтор не удался:', e.message));
    }, delay);
    if (typeof this._retryTimer.unref === 'function') this._retryTimer.unref();
  }

  _startHealthCheck() {
    if (this._healthIv) clearInterval(this._healthIv);
    this._healthMisses = 0;
    this._healthIv = setInterval(async () => {
      if (!this.browser || !this.page) {
        if (this.statusMsg !== 'initializing' && this.statusMsg !== 'restarting') {
          console.warn('[IG] Браузер отсутствует — планирую переподъём');
          this.isReady = false;
          this._initPromise = null;
          this._scheduleRetry();
        }
        return;
      }
      // Пока идёт работа с диалогами, DOM в промежуточном состоянии. Занятый
      // сеанс сам по себе доказывает, что он жив.
      if (this._busy) return;
      try {
        const before = this.statusMsg;
        const now = await this._detectState();
        if (now === 'ready') { this._healthMisses = 0; return; }
        if (now === 'checkpoint') {
          // Состояние устойчивое и требует человека — переподнимать нечего.
          if (before !== 'checkpoint') console.warn('[IG] Обнаружен чекпоинт');
          return;
        }
        // Один промах ничего не значит: страница могла перерисовываться.
        this._healthMisses++;
        if (this._healthMisses < 3) {
          console.warn(`[IG] Проверка живости: промах ${this._healthMisses}/3 (${now})`);
          return;
        }
        console.warn(`[IG] Сеанс потерян (${now}) — переподнимаю`);
        clearInterval(this._healthIv);
        this._healthIv = null;
        this.restart().catch(e => console.error('[IG] авторестарт не удался:', e.message));
      } catch (e) {
        // «Execution context was destroyed» — это навигация, а не разлогин.
        console.warn('[IG] Ошибка проверки живости:', e.message);
      }
    }, 30_000);
  }

  async restart() {
    this.statusMsg = 'restarting';
    // Отложенный повтор обязан быть погашен: иначе в один профиль полезут
    // два Chromium и оба испортят сессию.
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    this._initPromise = null;
    await this._cleanup();
    await this.initialize();
    return this.getStatus();
  }

  // ── Вход ──

  /**
   * Перенос cookie уже залогиненной сессии. Основной способ входа: пароль
   * нигде не вводится и не хранится, а сессия, выписанная настоящему
   * браузеру владельца, вызывает у Instagram меньше подозрений, чем свежий
   * вход с серверного адреса.
   * cookies: [{name, value, domain?, path?}] — минимум sessionid, ds_user_id, csrftoken.
   */
  async importCookies(cookies) {
    if (!Array.isArray(cookies) || !cookies.length) throw new Error('нет cookie');
    if (!this.browser) await this.initialize();
    if (!this.page) throw new Error('браузер не поднят');
    const names = cookies.map(c => c.name);
    if (!names.includes('sessionid')) throw new Error('в наборе нет sessionid');

    return this._enqueue(async () => {
      await this.page.setCookie(...cookies.map(c => ({
        name: c.name,
        value: String(c.value),
        domain: c.domain || '.instagram.com',
        path: c.path || '/',
        httpOnly: c.name === 'sessionid',
        secure: true,
      })));
      await this.page.goto(INBOX_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await sleep(3000);
      const state = await this._detectState();
      return { ok: state === 'ready', status: state, account: this.selfUser };
    });
  }

  // ── Чтение ──

  /** Список диалогов из инбокса. Дёшево: страницу не трогаем, только читаем. */
  async listThreads() {
    if (!this.isReady || !this.page) throw new Error('Instagram не готов');
    return this._enqueue(async () => {
      const rows = await this.page.evaluate(() => {
        const out = [];
        for (const a of document.querySelectorAll('a[href^="/direct/t/"]')) {
          const m = a.getAttribute('href').match(/\/direct\/t\/(\d+)/);
          if (!m) continue;
          const text = (a.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
          // Непрочитанное Instagram помечает кружком без текста, поэтому
          // опираемся на aria-label строки, а не на сам бейдж.
          const label = a.getAttribute('aria-label') || a.closest('[aria-label]')?.getAttribute('aria-label') || '';
          const unreadM = label.match(/(\d+)\s*(непрочит|unread)/i);
          out.push({
            thread_id: m[1],
            title: text[0] || '',
            preview: text[1] || '',
            // Время показано относительным («2 ч», «3 д») — абсолютную метку
            // берём из самого сообщения при чтении диалога, здесь она только
            // для сортировки списка в интерфейсе.
            last_rel: text[2] || '',
            unread: unreadM ? Number(unreadM[1]) : (/непрочит|unread/i.test(label) ? 1 : 0),
            avatar: a.querySelector('img')?.src || null,
          });
        }
        return out;
      });
      return rows;
    });
  }

  /**
   * Прочитать диалог. Открываем по прямой ссылке, а не кликом по строке:
   * список виртуализирован, нужной строки может не быть в DOM, и клик
   * «вслепую» попадает в соседний диалог.
   */
  async readThread(threadId, limit = 50) {
    if (!this.isReady || !this.page) throw new Error('Instagram не готов');
    const id = String(threadId).replace(/[^0-9]/g, '');
    if (!id) throw new Error('неверный thread_id');

    return this._enqueue(async () => {
      if (!this.page.url().includes(`/direct/t/${id}`)) {
        await this.page.goto(`https://www.instagram.com/direct/t/${id}/`,
          { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await sleep(rnd(2500, 4000));
      }

      const data = await this.page.evaluate((max) => {
        // Собеседник: заголовок диалога. Ник берём из ссылки на профиль —
        // отображаемое имя человек меняет, ник в ссылке стабильнее.
        const head = document.querySelector('header') || document;
        const profLink = [...head.querySelectorAll('a[href^="/"]')]
          .map(a => a.getAttribute('href'))
          .find(h => /^\/[A-Za-z0-9._]{1,30}\/$/.test(h) && !h.startsWith('/direct'));
        const username = profLink ? profLink.replace(/\//g, '') : null;
        const fullName = (head.querySelector('h1,h2')?.innerText || '').trim() || null;

        // Сообщения. Instagram помечает их role="listitem" внутри области с
        // role="grid"; у каждого есть вложенный элемент с aria-label, в
        // котором лежит и автор, и время — обфусцированные классы опорой
        // быть не могут.
        const grid = document.querySelector('div[role="grid"]')
          || document.querySelector('div[aria-label*="сообщен" i]')
          || document.querySelector('main');
        const out = [];
        if (!grid) return { username, fullName, items: out };

        for (const row of grid.querySelectorAll('div[role="listitem"], div[role="row"]')) {
          const txtEl = row.querySelector('div[dir="auto"], span[dir="auto"]');
          const body = (txtEl?.innerText || '').trim();
          const img = row.querySelector('img[src*="cdninstagram"], img[src^="blob:"]');
          const video = row.querySelector('video');
          const audio = row.querySelector('[aria-label*="удиосообщ" i], [aria-label*="Audio" i]');
          const hasMedia = !!(img || video || audio);
          if (!body && !hasMedia) continue;

          // Направление. Надёжного признака «моё сообщение» в разметке нет,
          // поэтому опираемся на геометрию: свои Instagram прижимает вправо.
          // Это выдерживает смену классов, в отличие от любого селектора.
          const r = row.getBoundingClientRect();
          const gr = grid.getBoundingClientRect();
          const fromMe = (r.left - gr.left) > (gr.width - (r.right - gr.left)) * 0.9;

          // Идентификатор сообщения. Своего id в DOM нет, поэтому строим
          // устойчивый ключ из диалога, направления, текста и подписи
          // времени: повторный обход того же диалога даст тот же ключ, и
          // ON CONFLICT отсечёт дубль.
          const label = row.querySelector('[aria-label]')?.getAttribute('aria-label') || '';
          const timeEl = row.querySelector('time');
          const stamp = timeEl?.getAttribute('datetime') || label || '';

          out.push({
            body,
            has_media: hasMedia,
            media_kind: audio ? 'voice' : (video ? 'video' : (img ? 'image' : null)),
            media_url: img?.src || video?.src || null,
            from_me: fromMe,
            stamp,
            label,
          });
        }
        return { username, fullName, items: out.slice(-max) };
      }, limit);

      return { ok: true, thread_id: id, ...data };
    });
  }

  // ── Отправка ──

  _checkAllowed(username) {
    if (!ALLOWLIST.length) return true;
    return ALLOWLIST.includes(String(username || '').replace(/^@/, '').toLowerCase());
  }

  /**
   * Отправить текст в диалог. Печатаем посимвольно с человеческими паузами:
   * мгновенная вставка всего текста — заметный машинный признак, а Instagram
   * к нему чувствителен сильнее, чем WhatsApp.
   */
  async sendToThread(threadId, text, opts = {}) {
    if (TEST_MODE) {
      console.log(`[IG][ТЕСТ] не отправлено в ${threadId}: ${text}`);
      return { ok: true, test_mode: true };
    }
    if (!this.isReady || !this.page) throw new Error('Instagram не готов');
    const id = String(threadId).replace(/[^0-9]/g, '');
    if (!id) throw new Error('неверный thread_id');
    const body = String(text || '').trim();
    if (!body) throw new Error('пустое сообщение');

    return this._enqueue(async () => {
      if (!this.page.url().includes(`/direct/t/${id}`)) {
        await this.page.goto(`https://www.instagram.com/direct/t/${id}/`,
          { waitUntil: 'domcontentloaded', timeout: 45_000 });
        await sleep(rnd(2500, 4000));
      }

      // Белый список проверяем по нику собеседника, прочитанному со страницы
      // уже открытого диалога: thread_id сам по себе ничего не говорит о том,
      // кому уйдёт сообщение.
      if (ALLOWLIST.length) {
        const who = await this.page.evaluate(() => {
          const h = document.querySelector('header') || document;
          const link = [...h.querySelectorAll('a[href^="/"]')]
            .map(a => a.getAttribute('href'))
            .find(x => /^\/[A-Za-z0-9._]{1,30}\/$/.test(x) && !x.startsWith('/direct'));
          return link ? link.replace(/\//g, '') : null;
        });
        if (!this._checkAllowed(who)) {
          throw new Error(`получатель @${who || '?'} не в белом списке — отправка запрещена`);
        }
      }

      await this.page.waitForSelector(COMPOSE_SELECTOR, { timeout: 20_000 });
      const input = await this.page.$(COMPOSE_SELECTOR);
      if (!input) throw new Error('поле ввода не найдено');
      await input.click();
      await sleep(rnd(300, 700));

      // Переносы строк в Direct отправляют сообщение, поэтому многострочный
      // текст склеиваем в абзацы через пробел, а не шлём Enter внутри текста.
      const flat = body.replace(/\s*\n+\s*/g, ' ').trim();
      for (const ch of flat) {
        await this.page.keyboard.type(ch, { delay: 0 });
        await sleep(rnd(18, 60));
      }
      await sleep(rnd(400, 900));
      await this.page.keyboard.press('Enter');
      await sleep(rnd(1200, 2000));

      // Подтверждение отправки: текст должен появиться последним исходящим.
      // Без проверки сервис отчитается об успехе даже когда Instagram молча
      // отклонил сообщение (лимит, ограничение аккаунта).
      const confirmed = await this.page.evaluate((sent) => {
        const t = (document.body.innerText || '');
        return t.includes(sent.slice(0, Math.min(40, sent.length)));
      }, flat);

      return { ok: true, thread_id: id, confirmed, text: flat };
    });
  }

  /** Открыть диалог по нику: нужно, когда пишем первыми из карточки клиента. */
  async openByUsername(username) {
    if (!this.isReady || !this.page) throw new Error('Instagram не готов');
    const u = String(username || '').replace(/[^A-Za-z0-9._]/g, '');
    if (!u) throw new Error('неверный ник');
    return this._enqueue(async () => {
      const threads = await this.page.evaluate((want) => {
        for (const a of document.querySelectorAll('a[href^="/direct/t/"]')) {
          if ((a.innerText || '').toLowerCase().includes(want.toLowerCase())) {
            return a.getAttribute('href').match(/\/direct\/t\/(\d+)/)?.[1] || null;
          }
        }
        return null;
      }, u);
      return { ok: !!threads, thread_id: threads, username: u };
    });
  }

  // ── Живое окно ──

  async screenshot() {
    if (!this.page) throw new Error('страница не поднята');
    return this.page.screenshot({ encoding: 'base64', type: 'png' });
  }

  async clickAt(x, y) {
    if (!this.page) throw new Error('страница не поднята');
    return this._enqueue(async () => {
      await this.page.mouse.click(x, y);
      return { ok: true, x, y };
    });
  }

  async typeText(text, pressEnter = false) {
    if (!this.page) throw new Error('страница не поднята');
    return this._enqueue(async () => {
      for (const ch of String(text)) {
        await this.page.keyboard.type(ch, { delay: 0 });
        await sleep(rnd(18, 60));
      }
      if (pressEnter) await this.page.keyboard.press('Enter');
      return { ok: true };
    });
  }

  async gotoUrl(url) {
    if (!this.page) throw new Error('страница не поднята');
    if (!/^https:\/\/(www\.)?instagram\.com\//.test(url)) {
      throw new Error('разрешены только адреса instagram.com');
    }
    return this._enqueue(async () => {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      await sleep(1500);
      return { ok: true, state: await this._detectState() };
    });
  }
}

const manager = new InstagramManager();
export default manager;
