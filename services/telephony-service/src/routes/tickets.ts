import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { HttpError, requirePermission } from '../middleware';
import { getCall, setTicketStatus, VatsError } from '../vats';
import { markCall } from './calls';

const router = Router();

// Заявки AI-оператора: что он понял из разговора, пока администратор был занят.
// Список — зеркало из ВАТС (см. sync.ts), статус общий с ВАТС и Telegram.

const listQuery = z.object({
  status: z.enum(['new', 'confirmed', 'done', 'cancelled']).optional(),
  days: z.coerce.number().int().min(1).max(365).default(30),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

router.get('/tickets', requirePermission('telephony.view'), async (req, res, next) => {
  try {
    const q = listQuery.parse(req.query);
    const params: unknown[] = [req.auth!.company_id, `${q.days} days`];
    let where = `WHERE t.company_id = $1 AND t.created_at >= NOW() - $2::interval`;
    if (q.status) { params.push(q.status); where += ` AND t.status = $${params.length}`; }
    params.push(q.limit, q.offset);
    const { rows } = await pool.query(
      `SELECT t.*, cl.full_name AS client_full_name,
              (SELECT c.has_recording FROM telephony.calls c WHERE c.id = t.call_id) AS call_has_recording
         FROM telephony.ai_tickets t
         LEFT JOIN clients.clients cl ON cl.id = t.client_id
         ${where}
         ORDER BY (t.status = 'new') DESC, t.created_at DESC
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    const open = await pool.query(
      `SELECT COUNT(*)::int AS open FROM telephony.ai_tickets WHERE company_id = $1 AND status = 'new'`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows, open: open.rows[0].open });
  } catch (e) { return next(e); }
});

const statusSchema = z.object({ status: z.enum(['new', 'confirmed', 'done', 'cancelled']) });

// Сначала ВАТС, потом своя база — как с привязкой номеров: если чужая сторона
// недоступна, статус не расходится между системами.
router.post('/tickets/:id/status', requirePermission('telephony.view'), async (req, res, next) => {
  try {
    const { status } = statusSchema.parse(req.body);
    const exists = await pool.query<{ call_id: string | null; client_number: string | null }>(
      'SELECT call_id, client_number FROM telephony.ai_tickets WHERE company_id = $1 AND id = $2',
      [req.auth!.company_id, req.params.id],
    );
    if (!exists.rowCount) throw new HttpError(404, 'NOT_FOUND', 'заявка не найдена');
    try {
      await setTicketStatus(req.params.id, status);
    } catch (e) {
      if (e instanceof VatsError) throw new HttpError(502, 'VATS_UNAVAILABLE', 'ВАТС не приняла статус заявки');
      throw e;
    }
    const closing = status === 'done' || status === 'cancelled';
    await pool.query(
      `UPDATE telephony.ai_tickets
          SET status = $3,
              handled_by = CASE WHEN $4 THEN $5::uuid ELSE NULL END,
              handled_at = CASE WHEN $4 THEN NOW() ELSE NULL END
        WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.id, status, closing, req.auth!.sub],
    );
    // Закрытая заявка — обработанный звонок: карточка звонка не должна
    // всплыть снова у коллег или после переподключения потока.
    const { call_id, client_number } = exists.rows[0];
    if (closing && call_id) {
      await markCall(req.auth!.company_id, req.auth!.sub, call_id, { processed: true, caller_kind: 'client', client_number });
    }
    return res.json({ id: req.params.id, status });
  } catch (e) { return next(e); }
});

// Разговор с AI-оператором: резюме и расшифровка. Не храним у себя — это
// текст разговора с пациентом, ему место там же, где и запись; берём из ВАТС
// по требованию, право то же, что на прослушивание.
router.get('/calls/:id/ai', requirePermission('telephony.listen'), async (req, res, next) => {
  try {
    const own = await pool.query(
      'SELECT 1 FROM telephony.calls WHERE company_id = $1 AND id = $2',
      [req.auth!.company_id, req.params.id],
    );
    if (!own.rowCount) throw new HttpError(404, 'NOT_FOUND', 'звонок не найден');
    let call;
    try {
      call = await getCall(req.params.id);
    } catch (e) {
      if (e instanceof VatsError) throw new HttpError(502, 'VATS_UNAVAILABLE', 'ВАТС недоступна');
      throw e;
    }
    return res.json(call.ai ?? null);
  } catch (e) { return next(e); }
});

export default router;
