import express from 'express';
import QRCode from 'qrcode';
import wa from './whatsapp.js';

const PORT = Number(process.env.PORT || 3008);
const app = express();
app.use(express.json({ limit: '1mb' }));

// ── Health ──
app.get('/health', (_req, res) => res.json({ ok: true, service: 'whatsapp-service' }));

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

// ── Broadcast (sequential, с задержкой между сообщениями) ──
// Body: { recipients: [{phone, name}], message: string }
// Поддерживает шаблон {name} → имя клиента
let _broadcastRunning = false;

app.post('/api/whatsapp/broadcast', async (req, res) => {
  if (_broadcastRunning) {
    return res.status(409).json({ error: 'broadcast_running', message: 'Рассылка уже идёт' });
  }
  const { recipients, message } = req.body || {};
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'recipients array required' });
  }
  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ error: 'message required' });
  }

  _broadcastRunning = true;
  const total = recipients.length;
  let sent = 0;
  const failed = [];

  // Delay between messages (ms) — снижает риск блокировки WA
  const DELAY = Number(process.env.BROADCAST_DELAY_MS || 2500);

  console.log(`[WA][broadcast] Starting: ${total} recipients`);

  for (const { phone, name } of recipients) {
    const text = message.replace(/\{name\}/g, name || '');
    try {
      await wa.sendMessage(phone, text);
      sent++;
      console.log(`[WA][broadcast] ${sent}/${total} → ${phone}`);
    } catch (err) {
      console.error(`[WA][broadcast] FAIL → ${phone}: ${err.message}`);
      failed.push({ phone, error: err.message });
    }
    if (sent + failed.length < total) {
      await new Promise(r => setTimeout(r, DELAY));
    }
  }

  _broadcastRunning = false;
  console.log(`[WA][broadcast] Done: sent=${sent} failed=${failed.length}`);
  return res.json({ total, sent, failed_count: failed.length, failed });
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

app.listen(PORT, () => {
  console.log(`[whatsapp-service] listening on :${PORT}`);
  // Auto-initialize (non-blocking)
  wa.initialize().catch(err => console.error('[WA] init error:', err.message));
});
