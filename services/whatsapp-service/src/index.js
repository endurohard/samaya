import express from 'express';
import QRCode from 'qrcode';
import wa from './whatsapp.js';
import { listByClient, mediaOf, linkClientByPhone, digitsOf, saveScraped, newIncoming, unlinkedChats, markAuthor, authorName } from './store.js';
import { Monitor } from './monitor.js';
import { authenticate } from './auth.js';

const PORT = Number(process.env.PORT || 3008);
const monitor = new Monitor(wa);
const app = express();
app.use(express.json({ limit: '1mb' }));

// ── Health ──
app.get('/health', (_req, res) => res.json({ ok: true, service: 'whatsapp-service' }));

// Все /api/whatsapp/* требуют внутренний токен или JWT админа
// ── Живое окно: экран сеанса WhatsApp с управлением ──
// Страница отдаётся без токена в URL (открывается прямо в браузере), а сами
// действия идут через /live/* с тем же internal-токеном, что и остальное API.
app.get('/api/whatsapp/live', (req, res) => {
  // ?phone= — сразу открыть чат этого номера: окно вызывается из карточки
  // клиента, и вручную искать его в списке неудобно.
  const wantPhone = String(req.query.phone || '').replace(/[^0-9]/g, '');
  res.set('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Экран WhatsApp</title>
<style>
  body{margin:0;background:#111b21;color:#e9edef;font:14px system-ui,sans-serif}
  .bar{display:flex;gap:8px;align-items:center;padding:8px 12px;background:#202c33}
  .bar input{flex:1;padding:7px 10px;border:1px solid #2a3942;border-radius:6px;
    background:#2a3942;color:#e9edef;font:inherit}
  .bar button{padding:7px 14px;border:0;border-radius:6px;background:#00a884;
    color:#fff;font:inherit;cursor:pointer}
  .bar span{color:#8696a0;font-size:12px}
  #screen{display:block;margin:0 auto;cursor:crosshair;max-width:100%}
</style></head><body>
<div class="bar">
  <span id="st">подключение…</span>
  <input id="msg" placeholder="Текст — кликните в поле ввода WhatsApp, затем печатайте здесь">
  <button onclick="send(false)">Вставить</button>
  <button onclick="send(true)">Вставить + Enter</button>
</div>
<img id="screen" width="1280" height="720">
<script>
  const img = document.getElementById('screen');
  const st = document.getElementById('st');
  // Поток кадров: обычный опрос, а не видеострим — этого достаточно, чтобы
  // видеть происходящее и кликать, и не требует лишних зависимостей.
  async function tick() {
    try {
      const r = await fetch('/api/whatsapp/live/frame?t=' + Date.now());
      if (r.ok) {
        const b = await r.blob();
        const old = img.src;
        img.src = URL.createObjectURL(b);
        if (old.startsWith('blob:')) URL.revokeObjectURL(old);
        st.textContent = 'живой экран · ' + new Date().toLocaleTimeString();
      } else { st.textContent = 'нет кадра (' + r.status + ')'; }
    } catch (e) { st.textContent = 'ошибка: ' + e.message; }
    setTimeout(tick, 1200);
  }
  // Клик по картинке → клик в реальном окне. Пересчитываем координаты, если
  // картинка показана уменьшенной.
  img.addEventListener('click', async (e) => {
    const r = img.getBoundingClientRect();
    const x = Math.round((e.clientX - r.left) * (1280 / r.width));
    const y = Math.round((e.clientY - r.top) * (720 / r.height));
    await fetch('/api/whatsapp/live/click', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y }),
    });
  });
  async function send(enter) {
    const el = document.getElementById('msg');
    if (!el.value) return;
    await fetch('/api/whatsapp/live/type', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: el.value, enter }),
    });
    el.value = '';
  }
  // Если окно открыли из карточки клиента — сразу переключаем сеанс на его чат.
  const WANT = ${JSON.stringify(wantPhone)};
  if (WANT) {
    fetch('/api/whatsapp/live/open', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: WANT }),
    }).catch(() => {});
  }
  tick();
