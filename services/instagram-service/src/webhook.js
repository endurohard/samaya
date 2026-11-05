// Приём сообщений Direct через webhook и ответ по шаблонам.
//
// Поток: Meta шлёт уведомление → проверяем подпись → сохраняем в БД →
// ставим в очередь диалога → после паузы в переписке спрашиваем у
// ассистента ответ на всю пачку → отправляем готовый шаблон или оставляем
// черновик администратору.
//
// Классификацию делает salon-service, а не этот сервис: шаблоны и журнал
// живут там, и вторая копия логики разошлась бы с первой при первой же
// правке. Сюда возвращается уже готовое решение.
import { upsertThread, saveMessages, saveDraft, clearDraft, findClientByPhone, linkThreadToClient, threadHasName, threadUsername, channelSettings, markBot } from './store.js';
import { sendMessage, fetchProfile } from './graph.js';
import { sendParts } from './parts.js';
import { createThreadQueue, joinTexts } from './queue.js';

const SALON_URL = process.env.SALON_SERVICE_URL || 'http://salon-service:3002';
const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
// Автоответ по умолчанию выключен: клиника — медицинские услуги, и
// включение «бот отвечает сам» должно быть осознанным решением владельца,
// а не следствием выката. Даже при true отправляются только темы, у
// которых в шаблоне отдельно разрешена автоотправка.
const AUTOREPLY = process.env.INSTAGRAM_AUTOREPLY === 'true';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a));

// Телефон из текста — единственный автоматический способ связать диалог
// Instagram с карточкой клиента: у собеседника нет номера, он может
// написать его сам.
function phoneFrom(text) {
  const m = String(text || '').match(/(?:\+?7|8)[\s\-()]*\d{3}[\s\-()]*\d{3}[\s\-()]*\d{2}[\s\-()]*\d{2}/);
  if (!m) return null;
  let d = m[0].replace(/[^0-9]/g, '');
  if (d.length === 11 && d.startsWith('8')) d = '7' + d.slice(1);
  return d.length === 11 ? d : null;
}

