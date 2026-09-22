// Раздача внутренних номеров по графику смен.
//
// Менеджеры работают посменно, а номер в ВАТС — ресурс постоянный. Держать
// жёсткую привязку «номер ↔ человек» значило бы переставлять её вручную
// каждое утро, иначе на телефоне клиента высвечивается фамилия того, кто
// сегодня выходной.
//
// Правило раздачи: номера идут по возрастанию, сотрудники — по времени начала
// смены. Кто раньше начал, тот получает меньший номер. При равном времени
// упорядочиваем по имени — иначе порядок между двумя сотрудниками с одинаковым
// началом смены менялся бы от запуска к запуску, и номер прыгал бы между ними.
import type { Logger } from 'pino';
import { pool } from './db';
import { setEmployeeName } from './vats';

export interface AssignResult {
  date: string;
  assigned: { extension: string; master_id: string | null; name: string }[];
  released: string[];
  vats_errors: string[];
}

// Кто сегодня на смене из тех, чья должность участвует в раздаче.
async function onShift(companyId: string, date: string) {
  const r = await pool.query<{ id: string; display_name: string }>(
    `SELECT m.id, m.display_name
       FROM salons.master_schedules s
       JOIN salons.masters m ON m.id = s.master_id
      WHERE s.company_id = $1
        AND s.work_date = $2
        AND NOT s.is_day_off
        AND m.is_active
        AND m.position IN (SELECT position FROM telephony.auto_assign_positions WHERE company_id = $1)
      ORDER BY s.start_time, m.display_name`,
    [companyId, date],
  );
  return r.rows;
}

// Номера, участвующие в автораздаче: помечены auto и включены.
async function autoExtensions(companyId: string) {
  const r = await pool.query<{ extension: string }>(
    `SELECT extension FROM telephony.extension_links
      WHERE company_id = $1 AND auto AND enabled
      ORDER BY extension`,
    [companyId],
  );
  return r.rows.map((x) => x.extension);
}

export async function assignForDate(companyId: string, date: string, log: Logger): Promise<AssignResult> {
  const staff = await onShift(companyId, date);
  const extensions = await autoExtensions(companyId);

  const assigned: AssignResult['assigned'] = [];
  const released: string[] = [];
  const vatsErrors: string[] = [];

  for (let i = 0; i < extensions.length; i++) {
    const ext = extensions[i];
    const person = staff[i] || null;

    // Имя в ВАТС: оно видно и на экране телефона, и в её интерфейсе. Для
    // свободного номера пишем сам номер, а не пустую строку — иначе на
    // телефоне остаётся фамилия вчерашней смены.
    const vatsName = person ? person.display_name : `Свободен ${ext}`;
    try {
      await setEmployeeName(ext, vatsName);
    } catch (e) {
      // ВАТС недоступна — привязку в своей базе всё равно сохраняем: журнал
      // звонков и отчёты по сотрудникам должны быть верными. Расхождение
      // с ВАТС попадёт в ответ, и его будет видно в интерфейсе.
      vatsErrors.push(`${ext}: ${(e as Error).message}`);
    }

    await pool.query(
      `UPDATE telephony.extension_links
          SET master_id = $3, vats_name = $4, updated_at = NOW()
        WHERE company_id = $1 AND extension = $2`,
      [companyId, ext, person?.id ?? null, vatsName],
    );

    // История: кто занимал номер в этот день. Нужна, чтобы звонки прошлых
    // смен не переезжали на нового владельца номера при пересменке.
    await pool.query(
      `INSERT INTO telephony.extension_assignments (company_id, extension, work_date, master_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (company_id, extension, work_date)
       DO UPDATE SET master_id = EXCLUDED.master_id`,
      [companyId, ext, date, person?.id ?? null],
    );

    // Звонки закрепляем только за этот день. Раньше пересчёт шёл по всему
    // журналу, и после пересменки вчерашние разговоры оказывались записаны
    // на сегодняшнего менеджера.
    await pool.query(
      `UPDATE telephony.calls SET master_id = $4
        WHERE company_id = $1 AND extension = $2
          AND started_at >= $3::date AND started_at < ($3::date + INTERVAL '1 day')
          AND master_id IS DISTINCT FROM $4`,
      [companyId, ext, date, person?.id ?? null],
    );

    if (person) assigned.push({ extension: ext, master_id: person.id, name: person.display_name });
    else released.push(ext);
  }

  log.info(
    { date, assigned: assigned.length, released: released.length, vats_errors: vatsErrors.length },
    '[auto-assign] номера разданы',
  );
  return { date, assigned, released, vats_errors: vatsErrors };
}

// Сегодняшняя дата в часовом поясе салона: раздача привязана к рабочему дню,
// и UTC-полночь сдвинула бы пересменку на три часа назад.
export function salonToday(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Moscow' });
}

// Раздача для всех компаний, у которых есть автономера.
export async function runAssignOnce(log: Logger): Promise<void> {
  try {
    const r = await pool.query<{ company_id: string }>(
      `SELECT DISTINCT company_id FROM telephony.extension_links WHERE auto AND enabled`,
    );
    const date = salonToday();
    for (const { company_id } of r.rows) {
      await assignForDate(company_id, date, log);
    }
  } catch (e) {
    // Раздача не должна ронять сервис: телефония продолжает принимать звонки
    // и писать журнал даже с устаревшей привязкой.
    log.error({ err: (e as Error).message }, '[auto-assign] сбой');
  }
}

// Проверяем раз в 10 минут, а не по расписанию в 9:00: смены редактируют
// в течение дня (заболел — вышел другой), и привязка должна догонять график,
// а не ждать следующего утра. Повторный прогон с тем же результатом ничего
// не меняет — UPDATE идёт по тем же значениям.
export function startAssignWorker(log: Logger): NodeJS.Timeout {
  void runAssignOnce(log);
  const timer = setInterval(() => void runAssignOnce(log), 10 * 60 * 1000);
  timer.unref();
  return timer;
}
