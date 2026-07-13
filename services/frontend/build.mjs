// Сборка фронтенда: esbuild бандлит+минифицирует JS/CSS с content-hash в имени,
// затем переписывает ссылки в HTML на хешированные файлы (заменяет ручной ?v=).
//
// Источники — в src/, результат — в dist/ (его раздаёт nginx).
import * as esbuild from 'esbuild';
import { readdir, readFile, writeFile, mkdir, rm, cp } from 'node:fs/promises';
import path from 'node:path';

const SRC = 'src';
const OUT = 'dist';

// Точки входа, которые бандлятся и хешируются
const JS_ENTRIES = ['app.js', 'widget.js'];
const CSS_ENTRIES = ['tokens.css', 'style.css', 'patch.css', 'widget.css'];

// Внутренние файлы, которые НЕ должны попадать в публичный dist (раздаётся nginx
// без авторизации): макет журнала записей preview.html и т.п.
const EXCLUDE_FROM_DIST = new Set(['preview.html']);

// Экранирование строки для использования внутри RegExp (все спецсимволы, не только точка).
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const result = await esbuild.build({
  entryPoints: [
    ...JS_ENTRIES.map((f) => path.join(SRC, f)),
    ...CSS_ENTRIES.map((f) => path.join(SRC, f)),
  ],
  bundle: true,
  minify: true,
  sourcemap: true,
  format: 'iife',
  target: ['es2020'],
  entryNames: '[name].[hash]',
  outdir: OUT,
  metafile: true,
  logLevel: 'info',
});

// Карта: исходное имя (app.js) → хешированное (app.A1B2C3.js)
const map = {};
for (const [outPath, meta] of Object.entries(result.metafile.outputs)) {
  if (!meta.entryPoint) continue;
  const srcName = path.basename(meta.entryPoint);          // app.js
  const outName = path.basename(outPath);                   // app.XXXX.js
  map[srcName] = outName;
}

// Копируем HTML и прочие статические файлы (картинки, манифесты), переписываем ссылки
const entries = await readdir(SRC, { withFileTypes: true });
for (const e of entries) {
  if (!e.isFile()) continue;
  const name = e.name;
  if (JS_ENTRIES.includes(name) || CSS_ENTRIES.includes(name)) continue; // уже собраны
  if (EXCLUDE_FROM_DIST.has(name)) continue;                              // внутренние — не публикуем
  if (name.endsWith('.html')) {
    let html = await readFile(path.join(SRC, name), 'utf8');
    for (const [orig, hashed] of Object.entries(map)) {
      // /app.js, /app.js?v=..., /style.css?v=... → /app.<hash>.js
      const re = new RegExp(`/${escapeRe(orig)}(\\?[^"']*)?`, 'g');
      html = html.replace(re, `/${hashed}`);
    }
    await writeFile(path.join(OUT, name), html);
  } else {
    await cp(path.join(SRC, name), path.join(OUT, name));
  }
}

console.log('[build] done:', map);