/** Уведомить менеджера о вложении без текста. */
async function notifyMedia(threadId, clientName, kind) {
  try {
    const r = await fetch(`${SALON_URL}/api/salons/ai/notify-media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        thread_id: threadId, channel: 'instagram',
        client_name: clientName, kind: kind || 'media',
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn(`[IG] уведомление о вложении не ушло: HTTP ${r.status} ${t.slice(0, 120)}`);
    }
  } catch (e) {
    // Сбой уведомления не должен ронять обработку входящего: сообщение
    // и файл уже сохранены.
    console.warn('[IG] уведомление о вложении не ушло:', e.message);
  }
}

/**
 * Позвать человека, когда готовый ответ клиенту доставить не удалось.
 *
 * Черновик сам по себе — не доставка: он лежит в переписке, пока туда не
 * зайдут, а снимается первым же действием администратора и исчезает без
 * следа. Клиент в это время ждёт ответа, которого уже никогда не будет, и
 * узнать об этом по базе нельзя. Поэтому недоставленный ответ обязан
 * поднимать уведомление наружу, в Telegram.
 */
async function notifyUndelivered(threadId, clientName, reason, draft) {
  try {
    const r = await fetch(`${SALON_URL}/api/salons/ai/notify-media`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({
        thread_id: threadId, channel: 'instagram',
        client_name: clientName,
        kind: 'undelivered',
        reason, draft,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn(`[IG] уведомление о недоставке не ушло: HTTP ${r.status} ${t.slice(0, 120)}`);
    }
  } catch (e) {
    console.warn('[IG] уведомление о недоставке не ушло:', e.message);
  }
}

/** Спросить у ассистента, что ответить. */
async function askAssistant(text, threadId, clientName) {
  try {
    const r = await fetch(`${SALON_URL}/api/salons/ai/reply`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Внутренний токен: сервис ходит к сервису, пользовательского JWT
        // здесь нет и быть не может.
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({ text, thread_id: threadId, channel: 'instagram', client_name: clientName }),
      // 60 с, а не 25: классификатор при сетевом сбое делает до трёх
      // попыток (мост до TypeSafe моргает), и на это у него свой бюджет
      // в 50 с. Прежние 25 с обрывали запрос снаружи посреди второй
      // попытки — повтор не успевал дать результата, а клиент оставался
      // без ответа. Webhook от этого не страдает: Meta уже получила 200,
      // обработка идёт отдельно от ответа ей.
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { ok: false, reason: `ассистент ответил ${r.status}: ${body.slice(0, 160)}` };
    }
    return await r.json();
  } catch (e) {
    // Недоступность ассистента не должна приводить к молчанию: сообщение
    // уже сохранено, администратор увидит его в переписке.
    return { ok: false, reason: `ассистент недоступен: ${e.message}` };
  }
}

/** Подтвердить ассистенту, что вступление реально ушло клиенту. */
async function confirmIntro(threadId, introKey) {
  try {
    await fetch(`${SALON_URL}/api/salons/ai/intro-sent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${INTERNAL_TOKEN}`,
      },
      body: JSON.stringify({ thread_id: threadId, channel: 'instagram', intro_key: introKey }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    // Не подтвердили — вступление уйдёт второй раз на следующем сообщении
    // про ноги. Это неприятно, но лучше, чем не отправить вовсе.
    console.warn('[IG] отметка о вступлении не сохранена:', e.message);
  }
}

/**
 * Обработать разобранные сообщения из одного уведомления.
 *
 * Возвращает краткую сводку — она уходит в лог, а не клиенту: Meta ждёт
 * от webhook только 200, и любая задержка здесь приводит к повторной
 * доставке того же события.
 */
export async function handleMessages(items) {
  const stats = { saved: 0, queued: 0, drafts: 0, skipped: 0 };

  // Режим обкатки берём из БД: владелец переключает его в админке, и
  // настройка должна действовать сразу, без перезапуска контейнера.
  // Одно чтение на пачку — внутри цикла это был бы запрос на сообщение.
  const { testMode, testUsers } = await channelSettings('instagram');

  for (const it of items) {
    // Ник собеседника: webhook его не присылает, только IGSID, и в списке
    // диалогов строка выглядит как «без имени». Запрашиваем профиль, но
    // ТОЛЬКО если ника ещё нет — иначе лишний вызов к Meta на каждое
    // сообщение в активной переписке.
    //
    // Для исходящих запрашиваем тоже: администратор часто пишет первым из
    // приложения Instagram (ответ на сторис, комментарий), входящего в таком
    // диалоге ещё не было — и без этого он навсегда оставался «без имени».
    // threadId здесь всегда собеседник: у эха это recipient, см. parseWebhook.
    let profile = null;
    if (!(await threadHasName(it.threadId))) {
      profile = await fetchProfile(it.threadId);
      if (profile?.username) {
        console.log(`[IG] диалог ${it.threadId} = @${profile.username}`);
      }
    }

    // Эхо собственных сообщений сохраняем в историю, но не отвечаем:
    // иначе бот ответит сам себе, а при автоотправке — зациклится.
    const clientId = await upsertThread({
      thread_id: it.threadId,
      unread: it.fromMe ? 0 : 1,
      last_body: it.text || (it.mediaUrl ? '[вложение]' : null),
      last_at: it.at,
      username: profile?.username ?? null,
      full_name: profile?.fullName ?? null,
      avatar_url: profile?.avatarUrl ?? null,
    });

    const res = await saveMessages(it.threadId, [{
      from_me: it.fromMe,
      body: it.text,
      stamp: it.at.toISOString(),
      has_media: !!it.mediaUrl,
      media_kind: it.type,
      // Ссылка на файл: store скачает его сразу. Ссылки Meta живут часы,
      // поэтому отложенная загрузка «при открытии в админке» не работает.
      media_url: it.mediaUrl || null,
      // mid от Meta устойчив и уникален — он лучше вычисленного хеша,
      // но saveMessages считает ключ сам, поэтому передаём его в stamp.
    }], clientId);
    stats.saved += res.saved;

    if (it.fromMe) continue;
    // Повторная доставка того же события — штатное поведение Meta при
    // медленном ответе webhook. Если сообщение не новое, отвечать второй
    // раз нельзя.
    if (!res.saved) continue;

    // Режим обкатки: отвечаем только аккаунтам из белого списка.
    // Сообщение уже сохранено выше — администратор увидит переписку
    // целиком, просто ассистент в неё не вмешивается.
    if (testMode) {
      const who = (profile?.username || await threadUsername(it.threadId) || '').toLowerCase();
      if (!who || !testUsers.includes(who)) {
        stats.skipped += 1;
        console.log(`[IG] ${who ? '@' + who : it.threadId}: режим обкатки — ассистент не отвечает`);
        continue;
      }
    }

    // Связывание по номеру из текста.
    if (!clientId && it.text) {
      const digits = phoneFrom(it.text);
      if (digits) {
        const c = await findClientByPhone(digits);
        if (c) {
          await linkThreadToClient(it.threadId, c.id);
          console.log(`[IG] диалог ${it.threadId} связан с клиентом ${c.full_name}`);
        }
      }
    }

    // Вложение без текста классифицировать нечем — такое всегда человеку.
    // Но уведомить менеджера обязаны: иначе присланное фото зоны остаётся
    // незамеченным до тех пор, пока кто-нибудь не откроет CRM. Классификатор
    // не зовём (ему нечего разбирать), шлём уведомление напрямую.
    if (!it.text) {
      await saveDraft(it.threadId, null, false);
      stats.drafts++;
      const whoMedia = profile?.username || await threadUsername(it.threadId);
      void notifyMedia(it.threadId, whoMedia ? '@' + whoMedia : null, it.type);
      continue;
    }

    // Ник передаём обязательно: без него уведомление менеджеру приходит
    // с голым идентификатором вида #1444632931106388, по которому нельзя
    // понять, кто написал, и приходится искать диалог в CRM вручную.
    const who = profile?.username || await threadUsername(it.threadId);
    // Ответ готовится не сразу, а по пачке: клиент часто пишет несколькими
    // сообщениями подряд, и отвечать надо на всё написанное, а не на первую
    // реплику (см. queue.js).
    replyQueue.push(it.threadId, { text: it.text, who: who ? '@' + who : null, clientId });
    stats.queued++;
  }

  return stats;
}

// Пауза после ПОСЛЕДНЕГО сообщения клиента перед ответом. Заменяет прежнюю
// случайную паузу 4–12 с перед отправкой: мгновенный ответ по-прежнему не
// уходит, но теперь за время паузы собирается вся пачка, а не отправляется
// ответ на уже устаревшую реплику.
const REPLY_DELAY_MS = Number(process.env.INSTAGRAM_REPLY_DELAY_MS || 7000);
const REPLY_JITTER_MS = Number(process.env.INSTAGRAM_REPLY_JITTER_MS || 4000);

const replyQueue = createThreadQueue({
  delayMs: REPLY_DELAY_MS,
  jitterMs: REPLY_JITTER_MS,
  handle: answerBatch,
  onError: (e, threadId) => console.error(`[IG][ии] ${threadId}: ответ на пачку не собран:`, e.message),
});

/** Сколько диалогов ждут ответа ассистента (для /health). */
export function replyQueueSize() {
  return replyQueue.size();
}

/**
 * Ответить на пачку сообщений одного диалога.
 *
 * Вызывается очередью строго по одной пачке на диалог: следующая ждёт, пока
 * эта не отправлена и не записана, поэтому ассистент всегда видит актуальное
 * состояние опроса и уже доставленные ответы.
 */
async function answerBatch(threadId, batch) {
  const text = joinTexts(batch.map(b => b.text));
  if (!text) return;
  const last = batch[batch.length - 1];
  const { who, clientId } = last;
  if (batch.length > 1) console.log(`[IG][ии] ${threadId}: пачка из ${batch.length} сообщ.`);

  const d = await askAssistant(text, threadId, who);
  if (!d.ok) {
    console.warn(`[IG][ии] ${threadId}: ${d.reason}`);
    return;
  }

  if (d.action === 'skipped') return;

  // Вступление с фотографиями зон (круговая липосакция ног). Ассистент отдаёт
  // его только вместе с отправляемым ответом и только при autosend шаблона,
  // поэтому для черновика частей нет. Общий выключатель канала тоже уважаем:
  // при INSTAGRAM_AUTOREPLY=false сервис не пишет клиенту ничего.
  let introSent = false;
  if (AUTOREPLY && d.action === 'sent' && Array.isArray(d.reply_parts) && d.reply_parts.length) {
    const r = await sendParts(threadId, d.reply_parts, clientId);
    // Подпись «Ассистент» на текстах вступления: иначе salon-service примет
    // их за ручные сообщения менеджера и бот заглушит сам себя.
    for (const p of d.reply_parts.slice(0, r.sent)) {
      if (p.type === 'text') {
        await markBot(threadId, p.text).catch(e => console.warn('[IG][ии] подпись вступления:', e.message));
      }
    }
    if (r.sent) {
      // Отметку ставим только после фактической отправки: иначе при
      // отказе Meta диалог навсегда остался бы помеченным, и схемы зон
      // не ушли бы уже никогда.
      introSent = true;
      await confirmIntro(threadId, d.intro_key);
      console.log(`[IG][ии] вступление отправлено в ${threadId} (${r.sent} сообщ.)`);
    }
    if (!r.ok) {
      console.warn(`[IG][ии] вступление не ушло целиком в ${threadId}: ${r.error}`);
    }
  }

  if (d.action !== 'sent' || !AUTOREPLY) {
    if (d.reply) await saveDraft(threadId, d.reply, d.action === 'sent');
    return;
  }

  // Между вступлением и ответом — та же пауза, что внутри связки.
  if (introSent) await sleep(rnd(1500, 3500));
  const sent = await sendMessage(threadId, d.reply);
  if (sent.ok) {
    await clearDraft(threadId);
    await saveMessages(threadId, [{
      from_me: true, body: d.reply, stamp: new Date().toISOString(),
    }], clientId);
    await markBot(threadId, d.reply).catch(e => console.warn('[IG][ии] подпись ответа:', e.message));
    console.log(`[IG][ии] автоответ отправлен в ${threadId} (тема ${d.topic})`);
  } else {
    // Не ушло — оставляем черновиком, иначе ответ просто потеряется.
    // Но черновик видит только тот, кто откроет CRM, и снимается он без
    // следа — поэтому зовём человека наружу, в Telegram.
    await saveDraft(threadId, d.reply, true);
    console.warn(`[IG][ии] автоответ не ушёл в ${threadId}: ${sent.error}`);
    void notifyUndelivered(threadId, who, `ответ не доставлен: ${sent.error}`, d.reply);
  }
}

export function autoreplyEnabled() {
  return AUTOREPLY;
}
