import express from 'express';
import QRCode from 'qrcode';
import wa from './whatsapp.js';
import { authenticate } from './auth.js';

const PORT = Number(process.env.PORT || 3008);
const app = express();
app.use(express.json({ limit: '1mb' }));

// ── Health ──
app.get('/health', (_req, res) => res.json({ ok: true, service: 'whatsapp-service' }));

// Все /api/whatsapp/* требуют внутренний токен или JWT админа
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
  // Auto-initialize (non-blocking)
  wa.initialize().catch(err => console.error('[WA] init error:', err.message));
});
