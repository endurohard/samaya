import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import { config } from './config';

const log = pino({ level: config.LOG_LEVEL });

// Карточке каталога хватает 1600px по ширине. Телефон отдаёт 4000px и 12–20 МБ —
// такое фото и в лимит не влезало, и грузило бы страницу услуг на десятки секунд.
const MAX_WIDTH = 1600;
const SHRINK_TIMEOUT_MS = 30_000;

// Параметры качества по контейнеру; расширение выбирает энкодер (mjpeg/png/libwebp).
const QUALITY_ARGS: Record<string, string[]> = {
  '.jpg': ['-q:v', '3'],
  '.jpeg': ['-q:v', '3'],
  '.png': ['-compression_level', '9'],
  '.webp': ['-quality', '82'],
};

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      ff.kill('SIGKILL');
      reject(new Error(`ffmpeg timeout ${SHRINK_TIMEOUT_MS}ms`));
    }, SHRINK_TIMEOUT_MS);
    ff.stderr.on('data', (d) => { stderr = (stderr + d.toString()).slice(-4000); });
    ff.on('error', (err) => { if (settled) return; settled = true; clearTimeout(timer); reject(err); });
    ff.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-300)}`));
    });
  });
}

// Ужимает фото до MAX_WIDTH по ширине, сохраняя формат. Заменяет файл на месте
// только если результат реально меньше исходника — иначе уже оптимизированная
// картинка после перекодирования стала бы тяжелее.
// Любая ошибка не фатальна: оставляем оригинал, загрузка всё равно считается удачной.
export async function shrinkImage(absPath: string): Promise<void> {
  const ext = path.extname(absPath).toLowerCase();
  const tmp = path.join(path.dirname(absPath), `.tmp-img-${path.basename(absPath)}`);
  try {
    const before = fs.statSync(absPath).size;
    await runFfmpeg([
      '-i', absPath,
      '-vf', `scale='min(${MAX_WIDTH},iw)':-1`,
      ...(QUALITY_ARGS[ext] ?? []),
      '-y', tmp,
    ]);
    const after = fs.statSync(tmp).size;
    if (after > 0 && after < before) {
      fs.renameSync(tmp, absPath);
      log.info({ file: path.basename(absPath), before, after }, '[image] shrunk');
    } else {
      fs.unlinkSync(tmp);
    }
  } catch (e) {
    fs.unlink(tmp, () => {});
    log.warn({ file: path.basename(absPath), err: (e as Error).message }, '[image] shrink skipped');
  }
}
