import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { HttpError, requirePermission } from '../middleware';
import { setEmployeeName, VatsError } from '../vats';
import { assignForDate, salonToday } from '../autoAssign';

const router = Router();

// Номера ВАТС с привязкой к сотрудникам. Отдаём все номера, включая
// непривязанные: администратору нужно видеть, что ещё осталось раздать.
router.get('/extensions', requirePermission('telephony.view'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT l.extension, l.master_id, l.vats_name, l.enabled, l.auto, l.updated_at,
              m.display_name AS master_name,
              (SELECT COUNT(*)::int FROM telephony.calls c
                WHERE c.company_id = l.company_id AND c.extension = l.extension) AS calls_count
         FROM telephony.extension_links l
         LEFT JOIN salons.masters m ON m.id = l.master_id
        WHERE l.company_id = $1
        ORDER BY l.extension`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

const linkSchema = z.object({
  master_id: z.string().uuid().nullable(),
});

// Привязка номера к сотруднику. Имя сразу уезжает в ВАТС: тогда оно приходит
// готовым во всех звонках и показывается на экранах телефонов, а в портале
// номера перестают быть безымянными.
router.put('/extensions/:ext', requirePermission('telephony.manage'), async (req, res, next) => {
  try {
    const companyId = req.auth!.company_id;
    const { master_id } = linkSchema.parse(req.body);

    const exists = await pool.query(
      'SELECT 1 FROM telephony.extension_links WHERE company_id = $1 AND extension = $2',
      [companyId, req.params.ext],
    );
    if (!exists.rowCount) throw new HttpError(404, 'NOT_FOUND', 'номер не найден в ВАТС');

    let name: string | null = null;
    if (master_id) {
      const m = await pool.query<{ display_name: string }>(
        'SELECT display_name FROM salons.masters WHERE company_id = $1 AND id = $2',
        [companyId, master_id],
      );
      if (!m.rows[0]) throw new HttpError(404, 'NOT_FOUND', 'сотрудник не найден');
      name = m.rows[0].display_name;
    }

    // Сначала ВАТС, потом своя база: если чужая сторона недоступна, привязка не
    // сохранится вовсе — иначе у нас сотрудник привязан, а на телефоне пусто, и
    // расхождение никто не заметит.
    let vatsWarning: string | null = null;
    if (name) {
      try {
        await setEmployeeName(req.params.ext, name);
      } catch (e) {
        if (e instanceof VatsError) throw new HttpError(502, 'VATS_UNAVAILABLE', 'ВАТС не приняла имя сотрудника');
        throw e;
      }
    } else {
      vatsWarning = 'имя в ВАТС оставлено прежним';
    }

    await pool.query(
      `UPDATE telephony.extension_links
          SET master_id = $3, vats_name = COALESCE($4, vats_name), updated_at = NOW()
        WHERE company_id = $1 AND extension = $2`,
      [companyId, req.params.ext, master_id, name],
    );

    // Привязка задним числом: звонки с этого номера уже лежат в журнале, и без
    // пересчёта они остались бы ничьими в отчётах по сотрудникам.
    const upd = await pool.query(
      `UPDATE telephony.calls SET master_id = $3
        WHERE company_id = $1 AND extension = $2 AND master_id IS DISTINCT FROM $3`,
      [companyId, req.params.ext, master_id],
    );

    return res.json({ extension: req.params.ext, master_id, name, calls_relinked: upd.rowCount, note: vatsWarning });
  } catch (e) { return next(e); }
});

// Переключение номера между ручной привязкой и раздачей по сменам.
// Ручной режим нужен для номеров, не связанных со сменой, — например 1004
// «Stacionar» у аппарата.
router.put('/extensions/:ext/auto', requirePermission('telephony.manage'), async (req, res, next) => {
  try {
    const { auto } = z.object({ auto: z.boolean() }).parse(req.body);
    const companyId = req.auth!.company_id;

    const upd = await pool.query(
      `UPDATE telephony.extension_links SET auto = $3, updated_at = NOW()
        WHERE company_id = $1 AND extension = $2`,
      [companyId, req.params.ext, auto],
    );
    if (!upd.rowCount) throw new HttpError(404, 'NOT_FOUND', 'Номер не найден');

    // Сразу раздаём: иначе номер до следующего прогона остался бы за тем, кто
    // был привязан вручную, и администратор решил бы, что режим не включился.
    const result = auto ? await assignForDate(companyId, salonToday(), req.log) : null;
    return res.json({ extension: req.params.ext, auto, assignment: result });
  } catch (e) { return next(e); }
});

// Ручной запуск раздачи: смену поправили и хотят увидеть результат сейчас,
// не дожидаясь очередной десятиминутной проверки.
router.post('/extensions/assign', requirePermission('telephony.manage'), async (req, res, next) => {
  try {
    const result = await assignForDate(req.auth!.company_id, salonToday(), req.log);
    return res.json(result);
  } catch (e) { return next(e); }
});

// Должности, участвующие в раздаче. На ресепшене сидят не все: косметологу
// внутренний номер ни к чему, звонки клиентов ушли бы в процедурный кабинет.
router.get('/extensions/positions', requirePermission('telephony.view'), async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT position FROM telephony.auto_assign_positions WHERE company_id = $1 ORDER BY position`,
      [req.auth!.company_id],
    );
    const all = await pool.query(
      `SELECT DISTINCT position FROM salons.masters
        WHERE company_id = $1 AND is_active AND NULLIF(TRIM(position), '') IS NOT NULL
        ORDER BY position`,
      [req.auth!.company_id],
    );
    return res.json({
      selected: rows.map((r) => r.position),
      available: all.rows.map((r) => r.position),
    });
  } catch (e) { return next(e); }
});

router.put('/extensions/positions', requirePermission('telephony.manage'), async (req, res, next) => {
  try {
    const { positions } = z.object({ positions: z.array(z.string()).max(20) }).parse(req.body);
    const companyId = req.auth!.company_id;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM telephony.auto_assign_positions WHERE company_id = $1', [companyId]);
      for (const p of positions) {
        await client.query(
          `INSERT INTO telephony.auto_assign_positions (company_id, position) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [companyId, p],
        );
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    // Состав раздачи изменился — пересчитываем сразу.
    const result = await assignForDate(companyId, salonToday(), req.log);
    return res.json({ positions, assignment: result });
  } catch (e) { return next(e); }
});

export default router;
