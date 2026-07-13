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
    };
  }

  getQR() { return this.qrDataUrl; }

  // Сериализация операций с единственной страницей. Каждая задача ждёт завершения
  // предыдущей; ошибка одной задачи не рвёт цепочку для следующих.
  _enqueue(fn) {
    const run = this._queue.then(() => fn(), () => fn());
    // держим «хвост» очереди, но проглатываем результат/ошибку, чтобы не копить unhandled
    this._queue = run.then(() => {}, () => {});
    return run;
  }

  // ── Cleanup stale Chrome processes (iTTEST pattern) ──
  async _cleanup() {
    const locks = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];
    const hasLock = locks.some(f => fs.existsSync(path.join(SESSION_DIR, f)));
    if (!hasLock) return;
    console.log('[WA] Cleaning stale Chrome locks…');
    // Убиваем только процессы Chromium этой сессии (по userDataDir), а не все
    // headless-браузеры в контейнере.
    try {
      await execAsync(`pkill -9 -f ${JSON.stringify('user-data-dir=' + SESSION_DIR)} 2>/dev/null`);
    } catch { /* ok */ }
    await new Promise(r => setTimeout(r, 1500));
    for (const f of locks) {
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
      if (SOCKS_PROXY) args.push(`--proxy-server=${SOCKS_PROXY}`);

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
    this._healthIv = setInterval(async () => {
      if (!this.isReady || !this.page) return;
      try {
        const alive = await this.page.evaluate(() => {
          return !!(document.querySelector('#side')
            || document.querySelector('[data-testid="chat-list"]'));
        });
        if (!alive) {
          console.warn('[WA] Session appears logged out — reinitializing');
          this.isReady = false;
          this.statusMsg = 'disconnected';
          clearInterval(this._healthIv);
          this._healthIv = null;
          this.restart().catch(e => console.error('[WA] auto-restart failed:', e.message));
        }
      } catch (e) {
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
    let d = String(raw || '').replace(/[^0-9]/g, '');
    if (d.startsWith('8')) d = '7' + d.slice(1);
    if (!d.startsWith('7')) d = '7' + d;
    if (d.length < 11 || d.length > 15) {
      throw new Error(`invalid phone: ${raw}`);
    }
    return d;
  }

  // ── Open chat then send text ──
  async _openChat(phone) {
    const url = `https://web.whatsapp.com/send?phone=${phone}`;
    const curUrl = this.page.url();
    if (!curUrl.includes('web.whatsapp.com')) {
      await this.page.goto(url, { waitUntil: 'networkidle2', timeout: 60_000 });
    } else {
      await this.page.evaluate(u => { window.location.href = u; }, url);
      await new Promise(r => setTimeout(r, 2000));
    }
    // Wait for message input
    await this.page.waitForSelector(
      '[data-testid="conversation-compose-box-input"], [contenteditable="true"][data-tab="10"]',
      { timeout: 30_000 }
    );
    await new Promise(r => setTimeout(r, 1000));
  }

  async sendMessage(phone, message) {
    if (TEST_MODE) {
      const clean = this._normalizePhone(phone);
      console.log(`[WA][TEST] → ${clean}: ${message.slice(0, 80)}`);
      return { success: true, test_mode: true, phone: clean };
    }
    // Валидируем номер до постановки в очередь, чтобы плохой ввод не занимал слот.
    const clean = this._normalizePhone(phone);

    // Все операции с this.page строго последовательны — см. _enqueue.
    return this._enqueue(async () => {
      if (!this.isReady || !this.page) throw new Error('WhatsApp not ready');
      console.log(`[WA] Sending to ${clean}…`);

      await this._openChat(clean);

      // Type and send
      const input = await this.page.$('[data-testid="conversation-compose-box-input"], [contenteditable="true"][data-tab="10"]');
      await input.click();

      // Split message by newlines for proper Enter handling
      for (const line of message.split('\n')) {
        await this.page.keyboard.type(line);
        await this.page.keyboard.down('Shift');
        await this.page.keyboard.press('Enter');
        await this.page.keyboard.up('Shift');
      }

      // Remove last extra newline by pressing Backspace, then send
      await this.page.keyboard.press('Backspace');
      await this.page.keyboard.press('Enter');
      await new Promise(r => setTimeout(r, 1500));

      // Подтверждение отправки: поле ввода должно очиститься. Если текст остался —
      // сообщение не ушло (сетевой лаг/зависание), не рапортуем ложный success.
      const stillHasText = await this.page.evaluate(() => {
        const el = document.querySelector('[data-testid="conversation-compose-box-input"], [contenteditable="true"][data-tab="10"]');
        return !!(el && el.textContent && el.textContent.trim().length > 0);
      }).catch(() => false);
      if (stillHasText) {
        throw new Error('message not sent (compose box not cleared)');
      }

      console.log(`[WA] Sent to ${clean}`);
      return { success: true, phone: clean };
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
