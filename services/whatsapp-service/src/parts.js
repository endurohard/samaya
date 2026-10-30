// Отправка составного ответа в WhatsApp: текст, фото, текст.
//
// Зачем отдельный модуль рядом с таким же в instagram-service: сама
// отправка у каналов разная. WhatsApp Web берёт файл С ДИСКА по пути, а
// Meta — только по публичной ссылке с подписью. Общий модуль пришлось бы
// параметризовать обоими способами ради двух строк — проще держать рядом
// с каналом, как и всю остальную логику отправки.
//
// Картинки лежат файлами в образе (assets/): это постоянные схемы зон,
// одни и те же месяцами, и они версионируются вместе с кодом.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ASSETS_DIR = path.resolve(fileURLToPath(new URL('../assets', import.meta.url)));
// Картинки, загруженные администратором в админке, живут в salon-service:
// там же, где сам шаблон. Копировать их в образ каждого канала нельзя —
// добавленная через админку картинка иначе появилась бы только после выката.
const SALON_URL = process.env.SALON_SERVICE_URL || 'http://salon-service:3002';
const SALON_TOKEN = process.env.SALON_INTERNAL_TOKEN || process.env.INTERNAL_TOKEN || '';
// Скачанные картинки кладём сюда: WhatsApp Web берёт файл с диска.
const CACHE_DIR = path.join(process.env.WHATSAPP_MEDIA_DIR || '/data/media', 'ai-templates');

// Пауза между сообщениями одной связки. Четыре сообщения подряд за
// миллисекунды WhatsApp считает рассылкой, а клиент — ботом.
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => Math.floor(a + Math.random() * (b - a));

const EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

/** Найти файл картинки по имени из шаблона. Расширение подбираем сами. */
export function assetPath(name) {
  // Имя приходит из шаблона, который правит владелец: путь складывается из
  // внешних данных, и «../» увёл бы чтение за пределы каталога картинок.
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(String(name || ''))) return null;
  for (const ext of EXTS) {
    const abs = path.join(ASSETS_DIR, name + ext);
    if (abs.startsWith(ASSETS_DIR) && fs.existsSync(abs)) return abs;
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
async function resolveAsset(name) {
  const local = assetPath(name);
  if (local) return local;

  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(String(name || ''))) return null;
  // Кеш на диске: один и тот же шаблон отправляют десятки раз в день, и
  // качать картинку заново на каждую отправку незачем.
  await fs.promises.mkdir(CACHE_DIR, { recursive: true });
  for (const ext of EXTS) {
    const cached = path.join(CACHE_DIR, name + ext);
    if (fs.existsSync(cached)) return cached;
  }

  const r = await fetch(`${SALON_URL}/api/salons/ai/asset/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${SALON_TOKEN}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!r.ok) return null;
  const mime = String(r.headers.get('content-type') || '').split(';')[0].trim();
  const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mime] || '.jpg';
  const abs = path.join(CACHE_DIR, name + ext);
  const buf = Buffer.from(await r.arrayBuffer());
  await fs.promises.writeFile(abs + '.tmp', buf);
  await fs.promises.rename(abs + '.tmp', abs);
  return abs;
}

/**
 * Отправить части ответа по порядку.
 *
 * Останавливается на первой неудаче и возвращает, сколько успело уйти:
 * продолжать после обрыва нельзя — клиент получит текст «выше показали 7
 * зон» без самих фотографий, то есть бессмыслицу.
 */
export async function sendParts(wa, phone, parts) {
  let sent = 0;
  for (const p of parts) {
    if (sent) await sleep(rnd(1500, 3500));
    try {
      if (p.type === 'text') {
        await wa.sendMessage(phone, p.text);
      } else if (p.type === 'image') {
        const abs = await resolveAsset(p.asset);
        if (!abs) return { ok: false, sent, error: `картинка «${p.asset}» не найдена` };
        // Подпись не передаём: тексты идут своими частями, а дубль подписи
        // под фото читался бы как повтор.
        await wa.sendMedia(phone, abs, '');
      } else {
        continue;
      }
      sent++;
    } catch (e) {
      return { ok: false, sent, error: e.message };
    }
  }
  return { ok: true, sent };
}
