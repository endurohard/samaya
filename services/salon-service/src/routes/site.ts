// Публичный сайт-каталог услуг (SSR для SEO):
//   GET /api/salons/public/site/services        → «Услуги», секции по категориям
//   GET /api/salons/public/site/services/:slug  → страница услуги
// nginx фронта проксирует красивые URL /services и /services/:slug сюда,
// поэтому все ссылки в разметке — относительные /services/... и /media/...
// В каталог и меню попадают только услуги с show_in_menu = TRUE.
// Стиль — фирменные токены «Самая»: бордо #93494b, золото #b8894e,
// тёплый крем, Fraunces (display) + Golos Text (см. tokens.css).

import { Router, type Request } from 'express';
import { pool } from '../db';
import { config } from '../config';
import { HttpError } from '../middleware';
import { slugify } from '../slug';

const router = Router();

function getCompanyId(req: Request): string {
  const id = (req.query.company_id as string | undefined) ?? config.DEFAULT_COMPANY_ID;
  if (!id) throw new HttpError(400, 'company_id required (no default configured)');
  return id;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtPrice(v: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(v)} ₽`;
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60;
  return (h ? `${h} ч ` : '') + (m ? `${m} мин` : (h ? '' : `${min} мин`));
}

// Превью описания для карточки и meta description
function preview(text: string | null, max: number): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

interface MenuService {
  id: string; name: string; slug: string; description: string | null;
  price: number; duration_minutes: number; color: string | null;
  image_path: string | null; category_name: string | null;
  video_path: string | null; preview_enabled: boolean;
}

const NO_CATEGORY = 'Другие услуги';

async function menuServices(companyId: string): Promise<MenuService[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.name, s.slug, s.description, s.price::float8 AS price,
            s.duration_minutes, s.color, s.image_path,
            s.video_path, s.preview_enabled,
            c.name AS category_name
     FROM salons.services s
     LEFT JOIN salons.service_categories c ON c.id = s.category_id
     WHERE s.company_id = $1 AND s.is_active = TRUE
       AND s.show_in_menu = TRUE AND s.slug IS NOT NULL
     ORDER BY c.sort_order NULLS LAST, c.name NULLS LAST, s.name`,
    [companyId],
  );
  return rows;
}

