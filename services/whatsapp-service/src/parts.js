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
        const abs = assetPath(p.asset);
        if (!abs) return { ok: false, sent, error: `картинка «${p.asset}» не найдена в assets` };
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
