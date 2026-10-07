// Фоновый обход Direct: список диалогов → заход в изменившиеся → сохранение.
//
// Два цикла с разной ценой, как в whatsapp-service/monitor.js:
//
//   дозор  — только читает список диалогов. Instagram такое видит как обычное
//            нахождение в инбоксе, поэтому можно часто.
//   обход  — заходит внутрь диалогов. Это уже активность, и за частые заходы
//            подряд прилетает чекпоинт, поэтому редко и по одному диалогу за
//            проход, с человеческими паузами между ними.
//
// Правило, ради которого монитор вообще отдельный модуль: в диалог заходим
// только когда есть признак изменения (непрочитанное или новая подпись
// времени). Обход «всех подряд по кругу» — самый быстрый способ потерять
// аккаунт.
import { upsertThread, saveMessages, findClientByPhone, linkThreadToClient,
         listThreadMessages, saveDraft, clearDraft } from './store.js';
import { prepareReply } from './assistant.js';

const WATCH_MS = Number(process.env.INSTAGRAM_MONITOR_WATCH_MS || 20_000);
const FULL_MS = Number(process.env.INSTAGRAM_MONITOR_FULL_MS || 900_000);
const MAX_THREADS = Number(process.env.INSTAGRAM_MONITOR_THREADS || 10);
const DEPTH = Number(process.env.INSTAGRAM_MONITOR_DEPTH || 40);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a));

