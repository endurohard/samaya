// Отправка составного ответа: текст, фото, текст.
//
// Direct не умеет подпись под вложением — каждое фото уходит отдельным
// сообщением, поэтому сценарий «объясни и покажи зоны» физически не
// помещается в одну строку ответа. Части приходят от ассистента списком
// (см. salon-service/src/ai/parts.ts), здесь они отправляются по порядку.
//
// Картинки лежат файлами рядом с сервисом (assets/), а не в БД: это
// постоянные схемы зон, одни и те же месяцами. Meta забирает вложение
// только по публичной ссылке, поэтому файл копируется в outbox и
// отдаётся подписанной ссылкой с коротким сроком — тем же механизмом,
// что и вложение, отправленное администратором из админки.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sendMessage, sendMediaMessage, uploadAttachment } from './graph.js';
import {
  saveOutgoingMedia, saveMessages, upsertThread,
  cachedAttachment, rememberAttachment, forgetAttachment,
} from './store.js';

const ASSETS_DIR = path.resolve(fileURLToPath(new URL('../assets', import.meta.url)));
// Картинки, загруженные администратором в админке, живут в salon-service:
// там же, где сам шаблон. Копировать их в образ каждого канала нельзя —
// добавленная через админку картинка иначе появилась бы только после выката.
const SALON_URL = process.env.SALON_SERVICE_URL || 'http://salon-service:3002';
const SALON_TOKEN = process.env.SALON_INTERNAL_TOKEN || process.env.INTERNAL_TOKEN || '';

// Пауза между сообщениями одной связки. Четыре сообщения подряд за
// миллисекунды Meta считает рассылкой, а клиент — ботом.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a));

const MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** Найти файл картинки по имени из шаблона. Расширение подбираем сами. */
function assetPath(name) {
  // Имя уже проверено разбором шаблона, но путь складывается из внешних
  // данных — проверяем ещё раз здесь: «../» увёл бы чтение за пределы
  // каталога картинок.
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(String(name || ''))) return null;
  for (const ext of Object.keys(MIME)) {
    const abs = path.join(ASSETS_DIR, name + ext);
    if (abs.startsWith(ASSETS_DIR) && fs.existsSync(abs)) return { abs, mime: MIME[ext] };
  }
  return null;
}

/**
 * Достать картинку: сначала из образа, потом из salon-service.
 *
 * Два источника, потому что это разные по природе файлы: схемы зон ног
 * версионируются вместе с кодом и обязаны работать на чистом сервере, а
 * картинки, добавленные администратором в админке, появляются между
 * выкатами и в образ попасть не могут.
 */
