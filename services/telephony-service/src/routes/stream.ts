import { Router } from 'express';
import { pool } from '../db';
import { requirePermission } from '../middleware';
import { bus, eventsStatus, type LiveEvent } from '../events';

const router = Router();

// Поток событий звонков в браузер администратора (SSE).
//
// Кому что показывать:
//   • у пользователя привязан внутренний номер (masters.user_id → extension_links)
//     — только звонки на его номер, плюс продолжение уже показанных звонков;
//   • номера нет, но роль owner/admin — все входящие: администратор на ресепшене
//     обычно принимает звонки с общего телефона;
//   • иначе поток пуст — и не надо держать соединение.
//
// SSE вместо websocket: одно направление, проходит через nginx/Kong без
// апгрейда, переподключение делает сам браузер. Через fetch с Bearer, а не
// EventSource — тому нельзя передать заголовок авторизации.
router.get('/stream', requirePermission('telephony.view'), async (req, res, next) => {
  try {
    const companyId = req.auth!.company_id;
    const { rows } = await pool.query<{ extension: string }>(
      `SELECT l.extension
         FROM telephony.extension_links l
         JOIN salons.masters m ON m.id = l.master_id
        WHERE l.company_id = $1 AND l.enabled AND m.user_id = $2`,
      [companyId, req.auth!.sub],
    );
    const mine = rows.map((r) => r.extension);
    const scope: 'mine' | 'all' | 'none' = mine.length
      ? 'mine'
      : (req.auth!.role === 'owner' || req.auth!.role === 'admin' ? 'all' : 'none');
    if (scope === 'none') return res.status(403).json({ error: 'no extension', code: 'NO_EXTENSION' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx: не буферизовать ответ (иначе события копятся до закрытия)
      'X-Accel-Buffering': 'no',
    });
    const send = (event: string, data: unknown) => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send('hello', { scope, extensions: mine, vats: eventsStatus() });

    // Звонки, которые уже показали этому клиенту: их «ответили»/«завершён»
    // должны дойти, даже если employee в событии другой (ответил коллега).
    const shown = new Set<string>();
    const onCall = (ev: LiveEvent) => {
      if (ev.direction !== 'inbound') return;
      const relevant = scope === 'all'
        || (ev.employee != null && mine.includes(ev.employee))
        || shown.has(ev.call_id);
      if (!relevant) return;
      if (ev.type === 'ended') shown.delete(ev.call_id); else shown.add(ev.call_id);
      send('call', ev);
    };
    bus.on('call', onCall);

    // Kong и nginx закрывают молчащий ответ по таймауту чтения — шлём комментарий.
    const ping = setInterval(() => res.write(': ping\n\n'), 20_000);

    req.on('close', () => {
      clearInterval(ping);
      bus.off('call', onCall);
    });
    return undefined;
  } catch (e) { return next(e); }
});

export default router;