// Телефон из текста сообщения — единственный автоматический способ связать
// диалог Instagram с карточкой клиента: человек сам пишет «мой номер …».
// Ловим 11 цифр с любыми разделителями, 8 приводим к 7.
function phoneFrom(text) {
  const m = String(text || '').match(/(?:\+?7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/);
  if (!m) return null;
  let d = m[0].replace(/[^0-9]/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  return d.length === 11 ? d : null;
}

export class Monitor {
  constructor(ig) {
    this.ig = ig;
    this.watchIv = null;
    this.fullIv = null;
    this.running = false;
    this.lastWatch = null;
    this.lastFull = null;
    this.lastError = null;
    this.stats = { threads: 0, saved: 0, linked: 0, passes: 0, drafts: 0, autosent: 0 };
    // Отпечаток диалога на прошлом проходе: по нему понимаем, что внутри
    // что-то изменилось, и стоит ли туда заходить.
    this._seen = new Map();
  }

  status() {
    return {
      running: this.running,
      last_watch: this.lastWatch,
      last_full: this.lastFull,
      last_error: this.lastError,
      ...this.stats,
    };
  }

  start() {
    if (this.running) return this.status();
    this.running = true;
    // Первый дозор с задержкой: сразу после старта сеанс ещё догружается, и
    // обход по пустой странице только запишет мусор.
    setTimeout(() => this.watch().catch(() => {}), 15_000);
    this.watchIv = setInterval(() => this.watch().catch(() => {}), WATCH_MS);
    this.fullIv = setInterval(() => this.fullPass().catch(() => {}), FULL_MS);
    console.log(`[IG][монитор] запущен: дозор ${WATCH_MS} мс, обход ${FULL_MS} мс`);
    return this.status();
  }

  stop() {
    if (this.watchIv) clearInterval(this.watchIv);
    if (this.fullIv) clearInterval(this.fullIv);
    this.watchIv = null;
    this.fullIv = null;
    this.running = false;
    console.log('[IG][монитор] остановлен');
    return this.status();
  }

  /** Дозор: только список диалогов. Внутрь заходим лишь при изменении. */
  async watch() {
    if (!this.ig.getStatus().ready) return;
    try {
      const rows = await this.ig.listThreads();
      this.lastWatch = new Date().toISOString();
      this.stats.threads = rows.length;

      const changed = [];
      for (const t of rows) {
        await upsertThread({
          thread_id: t.thread_id,
          username: t.title && /^[A-Za-z0-9._]+$/.test(t.title) ? t.title : null,
          full_name: t.title || null,
          avatar: t.avatar,
          unread: t.unread,
          last_body: t.preview || null,
          last_at: null, // точное время берём из самого диалога при заходе
        });
        // Отпечаток: превью + относительное время + счётчик непрочитанных.
        const mark = `${t.unread}|${t.last_rel}|${t.preview}`;
        if (this._seen.get(t.thread_id) !== mark) {
          this._seen.set(t.thread_id, mark);
          // Непрочитанное — повод зайти всегда. Изменение превью без
          // непрочитанного значит, что ответил наш же администратор с
          // телефона: эту реплику тоже надо сохранить в историю.
          changed.push(t);
        }
      }

      // За один дозор заходим максимум в два диалога, даже если изменилось
      // больше: серия быстрых заходов подряд — заметный машинный признак.
      // Остальные подхватятся следующим проходом, задержка в секунды.
      for (const t of changed.slice(0, 2)) {
        await this._ingest(t.thread_id);
        await sleep(rnd(3000, 7000));
      }
      this.lastError = null;
    } catch (e) {
      this.lastError = e.message;
      console.error('[IG][дозор]', e.message);
    }
  }

  /** Полный обход: догоняем диалоги, которые дозор мог пропустить. */
  async fullPass() {
    if (!this.ig.getStatus().ready) return;
    try {
      const rows = (await this.ig.listThreads()).slice(0, MAX_THREADS);
      for (const t of rows) {
        await this._ingest(t.thread_id);
        // Пауза между диалогами обязательна и должна быть разной: ровный
        // интервал заходов виден в статистике Instagram лучше, чем частота.
        await sleep(rnd(4000, 11_000));
      }
      this.lastFull = new Date().toISOString();
      this.stats.passes++;
      this.lastError = null;
    } catch (e) {
      this.lastError = e.message;
      console.error('[IG][обход]', e.message);
    }
  }

  /** Прочитать один диалог и сохранить. */
  async _ingest(threadId) {
    const data = await this.ig.readThread(threadId, DEPTH);
    if (!data?.ok || !data.items?.length) return;

    const last = data.items[data.items.length - 1];
    const clientId = await upsertThread({
      thread_id: threadId,
      username: data.username,
      full_name: data.fullName,
      unread: 0, // зашли и прочитали — для Instagram диалог больше не новый
      last_body: last.body || (last.has_media ? '[вложение]' : null),
      last_at: new Date(),
    });

    const res = await saveMessages(threadId, data.items, clientId);
    this.stats.saved += res.saved;

    // Связывание по номеру: ищем телефон во ВХОДЯЩИХ сообщениях. В исходящих
    // его искать нельзя — администратор пишет туда номер клиники, и диалог
    // привязался бы к карточке самой клиники, если она заведена клиентом.
    if (!clientId && res.saved) {
      for (const it of data.items) {
        if (it.from_me) continue;
        const digits = phoneFrom(it.body);
        if (!digits) continue;
        const c = await findClientByPhone(digits);
        if (c) {
          await linkThreadToClient(threadId, c.id);
          this.stats.linked++;
          console.log(`[IG] диалог ${threadId} связан с клиентом ${c.full_name} по номеру из переписки`);
          break;
        }
      }
    }

    // Ответчик запускается только на НОВОЕ входящее, оказавшееся последним в
    // диалоге. Два условия, и оба обязательны:
    //  * res.saved — иначе при каждом обходе мы заново отвечали бы на одно и
    //    то же сообщение;
    //  * последнее сообщение входящее — если после него уже ответил живой
    //    администратор (с телефона), ответ не нужен, разговор ведёт человек.
    if (res.saved && !last.from_me) {
      await this._maybeReply(threadId);
    }
  }

  /** Подготовить ответ и, если разрешено, отправить. */
  async _maybeReply(threadId) {
    try {
      // Историю берём из БД, а не из только что прочитанного со страницы:
      // в базе уже слиты прошлые проходы, и контекст полнее на те реплики,
      // что не поместились в видимую часть диалога.
      const history = await listThreadMessages(threadId, 20);
      const r = await prepareReply(history);
      if (!r.ok) {
        if (r.reason !== 'ответчик выключен') {
          console.warn(`[IG][ии] диалог ${threadId}: ${r.reason}`);
        }
        return;
      }

      if (!r.autosend) {
        await saveDraft(threadId, r.draft, !!r.safe);
        this.stats.drafts++;
        console.log(`[IG][ии] черновик для ${threadId} (${r.reason || 'автоотправка выключена'})`);
        return;
      }

      // Пауза перед автоответом. Мгновенная реплика через секунду после
      // входящего читается как бот и клиентом, и антифродом Instagram.
      await sleep(rnd(8000, 20_000));
      const sent = await this.ig.sendToThread(threadId, r.draft);
      if (sent?.ok) {
        await clearDraft(threadId);
        this.stats.autosent++;
        console.log(`[IG][ии] автоответ отправлен в ${threadId}`);
        // Перечитываем диалог, чтобы наш ответ попал в историю сразу, а не
        // через четверть часа: иначе следующий проход сочтёт последнее
        // сообщение входящим и ответит второй раз.
        const after = await this.ig.readThread(threadId, 10);
        if (after?.items?.length) await saveMessages(threadId, after.items, null);
      } else {
        // Отправка не удалась — черновик всё равно сохраняем, иначе ответ
        // просто потеряется и клиент останется без реакции.
        await saveDraft(threadId, r.draft, !!r.safe);
        console.warn(`[IG][ии] автоответ не ушёл в ${threadId}, оставлен черновиком`);
      }
    } catch (e) {
      console.error(`[IG][ии] диалог ${threadId}:`, e.message);
    }
  }
}
