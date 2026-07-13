import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { pool } from './db';
import { config } from './config';

const log = pino({ level: config.LOG_LEVEL });

const EXT_BY_MIME: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

// Лимит одновременных перекодировок и таймаут одной задачи. Контейнер ограничен
// (mem_limit 1g / cpus 1) — несколько параллельных ffmpeg над 4K-роликами уронят
// его OOM-ом, а зависший вход без таймаута держит ресурсы бесконечно.
const MAX_CONCURRENT = Math.max(1, Number(process.env.TRANSCODE_CONCURRENCY || 1));
const TRANSCODE_TIMEOUT_MS = Math.max(60_000, Number(process.env.TRANSCODE_TIMEOUT_MS || 600_000));

let activeCount = 0;
let jobSeq = 0;
const queue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function releaseSlot(): void {
  const next = queue.shift();
  if (next) next(); // слот передаётся следующей задаче, activeCount не меняется
  else activeCount--;
}

// Конвертация в веб-совместимый MP4: H.264 + AAC, faststart (прогрессивная загрузка),
// ширина ≤ 1280 (перекодируем чётную высоту). preset veryfast — щадим CPU.
function runFfmpeg(input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-i', input,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23',
      // 8-bit 4:2:0 обязателен: iPhone HDR/Dolby Vision снимает 10-bit HEVC, иначе на
      // выходе получился бы 10-bit H.264, который не играет в браузерах. format+pix_fmt
      // форсируют 8-бит (libx264 сам приведёт 10→8). Универсальная совместимость важнее
      // точной HDR-передачи; tonemap не используем — требует libzimg, не всегда собран.
      '-vf', "scale='min(1280,iw)':-2,format=yuv420p",
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', output,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      ff.kill('SIGKILL');
      reject(new Error(`ffmpeg timeout ${TRANSCODE_TIMEOUT_MS}ms`));
    }, TRANSCODE_TIMEOUT_MS);
    ff.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-8000); });
    ff.on('error', (err) => { if (settled) return; settled = true; clearTimeout(timer); reject(err); });
    ff.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-400)}`));
    });
  });
}

// Удаляем все файлы услуги, кроме keepFile (чистим оригинал/старые расширения/tmp).
function cleanupServiceMedia(dir: string, serviceId: string, keepFile: string): void {
  let files: string[] = [];
  try { files = fs.readdirSync(dir); } catch { return; }
  for (const f of files) {
    if (f.startsWith(`${serviceId}.`) && f !== keepFile) {
      fs.unlink(path.join(dir, f), () => {});
    }
  }
}

// Фоновая конвертация загруженного ролика. origRel — путь оригинала относительно MEDIA_DIR.
// По завершении обновляет БД: при успехе публикует mp4 (ready), при ошибке оставляет
// оригинал как есть (failed) — чтобы ссылка всё равно работала.
export async function transcodeServiceVideo(
  companyId: string, serviceId: string, origRel: string, origMime: string,
): Promise<void> {
  const dir = path.join(config.MEDIA_DIR, 'services');
  const origAbs = path.join(config.MEDIA_DIR, origRel);
  const outRel = `services/${serviceId}.mp4`;
  const outName = `${serviceId}.mp4`;
  // Уникальный tmp на задачу — две параллельные загрузки одной услуги не пишут в
  // один и тот же временный файл. Не начинается с `${serviceId}.`, поэтому
  // cleanupServiceMedia (по префиксу) чужой tmp не удалит.
  const jobId = ++jobSeq;
  const tmpAbs = path.join(config.MEDIA_DIR, `services/.tmp-${serviceId}-${jobId}.mp4`);
  const outAbs = path.join(config.MEDIA_DIR, outRel);

  // Ограничиваем параллелизм — ждём свободный слот.
  await acquireSlot();
  try {
    await runFfmpeg(origAbs, tmpAbs);
    // Атомарная подмена, чтобы nginx не отдал полуготовый файл.
    fs.renameSync(tmpAbs, outAbs);
    await pool.query(
      `UPDATE salons.services
         SET video_path = $3, video_mime = 'video/mp4', preview_enabled = TRUE,
             video_status = 'ready', updated_at = NOW()
       WHERE company_id = $1 AND id = $2`,
      [companyId, serviceId, outRel],
    );
    cleanupServiceMedia(dir, serviceId, outName); // убрать оригинал/старые
    log.info({ serviceId }, '[transcode] ready');
  } catch (e) {
    fs.unlink(tmpAbs, () => {});
    // Fallback: публикуем оригинал как есть (переименовываем из .orig.<ext>).
    const ext = EXT_BY_MIME[origMime] ?? 'bin';
    const fbName = `${serviceId}.${ext}`;
    const fbRel = `services/${fbName}`;
    const fbAbs = path.join(config.MEDIA_DIR, fbRel);
    try {
      if (origAbs !== fbAbs) fs.renameSync(origAbs, fbAbs);
      await pool.query(
        `UPDATE salons.services
           SET video_path = $3, video_mime = $4, preview_enabled = TRUE,
               video_status = 'failed', updated_at = NOW()
         WHERE company_id = $1 AND id = $2`,
        [companyId, serviceId, fbRel, origMime],
      );
      cleanupServiceMedia(dir, serviceId, fbName);
    } catch (e2) {
      await pool.query(
        `UPDATE salons.services SET video_status = 'failed', updated_at = NOW()
         WHERE company_id = $1 AND id = $2`,
        [companyId, serviceId],
      ).catch(() => {});
      log.error({ serviceId, err: (e2 as Error).message }, '[transcode] fallback failed');
    }
    log.warn({ serviceId, err: (e as Error).message }, '[transcode] failed, kept original');
  } finally {
    releaseSlot();
  }
}
