import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { requirePermission } from '../middleware';

// Обзор телефонии: метрики за период, кому перезвонить, нагрузка по часам и
// сотрудники. Отдельным запросом, а не довеском к журналу: журнал листается
// по 50 строк, а сводка нужна по всему периоду сразу.
//
// «Перезвонили» — после пропущенного входящего с этим номером был любой
// исходящий или отвеченный входящий. ВАТС отдельного признака не даёт, а для
// администратора смысл именно такой: клиент до нас в итоге достучался.
// «Записался» — у клиента появилась запись в течение суток после звонка.

const router = Router();

const q = z.object({
  from: z.string(),
  to: z.string(),
  tz: z.string().max(64).default('Europe/Moscow'),
});

router.get('/stats', requirePermission('telephony.view'), async (req, res, next) => {
  try {
    const { from, to, tz } = q.parse(req.query);
    const company = req.auth!.company_id;
    const fromD = new Date(from);
    const toD = new Date(to);
    if (Number.isNaN(fromD.getTime()) || Number.isNaN(toD.getTime()) || toD <= fromD) {
      return res.status(400).json({ error: 'bad period' });
    }
    // Прошлый период той же длины — для сравнения «больше/меньше, чем было».
    const prevFrom = new Date(fromD.getTime() - (toD.getTime() - fromD.getTime())).toISOString();

    const totalsSql = `
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE c.direction = 'inbound')::int AS inbound,
             COUNT(*) FILTER (WHERE c.direction = 'outbound')::int AS outbound,
             COUNT(*) FILTER (WHERE c.status = 'answered')::int AS answered,
             COUNT(*) FILTER (WHERE c.status = 'missed')::int AS missed,
             COUNT(*) FILTER (WHERE c.handled_by = 'ai')::int AS ai,
             COALESCE(ROUND(AVG(c.duration_sec) FILTER (WHERE c.status = 'answered' AND c.duration_sec > 0)), 0)::int AS avg_talk_sec,
             COUNT(*) FILTER (WHERE c.status = 'missed' AND c.direction = 'inbound' AND EXISTS (
               SELECT 1 FROM telephony.calls x
                WHERE x.company_id = c.company_id AND x.client_digits = c.client_digits
                  AND x.started_at > c.started_at
                  AND (x.direction = 'outbound' OR x.status = 'answered')))::int AS called_back,
             COUNT(*) FILTER (WHERE c.client_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM bookings.bookings b
                WHERE b.company_id = c.company_id AND b.client_id = c.client_id
                  AND b.created_at BETWEEN c.started_at AND c.started_at + interval '1 day'))::int AS booked
        FROM telephony.calls c
       WHERE c.company_id = $1 AND c.started_at >= $2 AND c.started_at < $3
         AND COALESCE((SELECT mk.caller_kind FROM telephony.call_marks mk WHERE mk.call_id = c.id), '') <> 'staff'`;

    const [cur, prev, callbacks, hours, staff] = await Promise.all([
      pool.query(totalsSql, [company, from, to]),
      pool.query(totalsSql, [company, prevFrom, from]),
      // Кому перезвонить: номера, у которых последний контакт — пропущенный
      // входящий. Считаем от начала периода до сейчас, а не до конца периода:
      // долг перезвона не исчезает оттого, что выбран прошлый месяц.
      pool.query(
        `WITH last AS (
           SELECT DISTINCT ON (c.client_digits)
                  c.id, c.client_digits, c.client_number, c.client_id, c.started_at,
                  c.status, c.direction, c.handled_by
             FROM telephony.calls c
            WHERE c.company_id = $1 AND c.client_digits IS NOT NULL AND c.started_at >= $2
            ORDER BY c.client_digits, c.started_at DESC
         )
         SELECT l.id AS call_id, l.client_digits, l.client_number, l.client_id,
                l.started_at AS last_at, l.handled_by,
                cl.full_name AS client_name,
                (SELECT COUNT(*)::int FROM telephony.calls m
                  WHERE m.company_id = $1 AND m.client_digits = l.client_digits
                    AND m.status = 'missed' AND m.started_at >= $2) AS attempts
           FROM last l
           LEFT JOIN clients.clients cl ON cl.id = l.client_id
           LEFT JOIN telephony.call_marks mk ON mk.call_id = l.id
          WHERE l.direction = 'inbound' AND l.status = 'missed'
            AND mk.processed_at IS NULL
            -- номер, отмеченный как «сотрудник», перезванивать не нужно
            AND NOT EXISTS (SELECT 1 FROM telephony.call_marks s
                             WHERE s.company_id = $1 AND s.client_digits = l.client_digits
                               AND s.caller_kind = 'staff')
          ORDER BY l.started_at ASC
          LIMIT 30`,
        [company, from],
      ),
      pool.query(
        `SELECT EXTRACT(HOUR FROM c.started_at AT TIME ZONE $4)::int AS hour,
                COUNT(*) FILTER (WHERE c.status = 'answered')::int AS answered,
                COUNT(*) FILTER (WHERE c.status = 'missed')::int AS missed,
                COUNT(*) FILTER (WHERE c.handled_by = 'ai')::int AS ai
           FROM telephony.calls c
          WHERE c.company_id = $1 AND c.direction = 'inbound'
            AND c.started_at >= $2 AND c.started_at < $3
          GROUP BY 1 ORDER BY 1`,
        [company, from, to, tz],
      ),
      pool.query(
        `SELECT CASE WHEN c.handled_by = 'ai' THEN 'ai' ELSE COALESCE(c.master_id::text, 'ext:' || c.extension) END AS key,
                MAX(m.display_name) AS name,
                MAX(c.extension) AS extension,
                BOOL_OR(c.handled_by = 'ai') AS is_ai,
                COUNT(*)::int AS calls,
                COALESCE(ROUND(AVG(c.duration_sec) FILTER (WHERE c.duration_sec > 0)), 0)::int AS avg_sec,
                COUNT(*) FILTER (WHERE c.client_id IS NOT NULL AND EXISTS (
                  SELECT 1 FROM bookings.bookings b
                   WHERE b.company_id = c.company_id AND b.client_id = c.client_id
                     AND b.created_at BETWEEN c.started_at AND c.started_at + interval '1 day'))::int AS booked
           FROM telephony.calls c
           LEFT JOIN salons.masters m ON m.id = c.master_id
          WHERE c.company_id = $1 AND c.status = 'answered'
            AND c.started_at >= $2 AND c.started_at < $3
            AND (c.handled_by = 'ai' OR c.master_id IS NOT NULL OR c.extension IS NOT NULL)
          GROUP BY 1
          ORDER BY calls DESC
          LIMIT 12`,
        [company, from, to],
      ),
    ]);

    return res.json({
      period: { from, to, prev_from: prevFrom },
      totals: cur.rows[0],
      prev: prev.rows[0],
      callbacks: callbacks.rows,
      hours: hours.rows,
      staff: staff.rows,
    });
  } catch (e) { return next(e); }
});

export default router;
