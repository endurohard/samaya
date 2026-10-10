import express from 'express';
import ig from './instagram.js';
import { Monitor } from './monitor.js';
import { authenticate } from './auth.js';
import { aiStatus, prepareReply } from './assistant.js';
import { verifySignature, verifyChallenge, parseWebhook, webhookStatus, sendMessage } from './graph.js';
import { handleMessages, autoreplyEnabled } from './webhook.js';
import {
  listThreads, listThreadMessages, listByClient, linkThreadToClient,
  newIncoming, unreadCount, markAuthor, authorName,
  saveMessages, upsertThread, saveDraft, clearDraft, getDraft, pendingDrafts,
} from './store.js';

const PORT = Number(process.env.PORT || 3010);
const monitor = new Monitor(ig);
const app = express();

// Webhook Meta ДО express.json(): подпись считается по сырым байтам тела,
// а распарсенный и заново сериализованный JSON даёт другую строку (порядок
// ключей, пробелы) и подпись никогда не сойдётся.
app.post('/api/instagram/webhook',
  express.raw({ type: '*/*', limit: '1mb' }),
  async (req, res) => {
    const sig = verifySignature(req.body, req.get('x-hub-signature-256'));
    if (!sig.ok) {
      console.warn('[IG][webhook] отклонён:', sig.reason);
      return res.sendStatus(403);
    }

    let body;
    try { body = JSON.parse(req.body.toString('utf8')); }
    catch { return res.sendStatus(400); }

    // Отвечаем Meta сразу: она ждёт 200 за секунды и при задержке шлёт
    // то же событие повторно. Разбор и ответ клиенту идут после ответа.
    res.sendStatus(200);

    const items = parseWebhook(body);
    if (!items.length) {
      // Молчание без следа выглядит как поломка: запрос дошёл, ответ 200,
      // в логах пусто. Пишем, ЧТО именно пришло, — обычно это событие
      // другого поля (live_comments, messaging_seen), на которое отвечать
      // не нужно.
      const fields = (body?.entry ?? [])
        .flatMap(e => [
          ...(e.messaging ? ['messaging'] : []),
          ...((e.changes ?? []).map(c => c.field)),
        ]);
      console.log('[IG][webhook] событие без сообщений, поля:',
        fields.length ? fields.join(', ') : 'нет');
      return;
    }
    try {
      const stats = await handleMessages(items);
      console.log('[IG][webhook]', JSON.stringify(stats));
    } catch (e) {
      console.error('[IG][webhook] обработка:', e.message);
    }
  });

// Подключение webhook: Meta дёргает GET с проверочным токеном и ждёт
// обратно значение hub.challenge открытым текстом.
app.get('/api/instagram/webhook', (req, res) => {
  const v = verifyChallenge(req.query);
  if (!v.ok) {
    console.warn('[IG][webhook] проверка не пройдена:', v.reason);
    return res.sendStatus(403);
  }
  return res.type('text/plain').send(v.challenge);
});

app.use(express.json({ limit: '1mb' }));

// ── Health ──
// Отдаём не только «порт жив», но и состояние сеанса: контейнер с мёртвым
// браузером не должен сутками показывать healthy (ровно это было с
// whatsapp-service). 503 ставим при аварии, но НЕ при login_required и
// checkpoint: это штатные состояния, ждущие человека, и перезапуск
// контейнера их не лечит — только добавит Instagram поводов для подозрений.
app.get('/health', (_req, res) => {
  const st = ig.getStatus();
  const broken = st.status === 'error' || st.status === 'disconnected';
  return res.status(broken ? 503 : 200).json({
    ok: !broken,
    service: 'instagram-service',
    session: st.status,
    ready: st.ready,
    account: st.account,
    needs_human: st.needs_human,
    last_error: st.last_error,
  });
});

