// Приём сообщений Direct через webhook и ответ по шаблонам.
//
// Поток: Meta шлёт уведомление → проверяем подпись → сохраняем в БД →
// спрашиваем у ассистента тему → отправляем готовый шаблон или оставляем
// черновик администратору.
//
// Классификацию делает salon-service, а не этот сервис: шаблоны и журнал
// живут там, и вторая копия логики разошлась бы с первой при первой же
// правке. Сюда возвращается уже готовое решение.
import { upsertThread, saveMessages, saveDraft, clearDraft, findClientByPhone, linkThreadToClient, threadHasName, threadUsername, channelSettings } from './store.js';
import { sendMessage, fetchProfile } from './graph.js';

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
      signal: AbortSignal.timeout(25_000),
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

/**
 * Обработать разобранные сообщения из одного уведомления.
 *
 * Возвращает краткую сводку — она уходит в лог, а не клиенту: Meta ждёт
 * от webhook только 200, и любая задержка здесь приводит к повторной
 * доставке того же события.
 */
export async function handleMessages(items) {
  const stats = { saved: 0, replied: 0, drafts: 0, skipped: 0 };

  // Режим обкатки берём из БД: владелец переключает его в админке, и
  // настройка должна действовать сразу, без перезапуска контейнера.
  // Одно чтение на пачку — внутри цикла это был бы запрос на сообщение.
  const { testMode, testUsers } = await channelSettings('instagram');

  for (const it of items) {
    // Ник собеседника: webhook его не присылает, только IGSID, и в списке
    // диалогов строка выглядит как «без имени». Запрашиваем профиль, но
    // ТОЛЬКО для входящих и только если ника ещё нет — иначе лишний вызов
    // к Meta на каждое сообщение в активной переписке.
    let profile = null;
    if (!it.fromMe && !(await threadHasName(it.threadId))) {
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
    if (!it.text) {
      await saveDraft(it.threadId, null, false);
      stats.drafts++;
      continue;
    }

    // Ник передаём обязательно: без него уведомление менеджеру приходит
    // с голым идентификатором вида #1444632931106388, по которому нельзя
    // понять, кто написал, и приходится искать диалог в CRM вручную.
    const who = profile?.username || await threadUsername(it.threadId);
    const d = await askAssistant(it.text, it.threadId, who ? '@' + who : null);
    if (!d.ok) {
      console.warn(`[IG][ии] ${it.threadId}: ${d.reason}`);
      stats.drafts++;
      continue;
    }

    if (d.action === 'skipped') { stats.skipped++; continue; }

    if (d.action !== 'sent' || !AUTOREPLY) {
      if (d.reply) await saveDraft(it.threadId, d.reply, d.action === 'sent');
      stats.drafts++;
      continue;
    }

    // Пауза перед автоответом: мгновенная реплика через секунду после
    // входящего читается как бот и клиентом, и антифродом Meta.
    await sleep(rnd(4000, 12_000));
    const sent = await sendMessage(it.threadId, d.reply);
    if (sent.ok) {
      await clearDraft(it.threadId);
      await saveMessages(it.threadId, [{
        from_me: true, body: d.reply, stamp: new Date().toISOString(),
      }], clientId);
      stats.replied++;
      console.log(`[IG][ии] автоответ отправлен в ${it.threadId} (тема ${d.topic})`);
    } else {
      // Не ушло — оставляем черновиком, иначе ответ просто потеряется.
      await saveDraft(it.threadId, d.reply, true);
      stats.drafts++;
      console.warn(`[IG][ии] автоответ не ушёл в ${it.threadId}: ${sent.error}`);
    }
  }

  return stats;
}

export function autoreplyEnabled() {
  return AUTOREPLY;
}
