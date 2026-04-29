import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { config } from '../config';
import { HttpError } from '../middleware';
import { toCompanyTime } from '../services';

const router = Router();

const slotsSchema = z.object({
  company_id: z.string().uuid().optional(),
  master_id: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  service_ids: z.string().min(1), // CSV: "id1,id2"
});

router.get('/', async (req, res, next) => {
  try {
    const q = slotsSchema.parse(req.query);
    const companyId = q.company_id ?? config.DEFAULT_COMPANY_ID;
    if (!companyId) throw new HttpError(400, 'company_id required (no default configured)');

    const serviceIds = q.service_ids.split(',').map((s) => s.trim()).filter(Boolean);
    if (serviceIds.length === 0) {
      throw new HttpError(400, 'service_ids required', 'NO_SERVICES');
    }

    // 1. Услуги (для подсчёта общей длительности)
    const svcRes = await pool.query(
      `SELECT id, duration_minutes FROM salons.services
       WHERE company_id = $1 AND id = ANY($2::uuid[]) AND is_active = TRUE`,
      [companyId, serviceIds],
    );
    if (svcRes.rows.length !== serviceIds.length) {
      throw new HttpError(400, 'some service ids invalid', 'INVALID_SERVICES');
    }
    const totalMinutes = svcRes.rows.reduce(
      (acc: number, r: { duration_minutes: number }) => acc + r.duration_minutes,
      0,
    );

    // 2. Расписание мастера на указанную дату
    const schedRes = await pool.query(
      `SELECT start_time::text AS start_time, end_time::text AS end_time, is_day_off
       FROM salons.master_schedules
       WHERE company_id = $1 AND master_id = $2 AND work_date = $3::date`,
      [companyId, q.master_id, q.date],
    );
    if (!schedRes.rows[0] || schedRes.rows[0].is_day_off) {
      return res.json({
        items: [],
        meta: { total_duration_minutes: totalMinutes, schedule: 'day_off_or_missing' },
      });
    }
    const sched = schedRes.rows[0] as { start_time: string; end_time: string };

    const dayStart = toCompanyTime(q.date, sched.start_time);
    const dayEnd = toCompanyTime(q.date, sched.end_time);

    // 3. Активные брони этого мастера, пересекающие день
    const bookRes = await pool.query(
      `SELECT starts_at, ends_at FROM bookings.bookings
       WHERE company_id = $1 AND master_id = $2
         AND status IN ('pending', 'confirmed')
         AND starts_at < $3 AND ends_at > $4`,
      [companyId, q.master_id, dayEnd.toISOString(), dayStart.toISOString()],
    );

    const stepMs = config.SLOT_STEP_MINUTES * 60_000;
    const durMs = totalMinutes * 60_000;
    const slots: Array<{ starts_at: string; ends_at: string }> = [];

    for (let t = dayStart.getTime(); t + durMs <= dayEnd.getTime(); t += stepMs) {
      const slotEnd = t + durMs;
      const overlaps = bookRes.rows.some((b: { starts_at: string; ends_at: string }) => {
        const bs = new Date(b.starts_at).getTime();
        const be = new Date(b.ends_at).getTime();
        return t < be && slotEnd > bs;
      });
      if (!overlaps) {
        slots.push({
          starts_at: new Date(t).toISOString(),
          ends_at: new Date(slotEnd).toISOString(),
        });
      }
    }

    return res.json({
      items: slots,
      meta: {
        total_duration_minutes: totalMinutes,
        step_minutes: config.SLOT_STEP_MINUTES,
        schedule: { start_time: sched.start_time, end_time: sched.end_time },
        booked_count: bookRes.rows.length,
      },
    });
  } catch (e) { return next(e); }
});

export default router;
