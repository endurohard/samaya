// Ручная кампания в Direct: администратор отобрал получателей галочками,
// написал текст — мы отправляем по одному с человеческими паузами.
//
// ПОЧЕМУ ЭТО НЕ «РАССЫЛКА» КАК В WHATSAPP. Instagram к массовым сообщениям
// заметно жёстче: там нет понятия «рассылка», есть личная переписка, и серия
// однотипных сообщений незнакомым людям — прямой путь к чекпоинту или
// блокировке аккаунта. Поэтому здесь:
//
//   * список формируется ВРУЧНУЮ, автоотбора «всем подходящим» нет;
//   * дневной лимит по умолчанию 30, а не сотни;
//   * паузы между сообщениями минутные, а не секундные;
//   * отправка только в рабочие часы;
//   * серия ошибок подряд останавливает кампанию целиком.
//
// Отдельный момент — окно 24 часов. Direct разрешает писать первым только
// тем, кто сам обращался недавно; старым диалогам Meta может отказать. Это
// нормально и не повод останавливать кампанию: такие получатели помечаются
// отдельной причиной, а не считаются сбоем.
import { upsertThread, saveMessages, alreadySent, markAuthor, authorName } from './store.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a));

// Темпы. Числа заметно осторожнее whatsapp-рассылки — см. причину выше.
export const PACES = {
  safe:   { label: 'осторожный', minDelayMs: 180_000, maxDelayMs: 420_000, dailyLimit: 15, batchSize: 5,  batchPauseMinMs: 40 * 60_000, batchPauseMaxMs: 90 * 60_000 },
  normal: { label: 'обычный',    minDelayMs: 90_000,  maxDelayMs: 240_000, dailyLimit: 30, batchSize: 8,  batchPauseMinMs: 25 * 60_000, batchPauseMaxMs: 60 * 60_000 },
  brisk:  { label: 'ускоренный', minDelayMs: 45_000,  maxDelayMs: 120_000, dailyLimit: 50, batchSize: 10, batchPauseMinMs: 15 * 60_000, batchPauseMaxMs: 35 * 60_000 },
};

// Рабочее окно по Москве: сообщение о скидке в три часа ночи и выглядит
// машинно, и раздражает получателя.
const HOUR_FROM = Number(process.env.INSTAGRAM_CAMPAIGN_HOUR_FROM || 10);
const HOUR_TO = Number(process.env.INSTAGRAM_CAMPAIGN_HOUR_TO || 20);

function mskHour(d = new Date()) {
  return Number(new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow', hour: 'numeric', hour12: false,
  }).format(d));
}

function msUntilWorkingHours() {
  const h = mskHour();
  if (h >= HOUR_FROM && h < HOUR_TO) return 0;
  // До открытия — ждём начала часа HOUR_FROM; после закрытия — утра.
  const hoursAhead = h < HOUR_FROM ? (HOUR_FROM - h) : (24 - h + HOUR_FROM);
  return hoursAhead * 3_600_000 + rnd(0, 20 * 60_000);
}

export class Campaign {
  constructor(ig, sendViaApi) {
    this.ig = ig;
    // Отправка через официальный API, если токен есть: она не трогает
    // браузерный сеанс и не создаёт нагрузки, которую Instagram считает
    // подозрительной. Браузер — запасной путь.
    this.sendViaApi = sendViaApi;
    this.state = this._idle();
    this.abort = false;
  }

  _idle() {
    return {
      running: false, total: 0, sent: 0, skipped: 0,
      failed: [], started_at: null, finished_at: null,
      paused_until: null, pause_reason: null, stopped_reason: null,
      pace: null, message: null,
    };
  }

  status() { return { ...this.state, failed: this.state.failed.slice(-20) }; }

  stop() {
    if (!this.state.running) return { ok: false, error: 'кампания не запущена' };
    this.abort = true;
    return { ok: true };
  }

  /**
   * recipients: [{thread_id, username}]
   * message: текст; {name} подставляется ником получателя.
   */
  start(recipients, message, paceKey, author) {
    if (this.state.running) return { ok: false, error: 'кампания уже идёт' };
    const list = (recipients || []).filter(r => r?.thread_id);
    if (!list.length) return { ok: false, error: 'не выбран ни один получатель' };
    const text = String(message || '').trim();
    if (!text) return { ok: false, error: 'пустое сообщение' };

    const pace = PACES[paceKey] || PACES.normal;
    this.abort = false;
    this.state = {
      ...this._idle(),
      running: true, total: list.length,
      started_at: new Date().toISOString(),
      pace: paceKey in PACES ? paceKey : 'normal',
      message: text,
    };
    this._run(list, text, pace, author).catch(e => {
      console.error('[IG][кампания] fatal:', e.message);
      this.state.running = false;
      this.state.stopped_reason = e.message;
      this.state.finished_at = new Date().toISOString();
    });

    const perMsg = (pace.minDelayMs + pace.maxDelayMs) / 2;
    return {
      ok: true, accepted: true, total: list.length,
      pace: this.state.pace, daily_limit: pace.dailyLimit,
      est_days: Math.ceil(list.length / pace.dailyLimit),
      avg_delay_sec: Math.round(perMsg / 1000),
    };
  }