// Категории в порядке появления; услуги без группы — в конец под общим именем.
// slug раздела детерминированно выводится из названия (отдельной колонки нет).
function groupByCategory(items: MenuService[]): Array<{ name: string; slug: string; items: MenuService[] }> {
  const map = new Map<string, MenuService[]>();
  for (const s of items) {
    const key = s.category_name || NO_CATEGORY;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  const groups = [...map.entries()].map(([name, list]) => ({
    name, slug: slugify(name) || 'other', items: list,
  }));
  groups.sort((a, b) => (a.name === NO_CATEGORY ? 1 : 0) - (b.name === NO_CATEGORY ? 1 : 0));
  return groups;
}

// Обёртка страницы: шапка, меню категорий, футер, фирменные токены.
function page(opts: {
  title: string;
  metaDescription: string;
  canonicalPath: string;
  menu: Array<{ label: string; href: string; active?: boolean }>;
  body: string;
}): string {
  // Выпадающий список разделов на details/summary: страницы каталога отдаются
  // сервером, а CSP запрещает инлайновые скрипты — раскрытие по клику должен
  // уметь сам HTML. Заодно работает с выключенным JS и с клавиатуры.
  const activeMenu = opts.menu.find((m) => m.active);
  const menuDropdown = opts.menu.length ? `
    <details class="cat-dd">
      <summary class="cat-dd-btn" aria-label="Разделы услуг">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke-linecap="round"/></svg>
        <span class="cat-dd-label">${esc(activeMenu ? activeMenu.label : 'Разделы')}</span>
        <svg class="cat-dd-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </summary>
      <div class="cat-dd-list">
        <a class="cat-dd-item${activeMenu ? '' : ' active'}" href="/services">Все услуги</a>
        ${opts.menu.map((m) =>
          `<a class="cat-dd-item${m.active ? ' active' : ''}" href="${esc(m.href)}">${esc(m.label)}</a>`,
        ).join('')}
      </div>
    </details>` : '';
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#93494b" />
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.metaDescription)}" />
  <link rel="canonical" href="${esc(config.FRONTEND_URL)}${esc(opts.canonicalPath)}" />
  <meta property="og:title" content="${esc(opts.title)}" />
  <meta property="og:description" content="${esc(opts.metaDescription)}" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700;800&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&display=swap" rel="stylesheet">
  <style>
    /* Фирменные токены «Самая» — встроены, т.к. tokens.css фронта собирается
       с content-hash в имени и по /tokens.css недоступен из SSR. */
    :root {
      --bg: #faf7f4; --bg-soft: #f4efe9; --card: #ffffff;
      --border: #ece4de; --border-strong: #ddd0c7;
      --text: #2a2320; --text-dim: #7a6f68; --text-muted: #a89b94;
      --primary: #93494b; --primary-hover: #7a3b3d; --primary-soft: #f4e9e9; --primary-dark: #5e2b2d;
      --accent-gold: #b8894e;
      --radius-md: 10px; --radius-lg: 16px; --radius-xl: 20px; --radius-pill: 999px;
      --shadow-sm: 0 1px 2px rgba(42, 32, 32, 0.05);
      --shadow-md: 0 10px 30px rgba(42, 32, 32, 0.10);
      --shadow-lg: 0 24px 60px rgba(42, 32, 32, 0.18);
      --shadow-brand: 0 8px 20px rgba(147, 73, 75, 0.28);
      --font-sans: 'Golos Text', system-ui, sans-serif;
      --font-display: 'Fraunces', Georgia, serif;
      --fs-xs: 12px; --fs-sm: 13.5px; --fs-md: 15px;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font-sans, 'Golos Text', sans-serif); background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; }
    a { color: inherit; }

    /* Без backdrop-filter: он делает шапку containing block для fixed-потомков,
       и слой, закрывающий список по клику мимо, растягивался лишь на её высоту.
       Фон сделан почти непрозрачным — на глаз разница с размытием незаметна. */
    header { background: rgba(255,255,255,0.97); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 20; }
    .header-inner { max-width: 1120px; margin: 0 auto; display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 24px; }
    .brand { display: flex; align-items: center; gap: 12px; text-decoration: none; }
    .brand img { width: 36px; height: 36px; border-radius: 10px; object-fit: cover; box-shadow: var(--shadow-sm); }
    .brand-name { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: 20px; letter-spacing: -0.01em; }
    .brand-sub { font-size: var(--fs-xs); color: var(--accent-gold); letter-spacing: 0.14em; text-transform: uppercase; display: block; margin-top: 1px; }
    .spacer { flex: 1; }
    .header-link { text-decoration: none; font-weight: 600; font-size: var(--fs-sm); color: var(--text-dim); padding: 8px 14px; border-radius: var(--radius-pill); transition: color 0.15s, background 0.15s; }
    .header-link:hover { color: var(--primary); background: var(--primary-soft); }

    /* Кнопка «Разделы» со списком. details/summary — раскрытие без скриптов,
       которые на этих страницах запрещены CSP. Кнопка нужна и на десктопе:
       на странице раздела она сразу показывает, где ты находишься. */
    .cat-dd { position: relative; }
    .cat-dd > summary {
      list-style: none;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
      padding: 8px 14px;
      border: 1px solid var(--border);
      border-radius: var(--radius-pill);
      background: var(--card);
      color: var(--text);
      font-size: var(--fs-sm);
      font-weight: 600;
      cursor: pointer;
      max-width: 60vw;
      transition: border-color .15s, color .15s, background .15s;
    }
    .cat-dd > summary::-webkit-details-marker { display: none; }
    .cat-dd > summary:hover { border-color: var(--primary); color: var(--primary); }
    .cat-dd > summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
    .cat-dd-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cat-dd-chev { flex: 0 0 auto; transition: transform .15s; }
    .cat-dd[open] > summary { border-color: var(--primary); color: var(--primary); }
    /* Клик мимо закрывает список. Скриптов на этих страницах нет (CSP), но
       раскрытый summary можно растянуть невидимым слоем на весь экран: клик по
       нему — это клик по самому summary, то есть закрытие. Слой лежит ниже
       списка, поэтому пункты остаются кликабельными. */
    .cat-dd[open] > summary::before {
      content: '';
      position: fixed;
      inset: 0;
      z-index: 30;
      cursor: default;
    }
    .cat-dd[open] .cat-dd-chev { transform: rotate(180deg); }
    .cat-dd-list {
      position: absolute;
      right: 0;
      top: calc(100% + 8px);
      min-width: 280px;
      max-width: min(360px, 90vw);
      max-height: min(70vh, 520px);
      overflow-y: auto;
      padding: 6px;
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg, 16px);
      box-shadow: 0 18px 44px rgba(42, 32, 32, .18);
      z-index: 40;
    }
    .cat-dd-item {
      display: block;
      padding: 11px 14px;
      border-radius: 10px;
      text-decoration: none;
      color: var(--text);
      font-size: var(--fs-sm);
      line-height: 1.3;
    }
    .cat-dd-item:hover { background: var(--primary-soft); color: var(--primary); }
    .cat-dd-item.active { background: var(--primary); color: #fff; font-weight: 600; }


    main { width: 100%; max-width: 1120px; margin: 0 auto; padding: 0 24px 56px; flex: 1; }

    .hero { padding: 48px 0 8px; }
    .overline { font-size: var(--fs-xs); font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: var(--accent-gold); }
    .hero h1 { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: clamp(32px, 5vw, 44px); letter-spacing: -0.015em; line-height: 1.1; margin-top: 10px; }
    .hero p { margin-top: 12px; color: var(--text-dim); font-size: var(--fs-md); max-width: 560px; line-height: 1.6; }

    .cat-section { margin-top: 40px; scroll-margin-top: 130px; }
    .cat-head { display: flex; align-items: baseline; gap: 12px; }
    .cat-head::before { content: ''; width: 26px; height: 3px; border-radius: 2px; background: var(--accent-gold); align-self: center; flex: 0 0 auto; }
    .cat-head h2 { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: 25px; letter-spacing: -0.01em; }
    .cat-head .count { color: var(--text-muted); font-size: var(--fs-sm); }
    .grid { margin-top: 18px; display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 20px; }

    .svc-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl); overflow: hidden; box-shadow: var(--shadow-sm); display: flex; flex-direction: column; text-decoration: none; transition: transform 0.18s, box-shadow 0.18s, border-color 0.18s; }
    .svc-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); border-color: var(--border-strong); }
    .svc-card .img { aspect-ratio: 4 / 3; overflow: hidden; position: relative; }
    .svc-card .img img { width: 100%; height: 100%; object-fit: cover; display: block; transition: transform 0.3s; }
    .svc-card:hover .img img { transform: scale(1.04); }
    .svc-card .ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); }
    .svc-card .ph span { font-family: var(--font-display, Fraunces, serif); font-size: 54px; font-weight: 500; color: rgba(255, 246, 240, 0.9); }
    .svc-card .ph::after { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 70% 20%, rgba(184, 137, 78, 0.25), transparent 55%); }
    .svc-card .body { padding: 18px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
    .svc-card .name { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: 18px; line-height: 1.3; letter-spacing: -0.01em; }
    .svc-card .prev { color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; flex: 1; }
    .svc-card .row { display: flex; align-items: center; gap: 10px; margin-top: 6px; padding-top: 12px; border-top: 1px solid var(--bg-soft); }
    .svc-card .price { font-weight: 700; font-size: var(--fs-md); color: var(--primary); }
    .svc-card .dur { font-size: var(--fs-xs); color: var(--text-muted); }
    .svc-card .more { margin-left: auto; font-size: var(--fs-sm); font-weight: 600; color: var(--accent-gold); white-space: nowrap; }
    .svc-card:hover .more { color: var(--primary); }
    .empty { margin: 64px 0; text-align: center; color: var(--text-dim); }

    /* Обзор направлений (корень каталога) */
    .cat-grid { margin-top: 26px; display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 20px; }
    .cat-card { position: relative; display: flex; flex-direction: column; justify-content: flex-end; min-height: 200px; border-radius: var(--radius-xl); overflow: hidden; text-decoration: none; border: 1px solid var(--border); box-shadow: var(--shadow-sm); transition: transform 0.18s, box-shadow 0.18s; }
    .cat-card:hover { transform: translateY(-4px); box-shadow: var(--shadow-lg); }
    .cat-card .bg { position: absolute; inset: 0; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); }
    .cat-card .bg img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .cat-card .bg::after { content: ''; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(46, 24, 25, 0) 30%, rgba(46, 24, 25, 0.78) 100%); }
    .cat-card .cc-body { position: relative; padding: 20px; }
    .cat-card .cc-name { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: 21px; color: #fff; line-height: 1.25; letter-spacing: -0.01em; }
    .cat-card .cc-meta { margin-top: 6px; display: flex; align-items: center; gap: 10px; }
    .cat-card .cc-count { font-size: var(--fs-sm); color: rgba(255, 246, 240, 0.85); }
    .cat-card .cc-more { margin-left: auto; font-size: var(--fs-sm); font-weight: 600; color: var(--accent-gold); }

    /* Страница направления — список процедур строками */
    .svc-rows { margin-top: 22px; display: flex; flex-direction: column; gap: 14px; }
    .svc-row { display: flex; gap: 18px; align-items: stretch; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 16px; text-decoration: none; box-shadow: var(--shadow-sm); transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s; }
    .svc-row:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: var(--border-strong); }
    .svc-row .thumb { flex: 0 0 108px; width: 108px; height: 108px; border-radius: var(--radius-md); overflow: hidden; position: relative; }
    .svc-row .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .svc-row .thumb .ph { width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); }
    .svc-row .thumb .ph span { font-family: var(--font-display, Fraunces, serif); font-size: 34px; color: rgba(255, 246, 240, 0.9); }
    .svc-row .sr-body { flex: 1; min-width: 0; display: flex; flex-direction: column; }
    .svc-row .sr-name { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: 18px; line-height: 1.3; letter-spacing: -0.01em; }
    .svc-row .sr-desc { margin-top: 5px; color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.55; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .svc-row .sr-foot { margin-top: auto; padding-top: 10px; display: flex; align-items: center; gap: 12px; }
    .svc-row .sr-price { font-weight: 700; color: var(--primary); }
    .svc-row .sr-dur { font-size: var(--fs-xs); color: var(--text-muted); }
    .svc-row .sr-more { margin-left: auto; font-size: var(--fs-sm); font-weight: 600; color: var(--accent-gold); white-space: nowrap; }
    .svc-row:hover .sr-more { color: var(--primary); }
    @media (max-width: 520px) {
      .svc-row .thumb { flex-basis: 84px; width: 84px; height: 84px; }
      .svc-row .sr-desc { -webkit-line-clamp: 3; }
    }

    /* Страница услуги */
    .crumbs { padding: 24px 0 0; font-size: var(--fs-sm); color: var(--text-muted); }
    .crumbs a { color: var(--text-dim); text-decoration: none; }
    .crumbs a:hover { color: var(--primary); }
    .svc-page { max-width: 780px; margin: 16px auto 0; }
    .svc-detail { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl); overflow: hidden; box-shadow: var(--shadow-md); }
    .svc-detail .hero-img img { width: 100%; max-height: 460px; object-fit: cover; display: block; }
    .svc-detail .body { padding: clamp(22px, 4vw, 36px); }
    .svc-detail h1 { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: clamp(26px, 4vw, 34px); letter-spacing: -0.015em; line-height: 1.15; }
    .svc-detail .meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
    .price-big { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: 24px; color: var(--primary); }
    .chip { font-size: var(--fs-sm); color: var(--text-dim); background: var(--bg-soft); border-radius: var(--radius-pill); padding: 5px 14px; }
    .desc { margin-top: 20px; color: var(--text-dim); font-size: var(--fs-md); line-height: 1.7; white-space: pre-wrap; }
    .video-wrap { margin-top: 22px; background: #000; border-radius: var(--radius-md); overflow: hidden; aspect-ratio: 16 / 9; }
    .video-wrap video { width: 100%; height: 100%; display: block; object-fit: contain; }
    .cta-row { display: flex; gap: 12px; margin-top: 26px; flex-wrap: wrap; }
    .cta { flex: 1 1 220px; text-align: center; text-decoration: none; padding: 15px 24px; background: var(--primary); color: #fff; border-radius: var(--radius-md); font-weight: 600; box-shadow: var(--shadow-brand); transition: background 0.15s, transform 0.15s; }
    .cta:hover { background: var(--primary-hover); transform: translateY(-1px); }
    .cta-ghost { flex: 0 1 auto; text-align: center; text-decoration: none; padding: 15px 24px; border: 1px solid var(--border-strong); color: var(--text-dim); border-radius: var(--radius-md); font-weight: 600; transition: all 0.15s; }
    .cta-ghost:hover { border-color: var(--primary); color: var(--primary); }
    .related { margin-top: 44px; }

    /* Контакты — taplink-колонка */
    .tap { max-width: 460px; margin: 0 auto; padding: 40px 0 8px; text-align: center; }
    .tap-logo { width: 96px; height: 96px; border-radius: 50%; object-fit: cover; box-shadow: var(--shadow-md); border: 3px solid #fff; }
    .tap h1 { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: 30px; margin-top: 16px; letter-spacing: -0.01em; }
    .tap-sub { margin-top: 6px; color: var(--text-dim); font-size: var(--fs-md); }
    .tap-hours { display: inline-block; margin-top: 12px; font-size: var(--fs-sm); color: var(--text-dim); background: var(--bg-soft); border-radius: var(--radius-pill); padding: 6px 16px; }
    .tap-links { margin-top: 26px; display: flex; flex-direction: column; gap: 12px; }
    .tap-btn { display: flex; align-items: center; gap: 14px; text-decoration: none; background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-xl); padding: 16px 20px; box-shadow: var(--shadow-sm); transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s; }
    .tap-btn:hover { transform: translateY(-2px); box-shadow: var(--shadow-md); border-color: var(--border-strong); }
    .tap-btn.primary { background: var(--primary); border-color: var(--primary); box-shadow: var(--shadow-brand); }
    .tap-btn.primary .tap-btn-name, .tap-btn.primary .tap-btn-sub { color: #fff; }
    .tap-btn.primary .tap-ico { background: rgba(255, 246, 240, 0.16); color: #fff; }
    .tap-ico { flex: 0 0 44px; width: 44px; height: 44px; border-radius: 50%; background: var(--primary-soft); color: var(--primary); display: flex; align-items: center; justify-content: center; }
    .tap-ico svg { width: 22px; height: 22px; }
    .tap-btn-text { text-align: left; min-width: 0; }
    .tap-btn-name { display: block; font-weight: 600; font-size: var(--fs-md); color: var(--text); }
    .tap-btn-sub { display: block; font-size: var(--fs-sm); color: var(--text-dim); margin-top: 2px; }
    .tap-desc { margin-top: 28px; color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.65; text-align: center; }

    footer { background: var(--primary-dark); color: rgba(255, 246, 240, 0.8); margin-top: 40px; }
    .footer-inner { max-width: 1120px; margin: 0 auto; padding: 32px 24px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .footer-inner img { width: 34px; height: 34px; border-radius: 9px; object-fit: cover; }
    .footer-brand { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: 18px; color: #fff; }
    .footer-note { font-size: var(--fs-xs); opacity: 0.75; }
    .footer-inner .spacer { flex: 1; }
    .footer-cta { text-decoration: none; font-weight: 600; font-size: var(--fs-sm); color: #fff; border: 1px solid rgba(255, 246, 240, 0.35); padding: 9px 18px; border-radius: var(--radius-pill); transition: all 0.15s; }
    .footer-cta:hover { background: rgba(255, 246, 240, 0.12); border-color: rgba(255, 246, 240, 0.6); }
    @media (max-width: 640px) {
      /* Шапка не помещалась в ширину телефона: «Контакты» обрезало краем
         экрана. Ужимаем всё, что можно ужать, — подпись бренда, отступы,
         название текущего раздела в кнопке. */
      .header-inner { padding: 0 12px; gap: 8px; }
      .brand img { width: 32px; height: 32px; }
      .brand-name { font-size: 17px; }
      .brand-sub { display: none; }
      main { padding: 0 16px 40px; }
      .hero { padding: 28px 0 4px; }
      .hero p { font-size: var(--fs-sm); }
      .cat-dd > summary { max-width: 34vw; padding: 8px 12px; gap: 6px; }
      .cat-dd-list { right: -4px; min-width: min(280px, 84vw); }
      .header-link { padding: 8px 8px; }
      /* Карточка в 200px съедала пол-экрана: на телефоне их листают, а не
         рассматривают, поэтому делаем ниже и плотнее. */
      .grid { gap: 14px; margin-top: 14px; }
      .cat-card { min-height: 148px; }
      .cat-card .cc-body { padding: 16px; }
      .cat-card .cc-name { font-size: 19px; }
    }
    @media (max-width: 400px) {
      /* Совсем узкий экран: у кнопки остаются иконка и шеврон — что это меню
         разделов, ясно и без подписи, зато «Контакты» перестают обрезаться. */
      .cat-dd-label { display: none; }
      .cat-dd > summary { max-width: none; }
    }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <a class="brand" href="/services">
        <img src="/zb-logo.jpg" alt="Samaya" />
        <span>
          <span class="brand-name">Samaya</span>
          <span class="brand-sub">Косметология</span>
        </span>
      </a>
      <div class="spacer"></div>
      ${menuDropdown}
      <a class="header-link" href="/contacts">Контакты</a>
    </div>
  </header>
  <main>${opts.body}</main>
  <footer>
    <div class="footer-inner">
      <img src="/zb-logo.jpg" alt="" />
      <div>
        <div class="footer-brand">Samaya</div>
        <div class="footer-note">Косметологическая клиника · © ${new Date().getFullYear()}</div>
      </div>
      <div class="spacer"></div>
      <a class="footer-cta" href="/contacts">Контакты</a>
    </div>
  </footer>
</body>
</html>`;
}

function cardHtml(s: MenuService): string {
  const img = s.image_path
    ? `<img src="/media/${esc(s.image_path)}" alt="${esc(s.name)}" loading="lazy" />`
    : `<div class="ph"><span>${esc([...s.name][0] ?? '•').toUpperCase()}</span></div>`;
  const prev = preview(s.description, 150);
  return `<a class="svc-card" href="/services/${esc(s.slug)}">
    <div class="img">${img}</div>
    <div class="body">
      <div class="name">${esc(s.name)}</div>
      ${prev ? `<div class="prev">${esc(prev)}</div>` : ''}
      <div class="row">
        <span class="price">${fmtPrice(s.price)}</span>
        <span class="dur">${esc(fmtDuration(s.duration_minutes))}</span>
        <span class="more">Подробнее →</span>
      </div>
    </div>
  </a>`;
}

function catMenu(
  groups: Array<{ name: string; slug: string }>,
  activeSlug?: string,
): Array<{ label: string; href: string; active?: boolean }> {
  return groups.map((g) => ({
    label: g.name,
    href: `/services/category/${g.slug}`,
    active: g.slug === activeSlug,
  }));
}

function declProcedures(n: number): string {
  const d10 = n % 10; const d100 = n % 100;
  if (d10 === 1 && d100 !== 11) return `${n} процедура`;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return `${n} процедуры`;
  return `${n} процедур`;
}

// Строка процедуры на странице направления (как список методик у референса)
function rowHtml(s: MenuService): string {
  const thumb = s.image_path
    ? `<img src="/media/${esc(s.image_path)}" alt="${esc(s.name)}" loading="lazy" />`
    : `<div class="ph"><span>${esc([...s.name][0] ?? '•').toUpperCase()}</span></div>`;
  const prev = preview(s.description, 180);
  return `<a class="svc-row" href="/services/${esc(s.slug)}">
    <div class="thumb">${thumb}</div>
    <div class="sr-body">
      <div class="sr-name">${esc(s.name)}</div>
      ${prev ? `<div class="sr-desc">${esc(prev)}</div>` : ''}
      <div class="sr-foot">
        <span class="sr-price">${fmtPrice(s.price)}</span>
        <span class="sr-dur">${esc(fmtDuration(s.duration_minutes))}</span>
        <span class="sr-more">Подробнее →</span>
      </div>
    </div>
  </a>`;
}

// «Услуги» — обзор направлений: карточка на каждую категорию
router.get('/services', async (req, res, next) => {
  try {
    const companyId = getCompanyId(req);
    const items = await menuServices(companyId);
    const groups = groupByCategory(items);
    const hero = `<div class="hero">
      <div class="overline">Косметологическая клиника</div>
      <h1>Наши услуги</h1>
      <p>Аппаратная косметология, лазерная эпиляция и уходовые процедуры. Выберите направление, чтобы посмотреть процедуры, цены и записаться онлайн.</p>
    </div>`;
    const cards = groups.map((g) => {
      const cover = g.items.find((s) => s.image_path)?.image_path;
      const bg = cover ? `<img src="/media/${esc(cover)}" alt="" loading="lazy" />` : '';
      return `<a class="cat-card" href="/services/category/${esc(g.slug)}">
        <div class="bg">${bg}</div>
        <div class="cc-body">
          <div class="cc-name">${esc(g.name)}</div>
          <div class="cc-meta">
            <span class="cc-count">${declProcedures(g.items.length)}</span>
            <span class="cc-more">Смотреть →</span>
          </div>
        </div>
      </a>`;
    }).join('');
    const body = items.length
      ? `${hero}<div class="cat-grid">${cards}</div>`
      : `${hero}<div class="empty">Каталог услуг скоро появится.</div>`;
    const html = page({
      title: 'Услуги — Samaya',
      metaDescription: 'Каталог услуг косметологической клиники Samaya: аппаратная косметология, лазерная эпиляция, описание, цены, онлайн-запись.',
      canonicalPath: '/services',
      menu: catMenu(groups),
      body,
    });
    return res.type('html').send(html);
  } catch (e) { return next(e); }
});

// Страница направления — заголовок, вводная, список процедур
router.get('/services/category/:cslug', async (req, res, next) => {
  try {
    const companyId = getCompanyId(req);
    const items = await menuServices(companyId);
    const groups = groupByCategory(items);
    const g = groups.find((x) => x.slug === req.params.cslug);
    if (!g) {
      const html = page({
        title: 'Раздел не найден — Samaya',
        metaDescription: 'Раздел каталога не найден.',
        canonicalPath: '/services',
        menu: catMenu(groups),
        body: `<div class="svc-page"><div class="empty"><h1 style="font-family:var(--font-display,Fraunces,serif);">Раздел не найден</h1><p style="margin:12px 0 20px;">Возможно, ссылка устарела.</p><a class="cta-ghost" href="/services">← Все услуги</a></div></div>`,
      });
      return res.status(404).type('html').send(html);
    }
    const prices = g.items.map((s) => s.price);
    const minPrice = Math.min(...prices);
    const body = `
      <div class="crumbs"><a href="/services">Услуги</a> · ${esc(g.name)}</div>
      <div class="hero" style="padding-top:16px;">
        <div class="overline">${declProcedures(g.items.length)} · от ${fmtPrice(minPrice)}</div>
        <h1>${esc(g.name)}</h1>
      </div>
      <div class="svc-rows">${g.items.map(rowHtml).join('')}</div>`;
    const html = page({
      title: `${g.name} — услуги и цены — Samaya`,
      metaDescription: `${g.name} в клинике Samaya (Каспийск): ${declProcedures(g.items.length)}, цены от ${fmtPrice(minPrice)}. Описания процедур и онлайн-запись.`,
      canonicalPath: `/services/category/${g.slug}`,
      menu: catMenu(groups, g.slug),
      body,
    });
    return res.type('html').send(html);
  } catch (e) { return next(e); }
});

// Страница услуги: хлебные крошки, карточка, «ещё из категории»
router.get('/services/:slug', async (req, res, next) => {
  try {
    const companyId = getCompanyId(req);
    const items = await menuServices(companyId);
    const groups = groupByCategory(items);
    const s = items.find((x) => x.slug === req.params.slug);
    const sGroup = s ? groups.find((g) => g.name === (s.category_name || NO_CATEGORY)) : undefined;
    const menu = catMenu(groups, sGroup?.slug);
    if (!s) {
      const html = page({
        title: 'Услуга не найдена — Samaya',
        metaDescription: 'Услуга не найдена.',
        canonicalPath: '/services',
        menu,
        body: `<div class="svc-page"><div class="empty"><h1 style="font-family:var(--font-display,Fraunces,serif);">Услуга не найдена</h1><p style="margin:12px 0 20px;">Возможно, ссылка устарела.</p><a class="cta-ghost" href="/services">← Назад к услугам</a></div></div>`,
      });
      return res.status(404).type('html').send(html);
    }
    const catName = s.category_name || NO_CATEGORY;
    const group = sGroup;
    const related = (group?.items ?? []).filter((x) => x.id !== s.id).slice(0, 3);
    const hero = s.image_path
      ? `<div class="hero-img"><img src="/media/${esc(s.image_path)}" alt="${esc(s.name)}" /></div>`
      : '';
    const video = (s.preview_enabled && s.video_path)
      ? `<div class="video-wrap"><video controls playsinline preload="metadata" src="/media/${esc(s.video_path)}"></video></div>`
      : '';
    const body = `
      <div class="crumbs"><a href="/services">Услуги</a> · <a href="/services/category/${esc(group?.slug ?? '')}">${esc(catName)}</a></div>
      <div class="svc-page">
        <article class="svc-detail">
          ${hero}
          <div class="body">
            <h1>${esc(s.name)}</h1>
            <div class="meta">
              <span class="price-big">${fmtPrice(s.price)}</span>
              <span class="chip">${esc(fmtDuration(s.duration_minutes))}</span>
              ${s.category_name ? `<span class="chip">${esc(s.category_name)}</span>` : ''}
            </div>
            ${s.description ? `<div class="desc">${esc(s.description)}</div>` : ''}
            ${video}
            <div class="cta-row">
              <a class="cta-ghost" href="/services/category/${esc(group?.slug ?? '')}">← Назад к «${esc(catName)}»</a>
            </div>
          </div>
        </article>
        ${related.length ? `<section class="related">
          <div class="cat-head"><h2>Ещё из «${esc(catName)}»</h2></div>
          <div class="grid">${related.map(cardHtml).join('')}</div>
        </section>` : ''}
      </div>`;
    const html = page({
      title: `${s.name} — Samaya`,
      metaDescription: preview(s.description, 160) || `${s.name}: цена ${fmtPrice(s.price)}, запись онлайн в клинике Samaya.`,
      canonicalPath: `/services/${s.slug}`,
      menu,
      body,
    });
    return res.type('html').send(html);
  } catch (e) { return next(e); }
});

// «Контакты» — taplink-колонка: логотип, ключевые кнопки-ссылки, описание.
router.get('/contacts', async (req, res, next) => {
  try {
    const companyId = getCompanyId(req);
    const { rows } = await pool.query(
      `SELECT name, address, phone, email, website, description,
              to_char(default_open, 'HH24:MI') AS open,
              to_char(default_close, 'HH24:MI') AS close
       FROM salons.company_profile WHERE company_id = $1`,
      [companyId],
    );
    const p = rows[0] ?? {};
    const phone: string = p.phone || '';
    const phoneDigits = phone.replace(/\D/g, '');
    const ico = {
      phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>',
      wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 004.74 1.21c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0012.04 2zm0 18.15c-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.26 8.26 0 01-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 012.41 5.83c0 4.54-3.7 8.23-8.23 8.23zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29z"/></svg>',
      cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"/></svg>',
      spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z"/></svg>',
      pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path stroke-linecap="round" stroke-linejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"/></svg>',
    };
    const btn = (opts: { href: string; name: string; sub?: string; icon: string; primary?: boolean; blank?: boolean }) =>
      `<a class="tap-btn${opts.primary ? ' primary' : ''}" href="${esc(opts.href)}"${opts.blank ? ' target="_blank" rel="noopener"' : ''}>
        <span class="tap-ico">${opts.icon}</span>
        <span class="tap-btn-text">
          <span class="tap-btn-name">${esc(opts.name)}</span>
          ${opts.sub ? `<span class="tap-btn-sub">${esc(opts.sub)}</span>` : ''}
        </span>
      </a>`;
    const links = [
      phoneDigits ? btn({ href: `tel:+${phoneDigits}`, name: 'Позвонить', sub: phone, icon: ico.phone }) : '',
      phoneDigits ? btn({ href: `https://wa.me/${phoneDigits}`, name: 'Написать в WhatsApp', sub: 'Ответим в рабочее время', icon: ico.wa, blank: true }) : '',
      btn({ href: '/services', name: 'Наши услуги', sub: 'Каталог процедур с ценами', icon: ico.spark }),
      p.address ? btn({ href: `https://yandex.ru/maps/?text=${encodeURIComponent(p.address)}`, name: 'Как добраться', sub: p.address, icon: ico.pin, blank: true }) : '',
    ].filter(Boolean).join('');
    const body = `<div class="tap">
      <img class="tap-logo" src="/zb-logo.jpg" alt="Samaya" />
      <h1>${esc(p.name || 'Samaya')}</h1>
      <div class="tap-sub">Клиника эстетической медицины · Каспийск</div>
      ${p.open && p.close ? `<div class="tap-hours">Ежедневно ${esc(p.open)} — ${esc(p.close)}</div>` : ''}
      <div class="tap-links">${links}</div>
      ${p.description ? `<div class="tap-desc">${esc(preview(p.description, 320))}</div>` : ''}
    </div>`;
    const html = page({
      title: `Контакты — ${p.name || 'Samaya'}`,
      metaDescription: `Контакты клиники ${p.name || 'Samaya'}: ${[p.address, phone].filter(Boolean).join(', ')}. Онлайн-запись, WhatsApp, каталог услуг.`,
      canonicalPath: '/contacts',
      menu: [],
      body,
    });
    return res.type('html').send(html);
  } catch (e) { return next(e); }
});

export default router;