async function assetBytes(name) {
  const local = assetPath(name);
  if (local) {
    // mtime и размер входят в ключ кэша attachment_id: заменили схему —
    // ключ сменился, и клиент получит новую картинку, а не прошлую.
    const st = await fsp.stat(local.abs);
    return {
      buf: await fsp.readFile(local.abs),
      mime: local.mime,
      stamp: Math.round(st.mtimeMs),
    };
  }

  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(String(name || ''))) return null;
  const r = await fetch(`${SALON_URL}/api/salons/ai/asset/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${SALON_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) return null;
  const mime = String(r.headers.get('content-type') || '').split(';')[0].trim() || 'image/jpeg';
  const buf = Buffer.from(await r.arrayBuffer());
  // У картинки из админки mtime недоступен — различаем по ETag, а при его
  // отсутствии кэш для неё просто не переиспользуется (stamp = 0 стабилен,
  // но тогда ключ держится на размере, чего для правленой картинки мало).
  const tag = String(r.headers.get('etag') || r.headers.get('last-modified') || '').slice(0, 64);
  return { buf, mime, stamp: tag || 0 };
}

/**
 * Отправить одну картинку из assets.
 *
 * Файл уходит ТЕЛОМ запроса, а не ссылкой: ссылочный способ у подключения
 * через Instagram Login не работает вовсе (Meta отвечает «Upload failed»,
 * не присылая ни одного запроса за файлом).
 *
 * Схемы зон одни и те же месяцами, поэтому id загруженного вложения
 * кэшируется: связка из трёх сообщений тогда уходит без повторной
 * загрузки сотни килобайт на каждое фото. Ключ кэша включает размер и
 * mtime файла — заменили картинку, ключ сменился сам, и старый id не
 * подставится вместо новой схемы.
 */
async function sendAsset(threadId, name) {
  const found = await assetBytes(name);
  if (!found) return { ok: false, error: `картинка «${name}» не найдена` };

  const key = `${name}|${found.buf.length}|${found.stamp || 0}`;
  let attachmentId = await cachedAttachment(key).catch(() => null);

  if (!attachmentId) {
    const up = await uploadAttachment(found.buf, found.mime, `${name}.jpg`, 'image');
    if (!up.ok) return { ok: false, error: `загрузка картинки «${name}»: ${up.error}` };
    attachmentId = up.attachmentId;
    await rememberAttachment(key, attachmentId, 'image')
      .catch(e => console.warn('[IG][части] id вложения не закэширован:', e.message));
    console.log(`[IG][части] картинка «${name}» загружена в Meta (id ${attachmentId})`);
  }

  let r = await sendMediaMessage(threadId, { attachmentId }, 'image');

  // Закэшированный id Meta может перестать принимать (истёк на её
  // стороне). Это не повод терять сообщение: забываем id и отправляем
  // файл телом — следующий вызов загрузит его заново.
  if (!r.ok && /attachment|upload|invalid/i.test(r.error || '')) {
    console.warn(`[IG][части] id вложения «${name}» отвергнут (${r.error}) — отправляю файлом`);
    await forgetAttachment(key).catch(() => {});
    r = await sendMediaMessage(threadId,
      { buf: found.buf, mime: found.mime, name: `${name}.jpg` }, 'image');
  }
  if (!r.ok) return r;

  // Файл кладём на диск, чтобы он был виден в переписке админки:
  // отправленное вложение должно остаться в истории, как и входящее.
  const saved = await saveOutgoingMedia(found.buf, found.mime);
  return { ok: true, messageId: r.messageId, saved };
}

/**
 * Отправить части ответа по порядку.
 *
 * Останавливается на первой неудаче и возвращает, сколько успело уйти:
 * продолжать после обрыва нельзя — клиент получит текст «выше показали 7
 * зон» без самих фотографий, то есть бессмыслицу.
 */
export async function sendParts(threadId, parts, clientId) {
  let sent = 0;
  for (const p of parts) {
    if (sent) await sleep(rnd(1500, 3500));

    if (p.type === 'text') {
      const r = await sendMessage(threadId, p.text);
      if (!r.ok) return { ok: false, sent, error: r.error };
      await saveMessages(threadId, [{
        from_me: true, body: p.text, stamp: new Date().toISOString(),
      }], clientId).catch(e => console.warn('[IG][части] запись текста:', e.message));
      sent++;
      continue;
    }

    if (p.type === 'image') {
      const r = await sendAsset(threadId, p.asset);
      if (!r.ok) return { ok: false, sent, error: r.error };
      await saveMessages(threadId, [{
        from_me: true, body: '', stamp: new Date().toISOString(),
        has_media: true, media_kind: 'image',
        // Файл уже у нас — перекачивать его из Meta незачем.
        local_media: { rel: r.saved.rel, mime: r.saved.mime, size: r.saved.size },
      }], clientId).catch(e => console.warn('[IG][части] запись фото:', e.message));
      sent++;
      continue;
    }
  }
  return { ok: true, sent };
}

/** Убедиться, что диалог есть в базе, и получить client_id для записи. */
export async function threadClientId(threadId) {
  return upsertThread({
    thread_id: threadId, unread: 0, last_body: '[вложение]', last_at: new Date(),
  });
}
