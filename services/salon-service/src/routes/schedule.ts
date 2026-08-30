import { Router } from 'express';
import { z } from 'zod';
import { isoDate } from '../validators';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

const router = Router();
router.use(authenticate);

const querySchema = z.object({
  from: isoDate(),
  to: isoDate(),
});

// ===== Ассистенты: кто к какому врачу прикреплён в конкретный день =====
// Объявлено до '/:masterId', иначе '/assistants' уедет в него как id мастера.

router.get('/assistants/all', async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    const { rows } = await pool.query(
      `SELECT work_date::text AS work_date, assistant_id, master_id
         FROM salons.assistant_assignments
        WHERE company_id = $1 AND work_date >= $2::date AND work_date <= $3::date
        ORDER BY work_date`,
      [req.auth!.company_id, q.from, q.to],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

// Пару задают с любой стороны: выделили дни ассистента — выбирают врача,
// выделили дни врача — выбирают, кто ему в этот день ассистирует.
// null на одной из сторон снимает прикрепление: assistant_id без master_id —
// «этот ассистент сегодня никому», master_id без assistant_id — «у этого врача
// сегодня никого». Отдельный DELETE на каждую дату означал бы пачку запросов
// при снятии выделенного диапазона.
const assignSchema = z.object({
  items: z.array(z.object({
    work_date: isoDate(),
    assistant_id: z.string().uuid().nullable().optional(),
    master_id: z.string().uuid().nullable().optional(),
  }).refine((d) => d.assistant_id || d.master_id, {
    message: 'assistant_id or master_id required',
  })).min(1).max(366),
});

router.put('/assistants/all', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { items } = assignSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    await client.query('BEGIN');

    // Оба сотрудника должны принадлежать компании: id приходят с клиента, и
    // без проверки чужого мастера можно было бы прикрепить к своему графику.
    const ids = [...new Set(items.flatMap((it) => [it.assistant_id, it.master_id].filter(Boolean)))];
    const own = await client.query(
      `SELECT id FROM salons.masters WHERE company_id = $1 AND id = ANY($2::uuid[])`,
      [companyId, ids],
    );
    if (own.rows.length !== ids.length) throw new HttpError(404, 'master not found');

    for (const it of items) {
      if (!it.master_id) {
        await client.query(
          `DELETE FROM salons.assistant_assignments
            WHERE company_id = $1 AND assistant_id = $2 AND work_date = $3::date`,
          [companyId, it.assistant_id, it.work_date],
        );
        continue;
      }
      // Снятие со стороны врача: у него в этот день может быть не один
      // ассистент, поэтому убираем всех — выбор «никого» так и читается.
      if (!it.assistant_id) {
        await client.query(
          `DELETE FROM salons.assistant_assignments
            WHERE company_id = $1 AND master_id = $2 AND work_date = $3::date`,
          [companyId, it.master_id, it.work_date],
        );
        continue;
      }
      if (it.master_id === it.assistant_id) throw new HttpError(400, 'assistant cannot assist self');
      await client.query(
        `INSERT INTO salons.assistant_assignments (company_id, assistant_id, master_id, work_date)
         VALUES ($1, $2, $3, $4::date)
         ON CONFLICT (assistant_id, work_date) DO UPDATE SET master_id = EXCLUDED.master_id`,
        [companyId, it.assistant_id, it.master_id, it.work_date],
      );

      // Прикрепление к врачу и есть выход ассистента на работу: держать смену
      // отдельной галочкой значит делать ту же работу дважды и получать день,
      // за который прикрепление есть, а оплаты за выход нет — зарплата считает
      // ставку по рабочим дням графика.
      //
      // Часы берём у врача: ассистент выходит на его приём. Если у врача на
      // этот день смены нет — по шаблону компании, иначе 10:00–20:00.
      // Уже проставленную смену не перетираем: её могли задать руками короче
      // или длиннее. А вот выходной перебиваем — прикрепили, значит работает.
      await client.query(
        `INSERT INTO salons.master_schedules AS ms
           (company_id, master_id, work_date, start_time, end_time, is_day_off)
         SELECT $1, $2, $4::date,
                COALESCE(doc.start_time, tmpl.start_time, TIME '10:00'),
                COALESCE(doc.end_time,   tmpl.end_time,   TIME '20:00'),
                FALSE
           FROM (SELECT 1) AS one
           LEFT JOIN salons.master_schedules doc
             ON doc.master_id = $3 AND doc.work_date = $4::date AND doc.is_day_off = FALSE
           LEFT JOIN LATERAL (
             SELECT start_time, end_time
               FROM salons.schedule_templates
              WHERE company_id = $1 AND is_default = TRUE
              ORDER BY created_at
              LIMIT 1
           ) tmpl ON TRUE
         ON CONFLICT (master_id, work_date) DO UPDATE SET
           is_day_off = FALSE,
           start_time = COALESCE(
             CASE WHEN ms.is_day_off THEN NULL ELSE ms.start_time END, EXCLUDED.start_time),
           end_time = COALESCE(
             CASE WHEN ms.is_day_off THEN NULL ELSE ms.end_time END, EXCLUDED.end_time)`,
        [companyId, it.assistant_id, it.master_id, it.work_date],
      );
    }

    await client.query('COMMIT');
    return res.json({ updated: items.length });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

router.get('/:masterId', async (req, res, next) => {
  try {
    const q = querySchema.parse(req.query);
    const { rows } = await pool.query(
      `SELECT id, master_id, work_date::text AS work_date,
              start_time::text AS start_time, end_time::text AS end_time, is_day_off
       FROM salons.master_schedules
       WHERE company_id = $1 AND master_id = $2
         AND work_date >= $3::date AND work_date <= $4::date
       ORDER BY work_date`,
      [req.auth!.company_id, req.params.masterId, q.from, q.to],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const itemSchema = z.object({
  work_date: isoDate(),
  is_day_off: z.boolean().optional().default(false),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
}).refine(
  (d) => d.is_day_off === true || (d.start_time !== undefined && d.end_time !== undefined),
  { message: 'start_time and end_time required when is_day_off=false' },
);

const bulkSchema = z.object({
  items: z.array(itemSchema).min(1).max(366),
});

router.put('/:masterId', requireRole(['owner', 'admin']), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { items } = bulkSchema.parse(req.body);
    await client.query('BEGIN');

    const m = await client.query(
      `SELECT id FROM salons.masters WHERE company_id = $1 AND id = $2`,
      [req.auth!.company_id, req.params.masterId],
    );
    if (!m.rows[0]) throw new HttpError(404, 'master not found');

    for (const it of items) {
      await client.query(
        `INSERT INTO salons.master_schedules
           (company_id, master_id, work_date, start_time, end_time, is_day_off)
         VALUES ($1, $2, $3::date, $4::time, $5::time, $6)
         ON CONFLICT (master_id, work_date) DO UPDATE SET
           start_time = EXCLUDED.start_time,
           end_time   = EXCLUDED.end_time,
           is_day_off = EXCLUDED.is_day_off`,
        [
          req.auth!.company_id,
          req.params.masterId,
          it.work_date,
          it.is_day_off ? null : it.start_time,
          it.is_day_off ? null : it.end_time,
          it.is_day_off,
        ],
      );
    }

    await client.query('COMMIT');
    return res.json({ updated: items.length });
  } catch (e) {
    await client.query('ROLLBACK');
    return next(e);
  } finally {
    client.release();
  }
});

export default router;