  async _run(list, text, pace, author) {
    console.log(`[IG][кампания] старт: получателей ${list.length}, темп ${pace.label}, `
      + `пауза ${Math.round(pace.minDelayMs / 60000)}–${Math.round(pace.maxDelayMs / 60000)} мин, `
      + `лимит/сутки ${pace.dailyLimit}`);

    let sentToday = 0;
    let day = new Date().toDateString();
    let failStreak = 0;

    for (let i = 0; i < list.length; i++) {
      if (this.abort) { this.state.stopped_reason = 'остановлено вручную'; break; }

      // Сутки сменились — счётчик дневного лимита обнуляем.
      const nowDay = new Date().toDateString();
      if (nowDay !== day) { day = nowDay; sentToday = 0; }

      if (sentToday >= pace.dailyLimit) {
        const wait = msUntilWorkingHours() || 8 * 3_600_000;
        this.state.pause_reason = `дневной лимит ${pace.dailyLimit} исчерпан`;
        this.state.paused_until = new Date(Date.now() + wait).toISOString();
        console.log(`[IG][кампания] дневной лимит, пауза до ${this.state.paused_until}`);
        await this._waitAbortable(wait);
        if (this.abort) { this.state.stopped_reason = 'остановлено вручную'; break; }
        sentToday = 0;
        day = new Date().toDateString();
      }

      const offHours = msUntilWorkingHours();
      if (offHours > 0) {
        this.state.pause_reason = `нерабочее время (отправляем ${HOUR_FROM}:00–${HOUR_TO}:00 МСК)`;
        this.state.paused_until = new Date(Date.now() + offHours).toISOString();
        await this._waitAbortable(offHours);
        if (this.abort) { this.state.stopped_reason = 'остановлено вручную'; break; }
      }

      this.state.pause_reason = null;
      this.state.paused_until = null;

      const r = list[i];
      const body = text.replace(/\{name\}/g, r.username ? `@${r.username}` : '').trim();

      try {
        // Повтор не отправляем: кампанию могли перезапустить после обрыва.
        if (await alreadySent(r.thread_id, body)) {
          this.state.skipped++;
          console.log(`[IG][кампания] ${r.username || r.thread_id}: уже отправляли, пропуск`);
          continue;
        }

        let ok = false;
        let via = 'graph_api';
        const api = await this.sendViaApi(r.thread_id, body);
        if (api?.ok) {
          ok = true;
        } else {
          // Окно 24 часов и прочие отказы API — не сбой кампании: такому
          // получателю просто нельзя написать первым. Помечаем и идём дальше.
          const noToken = /токен Instagram не сохранён|не записан id аккаунта/.test(api?.error || '');
          if (!noToken) {
            this.state.failed.push({ thread_id: r.thread_id, username: r.username, error: api?.error || 'отказ API' });
            this.state.skipped++;
            console.warn(`[IG][кампания] ${r.username || r.thread_id}: ${api?.error}`);
            await this._waitAbortable(rnd(5000, 15_000));
            continue;
          }
          const res = await this.ig.sendToThread(r.thread_id, body);
          ok = !!res?.ok;
          via = 'browser';
        }

        if (!ok) throw new Error('отправка не подтверждена');

        this.state.sent++;
        sentToday++;
        failStreak = 0;

        // Пишем в историю сразу: иначе администратор не увидит отправленное
        // до следующего обхода монитора, а это четверть часа.
        try {
          const clientId = await upsertThread({
            thread_id: r.thread_id, unread: 0, last_body: body, last_at: new Date(),
          });
          await saveMessages(r.thread_id, [{
            from_me: true, body, stamp: new Date().toISOString(),
          }], clientId);
          if (author?.id) {
            await markAuthor(r.thread_id, body, { id: author.id, name: await authorName(author.id) });
          }
        } catch (e) {
          console.error('[IG][кампания] запись в историю не удалась:', e.message);
        }

        console.log(`[IG][кампания] ${this.state.sent}/${list.length} → ${r.username || r.thread_id} (${via})`);
      } catch (e) {
        failStreak++;
        this.state.failed.push({ thread_id: r.thread_id, username: r.username, error: e.message });
        console.error(`[IG][кампания] ${r.username || r.thread_id}: ${e.message}`);

        // Серия ошибок подряд — признак, что аккаунт упёрся в ограничение
        // (чекпоинт, бан отправки). Продолжать здесь значит усугублять:
        // останавливаемся и ждём человека.
        if (failStreak >= 3) {
          this.state.stopped_reason = `остановлено: ${failStreak} ошибки подряд — проверьте аккаунт Instagram`;
          console.error('[IG][кампания] ' + this.state.stopped_reason);
          break;
        }
      }

      // Длинный перерыв после пачки.
      const done = this.state.sent + this.state.skipped;
      if (done > 0 && done % pace.batchSize === 0 && i < list.length - 1) {
        const pause = rnd(pace.batchPauseMinMs, pace.batchPauseMaxMs);
        this.state.pause_reason = `перерыв после ${pace.batchSize} сообщений`;
        this.state.paused_until = new Date(Date.now() + pause).toISOString();
        console.log(`[IG][кампания] перерыв ${Math.round(pause / 60000)} мин`);
        await this._waitAbortable(pause);
        continue;
      }

      if (i < list.length - 1) {
        await this._waitAbortable(rnd(pace.minDelayMs, pace.maxDelayMs));
      }
    }

    this.state.running = false;
    this.state.finished_at = new Date().toISOString();
    this.state.paused_until = null;
    this.state.pause_reason = null;
    console.log(`[IG][кампания] завершено: отправлено ${this.state.sent}, `
      + `пропущено ${this.state.skipped}, ошибок ${this.state.failed.length}`);
  }

  // Ожидание, прерываемое кнопкой «Стоп»: иначе остановка кампании на
  // часовом перерыве не сработала бы до его конца.
  async _waitAbortable(ms) {
    const step = 2000;
    let left = ms;
    while (left > 0 && !this.abort) {
      await sleep(Math.min(step, left));
      left -= step;
    }
  }
}