// ── Живое окно ──
// Страница отдаётся без токена (открывается прямо в браузере), действия идут
// через /live/* . Нужна для входа в аккаунт и для снятия чекпоинта: это
// единственный способ отличить «ждём загрузки» от «требуется подтверждение»
// и что-то с этим сделать, не заходя на сервер.
app.get('/api/instagram/live', (_req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8');
  return res.send(`<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><title>Экран Instagram</title>
<style>
  body{margin:0;background:#000;color:#fafafa;font:14px system-ui,sans-serif}
  .bar{display:flex;gap:8px;align-items:center;padding:8px 12px;background:#121212;
    border-bottom:1px solid #262626;flex-wrap:wrap}
  .bar input{flex:1;min-width:200px;padding:7px 10px;border:1px solid #363636;
    border-radius:8px;background:#262626;color:#fafafa;font:inherit}
  .bar button{padding:7px 14px;border:0;border-radius:8px;background:#0095f6;
    color:#fff;font:inherit;cursor:pointer}
  .bar span{color:#a8a8a8;font-size:12px}
  #screen{display:block;margin:0 auto;cursor:crosshair;max-width:100%}
</style></head><body>
<div class="bar">
  <span id="st">подключение…</span>
  <input id="msg" placeholder="Текст — кликните в поле на экране, затем печатайте здесь">
  <button onclick="send(false)">Ввести</button>
  <button onclick="send(true)">Ввести + Enter</button>
</div>
<img id="screen" width="1280" height="900">
<script>
  const img = document.getElementById('screen');
  const st = document.getElementById('st');
  // Поток кадров опросом, а не видеострим: этого достаточно, чтобы видеть
  // происходящее и кликать, и не тянет лишних зависимостей.
  async function tick() {
    try {
      const r = await fetch('/api/instagram/live/frame?t=' + Date.now());
      if (r.ok) {
        const b = await r.blob();
        const old = img.src;
        img.src = URL.createObjectURL(b);
        if (old.startsWith('blob:')) URL.revokeObjectURL(old);
        st.textContent = 'живой экран · ' + new Date().toLocaleTimeString();
      } else { st.textContent = 'нет кадра (' + r.status + ')'; }
    } catch (e) { st.textContent = 'ошибка: ' + e.message; }
    setTimeout(tick, 1500);
  }
  img.addEventListener('click', async (e) => {
    const r = img.getBoundingClientRect();
    const x = Math.round((e.clientX - r.left) * (1280 / r.width));
    const y = Math.round((e.clientY - r.top) * (900 / r.height));
    await fetch('/api/instagram/live/click', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x, y }),
    });
  });
  async function send(enter) {
    const el = document.getElementById('msg');
    if (!el.value) return;
    await fetch('/api/instagram/live/type', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: el.value, enter }),
    });
    el.value = '';
  }
  tick();
</script></body></html>`);
});