</script></body></html>`);
});

app.get('/api/whatsapp/live/frame', async (_req, res) => {
  try {
    const b64 = await wa.screenshot();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    return res.send(Buffer.from(b64, 'base64'));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/live/open', async (req, res) => {
  try {
    const digits = String(req.body?.phone || '').replace(/[^0-9]/g, '');
    if (!digits) return res.status(400).json({ error: 'phone required' });
    await wa.dismissDialogs();
    return res.json(await wa.openChatByRow(digits));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/live/click', async (req, res) => {
  try {
    const { x, y } = req.body || {};
    return res.json(await wa.clickAt(Number(x), Number(y)));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/whatsapp/live/type', async (req, res) => {
  try {
    const { text, enter } = req.body || {};
    return res.json(await wa.typeText(String(text || ''), !!enter));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.use('/api/whatsapp', authenticate);

// ── Status ──
app.get('/api/whatsapp/status', (_req, res) => res.json(wa.getStatus()));

// ── QR code (PNG as base64 data URL) ──
app.get('/api/whatsapp/qr', async (_req, res) => {
  const status = wa.getStatus();
  if (status.ready) return res.json({ status: 'ready', qr: null });
  const raw = wa.getQR();
  if (!raw) return res.json({ status: status.status, qr: null });
  // raw is already a canvas dataURL — return as-is or as terminal QR
  return res.json({ status: status.status, qr: raw });
});

// ── Send text message ──
app.post('/api/whatsapp/send', async (req, res) => {
  const { phone, message } = req.body || {};
  if (!phone || !message) {
    return res.status(400).json({ error: 'phone and message required' });
  }
  try {
    const result = await wa.sendMessage(phone, message);
    // Сразу дочитываем чат и сохраняем: иначе отправленное появится в карточке
    // только со следующим проходом монитора (до 15 минут), и администратор
    // решит, что сообщение не ушло. Читаем со страницы, а не пишем текст сами,
    // чтобы в базу попал настоящий идентификатор сообщения WhatsApp.
    try {
      const digits = digitsOf(phone);
      const read = await wa.readChat(digits, 20);
      if (read?.items?.length) await saveScraped(digits, read.items);
      // Подпись автора: за одним номером клиники работают посменно, и по
      // истории должно быть видно, кто что обещал клиенту. У внутреннего
      // токена автора нет — там пишет автоматика (напоминания о визите).
      if (req.user?.id) {
        await markAuthor(digits, message, { id: req.user.id, name: await authorName(req.user.id) });
      }
    } catch (e) {
      // Сообщение уже отправлено — неудача с дочитыванием не повод возвращать
      // ошибку: монитор подхватит его на следующем проходе.
      console.error('[WA][send] post-save failed:', e.message);
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Broadcast (фоновый job) ──
// Body: { recipients: [{phone, name}], message: string }
// Поддерживает шаблон {name} → имя клиента.
// Рассылка выполняется в фоне: POST сразу возвращает 202, прогресс — через
// GET /api/whatsapp/broadcast/status. Иначе долгая рассылка обрывается по
// proxy-timeout шлюза, а клиент не узнаёт результат.
let _broadcast = { running: false, total: 0, sent: 0, failed: [], started_at: null, finished_at: null };

async function runBroadcast(recipients, message) {
  const DELAY = Number(process.env.BROADCAST_DELAY_MS || 2500);
  const total = recipients.length;
  console.log(`[WA][broadcast] Starting: ${total} recipients`);
  try {
    for (const { phone, name } of recipients) {
      const text = message.replace(/\{name\}/g, name || '');
      try {
        await wa.sendMessage(phone, text);
        _broadcast.sent++;
        console.log(`[WA][broadcast] ${_broadcast.sent}/${total} → ${phone}`);
      } catch (err) {
        console.error(`[WA][broadcast] FAIL → ${phone}: ${err.message}`);
        _broadcast.failed.push({ phone, error: err.message });
      }
      if (_broadcast.sent + _broadcast.failed.length < total) {
        await new Promise(r => setTimeout(r, DELAY));
      }
    }
  } finally {
    _broadcast.running = false;
    _broadcast.finished_at = new Date().toISOString();
    console.log(`[WA][broadcast] Done: sent=${_broadcast.sent} failed=${_broadcast.failed.length}`);
  }
}

app.post('/api/whatsapp/broadcast', (req, res) => {
  if (_broadcast.running) {
    return res.status(409).json({ error: 'broadcast_running', message: 'Рассылка уже идёт' });
  }
  const { recipients, message } = req.body || {};
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'recipients array required' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }

  _broadcast = {
    running: true, total: recipients.length, sent: 0, failed: [],
    started_at: new Date().toISOString(), finished_at: null,
  };
  // Запускаем в фоне; ошибки внутри уже пойманы в runBroadcast.
  runBroadcast(recipients, message).catch(err => {
    console.error('[WA][broadcast] fatal:', err.message);
  });
  return res.status(202).json({ accepted: true, total: recipients.length });
});

app.get('/api/whatsapp/broadcast/status', (_req, res) => {
  return res.json({
    running: _broadcast.running,
    total: _broadcast.total,
    sent: _broadcast.sent,
    failed_count: _broadcast.failed.length,
    failed: _broadcast.failed,
    started_at: _broadcast.started_at,
    finished_at: _broadcast.finished_at,
  });
});

// ── Диагностика живой сессии (только чтение) ──
app.get('/api/whatsapp/probe', async (req, res) => {
  try {
    return res.json(await wa.probe(req.query.phone));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Переписка с клиентом ──
// История диалога для карточки клиента. Тексты из БД, вложения отдаются
// отдельным роутом: возвращать base64 в списке — это мегабайты на каждый
// показ карточки.
app.get('/api/whatsapp/messages/:clientId', async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 200, 500);
    return res.json({ items: await listByClient(req.params.clientId, limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Вложение по id сообщения: файл лежит на диске, в базе только путь.
app.get('/api/whatsapp/media/:waId', async (req, res) => {
  try {
    const m = await mediaOf(req.params.waId);
    if (!m) return res.status(404).json({ error: 'not_found' });
    res.set('Content-Type', m.mime || 'application/octet-stream');
    if (m.name) res.set('Content-Disposition', `inline; filename="${encodeURIComponent(m.name)}"`);
    return res.sendFile(m.abs);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Связать уже сохранённые сообщения с карточкой клиента: переписка могла
// начаться раньше, чем клиента завели в CRM.
app.post('/api/whatsapp/messages/:clientId/link', async (req, res) => {
  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const n = await linkClientByPhone(req.params.clientId, digitsOf(phone));
    return res.json({ linked: n });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Импорт истории чата временно недоступен: требует whatsapp-web.js, которая
// не работает с текущей вёрсткой WhatsApp Web (Store не инициализируется).
app.post('/api/whatsapp/import', (_req, res) => {
  return res.status(501).json({
    error: 'not_implemented',
    message: 'Импорт истории требует рабочей библиотеки whatsapp-web.js',
  });
});

// ── Чтение переписки из окна браузера ──
app.get('/api/whatsapp/read', async (req, res) => {
  try {
    if (!req.query.phone) return res.status(400).json({ error: 'phone required' });
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    return res.json(await wa.readChat(req.query.phone, limit));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Разбор структуры чата (диагностика парсера) ──
app.get('/api/whatsapp/inspect', async (req, res) => {
  try {
    if (!req.query.phone) return res.status(400).json({ error: 'phone required' });
    return res.json(await wa.inspectChat(req.query.phone));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Снимок экрана сеанса (диагностика) ──
app.get('/api/whatsapp/screenshot', async (_req, res) => {
  try {
    const b64 = await wa.screenshot();
    res.set('Content-Type', 'image/png');
    return res.send(Buffer.from(b64, 'base64'));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/whatsapp/env', async (_req, res) => {
  try {
    return res.json(await wa.envProbe());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/whatsapp/footer', async (_req, res) => {
  try {
    return res.json(await wa.footerProbe());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Дочитать один чат по требованию: карточка клиента вызывает это, пока окно
// переписки открыто, чтобы ответ клиента появлялся почти сразу.
app.post('/api/whatsapp/sync', async (req, res) => {
  try {
    const digits = digitsOf(req.body?.phone || '');
    if (!digits) return res.status(400).json({ error: 'phone required' });
    if (!wa.isReady) return res.json({ skipped: 'not ready' });
    const read = await wa.readChat(digits, 30);
    const r = read?.items?.length ? await saveScraped(digits, read.items) : { saved: 0 };
    return res.json({ ok: true, saved: r.saved });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Новые входящие с момента, который помнит браузер менеджера. Дёшево: только
// запрос в базу, окно WhatsApp не трогается.
app.get('/api/whatsapp/incoming', async (req, res) => {
  try {
    // Без since отдаём только свежее, иначе при первом открытии админки
    // менеджер получил бы всплывашки по всей истории переписки.
    const since = req.query.since
      ? new Date(String(req.query.since))
      : new Date(Date.now() - 60_000);
    if (Number.isNaN(since.getTime())) return res.status(400).json({ error: 'bad since' });
    const items = await newIncoming(since.toISOString());
    return res.json({ items, now: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Переписки с номеров, которых нет в базе клиентов. По ним менеджер решает:
// завести карточку или добавить номер существующему клиенту.
app.get('/api/whatsapp/unlinked', async (_req, res) => {
  try {
    return res.json({ items: await unlinkedChats() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Разовый импорт истории при подключении боевого номера. Идёт часами, поэтому
// запускается в фоне, а прогресс смотрится отдельным запросом.
app.post('/api/whatsapp/import-all', async (req, res) => {
  try {
    const pauseMs = Number(req.body?.pause_ms || 4000);
    const limit = Number(req.body?.limit || 0);
    return res.json(await monitor.importAll({ pauseMs, limit }));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/whatsapp/import-all/status', (_req, res) => res.json(monitor.importStatus()));

// ── Монитор переписки ──
// Ручной запуск прохода и его статус: удобно проверить сбор, не дожидаясь
// очередного цикла.
app.post('/api/whatsapp/monitor/run', async (_req, res) => {
  try {
    return res.json(await monitor.runOnce());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/whatsapp/monitor/status', (_req, res) => res.json(monitor.status()));

// ── Restart ──
app.post('/api/whatsapp/restart', async (_req, res) => {
  try {
    await wa.restart();
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Не роняем процесс из-за необработанных ошибок в фоновых задачах (Puppeteer/сеть).
process.on('unhandledRejection', (reason) => {
  console.error('[WA] unhandledRejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[WA] uncaughtException:', err?.message || err);
});

app.listen(PORT, () => {
  console.log(`[whatsapp-service] listening on :${PORT}`);

  // Громкое предупреждение, когда оба предохранителя сняты: боевой режим с
  // пустым allowlist означает, что любой вызов /send или /broadcast уйдёт
  // реальным клиентам. Сервис при этом работает — решение за человеком, но
  // «я не знал» быть не должно.
  const testMode = process.env.WHATSAPP_TEST_MODE === 'true';
  const allow = (process.env.WHATSAPP_ALLOWLIST || '').trim();
  if (!testMode && !allow) {
    console.warn('[WA] ВНИМАНИЕ: WHATSAPP_TEST_MODE=false и WHATSAPP_ALLOWLIST пуст — '
      + 'отправка разрешена на ЛЮБОЙ номер. Задайте allowlist, пока проверяете.');
  }

  // Auto-initialize (non-blocking)
  wa.initialize().catch(err => console.error('[WA] init error:', err.message));
  monitor.start();
});