app.get('/api/instagram/live/frame', async (_req, res) => {
  try {
    const b64 = await ig.screenshot();
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'no-store');
    return res.send(Buffer.from(b64, 'base64'));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/instagram/live/click', async (req, res) => {
  try {
    const { x, y } = req.body || {};
    return res.json(await ig.clickAt(Number(x), Number(y)));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/instagram/live/type', async (req, res) => {
  try {
    const { text, enter } = req.body || {};
    return res.json(await ig.typeText(String(text || ''), !!enter));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/instagram/live/goto', async (req, res) => {
  try {
    return res.json(await ig.gotoUrl(String(req.body?.url || '')));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Всё остальное — только по внутреннему токену или JWT админа.
app.use('/api/instagram', authenticate);

// ── Состояние сеанса ──
app.get('/api/instagram/status', (_req, res) => res.json({
  ...ig.getStatus(),
  monitor: monitor.status(),
  ai: aiStatus(),
  // Официальный путь: готов ли приём webhook и включён ли автоответ.
  // Нужен, чтобы в админке отличать «браузерная сессия не поднята» от
  // «работаем через API, браузер не требуется».
  webhook: { ...webhookStatus(), autoreply: autoreplyEnabled() },
}));

// ── Вход переносом cookie ──
// Основной способ подключить аккаунт: пароль не передаётся и не хранится.
// Набор cookie снимается в браузере, где владелец уже вошёл.
app.post('/api/instagram/session/cookies', async (req, res) => {
  try {
    const cookies = req.body?.cookies;
    const r = await ig.importCookies(cookies);
    return res.json(r);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

// ── Диалоги ──
app.get('/api/instagram/threads', async (_req, res) => {
  try {
    return res.json(await listThreads());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/instagram/threads/:id/messages', async (req, res) => {
  try {
    return res.json(await listThreadMessages(req.params.id, Number(req.query.limit) || 200));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Привязка диалога к карточке клиента. Автоматически связать Instagram с
// клиентом не по чему — у собеседника нет телефона, поэтому это ручное
// действие администратора (или срабатывание по номеру из переписки).
app.post('/api/instagram/threads/:id/link', async (req, res) => {
  try {
    const clientId = req.body?.client_id;
    if (!clientId) return res.status(400).json({ error: 'client_id обязателен' });
    return res.json(await linkThreadToClient(req.params.id, clientId));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Переписка в карточке клиента ──
app.get('/api/instagram/client/:id/messages', async (req, res) => {
  try {
    return res.json(await listByClient(req.params.id, Number(req.query.limit) || 200));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Уведомления ──
app.get('/api/instagram/incoming', async (req, res) => {
  try {
    const since = req.query.since ? new Date(String(req.query.since)) : new Date(Date.now() - 3600_000);
    return res.json({
      messages: await newIncoming(since, Number(req.query.limit) || 20),
      unread: await unreadCount(since),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Отправка ──
app.post('/api/instagram/send', async (req, res) => {
  const { thread_id: threadId, message } = req.body || {};
  if (!threadId || !message) {
    return res.status(400).json({ error: 'нужны thread_id и message' });
  }

  // Официальный API предпочтительнее браузера: мгновенно, без риска
  // чекпоинта и не требует живой сессии Chromium. Браузерный путь остаётся
  // запасным — он работает, пока Meta не одобрила Advanced Access.
  const viaApi = await sendMessage(threadId, message);
  if (viaApi.ok) {
    try {
      const clientId = await upsertThread({
        thread_id: threadId, unread: 0, last_body: message, last_at: new Date(),
      });
      await saveMessages(threadId, [{
        from_me: true, body: message, stamp: new Date().toISOString(),
      }], clientId);
      if (req.user?.id) {
        await markAuthor(threadId, message, {
          id: req.user.id, name: await authorName(req.user.id),
        });
      }
      await clearDraft(threadId);
    } catch (e) {
      console.error('[IG][send] запись в историю не удалась:', e.message);
    }
    return res.json({ ok: true, via: 'graph_api', message_id: viaApi.messageId });
  }

  // Токена нет — это штатная ситуация до подключения интеграции, идём
  // браузером. Любая другая ошибка API (истёк токен, окно 24 часов) —
  // настоящая, и подменять её браузерной попыткой нельзя: она тоже не
  // пройдёт, а администратор получит невнятное сообщение.
  const noToken = /токен Instagram не сохранён|не записан id аккаунта/.test(viaApi.error || '');
  if (!noToken) {
    return res.status(502).json({ error: viaApi.error, via: 'graph_api' });
  }

  try {
    const result = await ig.sendToThread(threadId, message);
    // Сразу дочитываем диалог: иначе отправленное появится в карточке только
    // со следующим обходом (до 15 минут), и администратор решит, что
    // сообщение не ушло.
    try {
      const after = await ig.readThread(threadId, 15);
      if (after?.items?.length) {
        const clientId = await upsertThread({
          thread_id: threadId,
          username: after.username,
          full_name: after.fullName,
          unread: 0,
          last_body: message,
          last_at: new Date(),
        });
        await saveMessages(threadId, after.items, clientId);
      }
      // Подпись автора: за одним аккаунтом работают посменно, и по истории
      // должно быть видно, кто что обещал клиенту. У внутреннего токена
      // автора нет — там пишет автоматика.
      if (req.user?.id) {
        await markAuthor(threadId, message, {
          id: req.user.id, name: await authorName(req.user.id),
        });
      }
      // Отправили вручную — черновик ИИ больше не актуален, иначе клиент
      // получит почти тот же текст вторым сообщением.
      await clearDraft(threadId);
    } catch (e) {
      // Сообщение уже ушло: неудача с дочитыванием — не повод отдавать
      // ошибку, монитор подхватит его следующим проходом.
      console.error('[IG][send] дочитывание не удалось:', e.message);
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── ИИ-ответчик ──

// Очередь черновиков на проверку администратором.
app.get('/api/instagram/drafts', async (_req, res) => {
  try {
    return res.json(await pendingDrafts());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Сгенерировать черновик для диалога вручную — кнопка «предложить ответ».
app.post('/api/instagram/threads/:id/draft', async (req, res) => {
  try {
    const history = await listThreadMessages(req.params.id, 20);
    const r = await prepareReply(history);
    if (!r.ok) return res.status(400).json({ error: r.reason });
    await saveDraft(req.params.id, r.draft, !!r.safe);
    return res.json({ draft: r.draft, safe: r.safe });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete('/api/instagram/threads/:id/draft', async (req, res) => {
  try {
    await clearDraft(req.params.id);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Отправить черновик (возможно отредактированный администратором).
app.post('/api/instagram/threads/:id/draft/send', async (req, res) => {
  try {
    const stored = await getDraft(req.params.id);
    const text = String(req.body?.message || stored?.ai_draft || '').trim();
    if (!text) return res.status(400).json({ error: 'черновик пуст' });
    const result = await ig.sendToThread(req.params.id, text);
    await clearDraft(req.params.id);
    if (req.user?.id) {
      await markAuthor(req.params.id, text, {
        id: req.user.id, name: await authorName(req.user.id),
      });
    }
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── Монитор ──
app.post('/api/instagram/monitor/run', async (_req, res) => {
  try {
    await monitor.fullPass();
    return res.json(monitor.status());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post('/api/instagram/monitor/start', (_req, res) => res.json(monitor.start()));
app.post('/api/instagram/monitor/stop', (_req, res) => res.json(monitor.stop()));
app.get('/api/instagram/monitor/status', (_req, res) => res.json(monitor.status()));

// ── Перезапуск сеанса ──
app.post('/api/instagram/restart', async (_req, res) => {
  try {
    return res.json(await ig.restart());
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Не роняем процесс из-за необработанных ошибок в фоновых задачах
// (puppeteer, сеть): сервис должен пережить сбой одного прохода.
//
// Но ошибки запуска гасить нельзя. Без этой проверки EADDRINUSE попадал сюда
// же, и контейнер оставался «живым» процессом без слушателя: healthcheck
// стучался в закрытый порт, docker перезапускал контейнер по кругу, а в
// логе была одна строка, не похожая на фатальную. Падаем сразу и явно.
const FATAL_STARTUP = new Set(['EADDRINUSE', 'EACCES', 'EADDRNOTAVAIL']);
process.on('unhandledRejection', (reason) => {
  console.error('[IG] unhandledRejection:', reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  if (FATAL_STARTUP.has(err?.code)) {
    console.error(`[IG] FATAL: не удалось занять порт ${PORT} (${err.code})`);
    process.exit(1);
  }
  console.error('[IG] uncaughtException:', err?.message || err);
});

app.listen(PORT, () => {
  console.log(`[instagram-service] слушает :${PORT}`);

  // Громкое предупреждение, когда сняты оба предохранителя: боевой режим с
  // пустым белым списком означает, что любой вызов отправки уйдёт реальному
  // человеку. Сервис при этом работает — решение за владельцем, но «я не
  // знал» быть не должно.
  const testMode = process.env.INSTAGRAM_TEST_MODE === 'true';
  const allow = (process.env.INSTAGRAM_ALLOWLIST || '').trim();
  if (!testMode && !allow) {
    console.warn('[IG] ВНИМАНИЕ: INSTAGRAM_TEST_MODE=false и INSTAGRAM_ALLOWLIST пуст — '
      + 'отправка разрешена кому угодно. Задайте список, пока проверяете.');
  }
  if (process.env.INSTAGRAM_AI_AUTOSEND === 'true') {
    console.warn('[IG] ВНИМАНИЕ: автоотправка ответов ИИ ВКЛЮЧЕНА — '
      + 'сообщения клиентам уходят без проверки администратором.');
  }

  ig.initialize().catch(err => console.error('[IG] ошибка инициализации:', err.message));
  if (process.env.INSTAGRAM_MONITOR === 'true') monitor.start();
  else console.log('[IG] монитор выключен (INSTAGRAM_MONITOR != true)');
});
