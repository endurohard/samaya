// Публичный сайт-каталог услуг (SSR для SEO):
//   GET /api/salons/public/site/services        → «Услуги», грид карточек
//   GET /api/salons/public/site/services/:slug  → страница услуги
// nginx фронта проксирует красивые URL /services и /services/:slug сюда,
// поэтому все ссылки в разметке — относительные /services/... и /media/...
// В каталог и меню попадают только услуги с show_in_menu = TRUE.

import { Router, type Request } from 'express';
import { pool } from '../db';
import { config } from '../config';
import { HttpError } from '../middleware';

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

// Обёртка страницы: шапка с меню услуг, футер, единые токены/стили.
function page(opts: {
  title: string;
  metaDescription: string;
  canonicalPath: string;
  menu: MenuService[];
  activeSlug?: string;
  body: string;
}): string {
  const menuHtml = opts.menu.map((s) =>
    `<a class="menu-link${s.slug === opts.activeSlug ? ' active' : ''}" href="/services/${esc(s.slug)}">${esc(s.name)}</a>`,
  ).join('');
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
  <link rel="stylesheet" href="/tokens.css" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: var(--font-sans); background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; }
    a { color: inherit; }
    header { background: var(--card); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 10; }
    .header-inner { max-width: 1080px; margin: 0 auto; display: flex; align-items: center; gap: 10px; height: 56px; padding: 0 20px; }
    .header-inner img { width: 30px; height: 30px; border-radius: 7px; object-fit: cover; }
    .header-inner .brand { font-weight: 700; font-size: 17px; letter-spacing: -0.01em; text-decoration: none; }
    .header-inner .spacer { flex: 1; }
    .header-cta { text-decoration: none; background: var(--primary); color: #fff; font-weight: 600; font-size: var(--fs-sm); padding: 8px 14px; border-radius: var(--radius-md); }
    .header-cta:hover { background: var(--primary-hover); }
    nav.services-menu { background: var(--card); border-bottom: 1px solid var(--border); }
    .menu-inner { max-width: 1080px; margin: 0 auto; padding: 0 12px; display: flex; gap: 2px; overflow-x: auto; -webkit-overflow-scrolling: touch; }
    .menu-link { white-space: nowrap; text-decoration: none; font-size: var(--fs-sm); color: var(--text-dim); padding: 10px 12px; border-bottom: 2px solid transparent; }
    .menu-link:hover { color: var(--text); }
    .menu-link.active { color: var(--primary); border-bottom-color: var(--primary); font-weight: 600; }
    main { width: 100%; max-width: 1080px; margin: 0 auto; padding: 24px 20px 40px; flex: 1; }
    h1 { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-3xl, 28px); letter-spacing: -0.01em; line-height: 1.2; }
    .grid { margin-top: 20px; display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 18px; }
    .svc-card { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-md); display: flex; flex-direction: column; text-decoration: none; transition: transform 0.12s, box-shadow 0.12s; }
    .svc-card:hover { transform: translateY(-2px); box-shadow: var(--shadow-lg, 0 12px 32px -8px rgba(17,24,39,0.18)); }
    .svc-card .img { aspect-ratio: 4 / 3; background: var(--bg-soft); display: flex; align-items: center; justify-content: center; overflow: hidden; }
    .svc-card .img img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .svc-card .img .ph { font-family: var(--font-display); font-size: 44px; font-weight: 600; color: #fff; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; }
    .svc-card .body { padding: 16px; display: flex; flex-direction: column; gap: 8px; flex: 1; }
    .svc-card .name { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-lg); line-height: 1.25; }
    .svc-card .prev { color: var(--text-dim); font-size: var(--fs-sm); line-height: 1.5; flex: 1; }
    .svc-card .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 4px; }
    .svc-card .price { font-weight: 700; color: var(--primary); }
    .svc-card .more { font-size: var(--fs-sm); font-weight: 600; color: var(--primary); }
    .empty { margin-top: 40px; text-align: center; color: var(--text-dim); }
    /* Страница услуги */
    .svc-page { max-width: 760px; margin: 0 auto; }
    .back { display: inline-block; margin-bottom: 14px; text-decoration: none; color: var(--text-dim); font-size: var(--fs-sm); }
    .back:hover { color: var(--text); }
    .svc-detail { background: var(--card); border: 1px solid var(--border); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-md); }
    .svc-detail .hero { background: var(--bg-soft); }
    .svc-detail .hero img { width: 100%; max-height: 440px; object-fit: cover; display: block; }
    .svc-detail .body { padding: 24px; }
    .svc-detail .meta { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 14px; }
    .price-big { font-family: var(--font-display); font-weight: 600; font-size: var(--fs-xl); color: var(--primary); }
    .chip { font-size: var(--fs-sm); color: var(--text-dim); background: var(--bg-soft); border-radius: var(--radius-pill); padding: 4px 12px; }
    .desc { margin-top: 16px; color: var(--text-dim); font-size: var(--fs-md); line-height: 1.6; white-space: pre-wrap; }
    .video-wrap { margin-top: 18px; background: #000; border-radius: var(--radius-md); overflow: hidden; aspect-ratio: 16 / 9; }
    .video-wrap video { width: 100%; height: 100%; display: block; object-fit: contain; }
    .cta { display: block; text-align: center; text-decoration: none; margin-top: 20px; padding: 14px; background: var(--primary); color: #fff; border-radius: var(--radius-md); font-weight: 600; box-shadow: var(--shadow-brand); }
    .cta:hover { background: var(--primary-hover); }
    footer { color: var(--text-muted); font-size: var(--fs-xs); padding: 24px; text-align: center; }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <a class="brand" href="/services" style="display:flex;align-items:center;gap:10px;">
        <img src="/zb-logo.jpg" alt="Samaya" />
        <span>Samaya</span>
      </a>
      <div class="spacer"></div>
      <a class="header-cta" href="/book.html">Записаться</a>
    </div>
  </header>
  ${opts.menu.length ? `<nav class="services-menu" aria-label="Меню услуг"><div class="menu-inner">${menuHtml}</div></nav>` : ''}
  <main>${opts.body}</main>
  <footer>© Samaya</footer>
</body>
</html>`;
}

function cardHtml(s: MenuService): string {
  const img = s.image_path
    ? `<img src="/media/${esc(s.image_path)}" alt="${esc(s.name)}" loading="lazy" />`
    : `<div class="ph" style="background:${esc(s.color || '#93494b')}">${esc([...s.name][0] ?? '•').toUpperCase()}</div>`;
  const prev = preview(s.description, 140);
  return `<a class="svc-card" href="/services/${esc(s.slug)}">
    <div class="img">${img}</div>
    <div class="body">
      <div class="name">${esc(s.name)}</div>
      ${prev ? `<div class="prev">${esc(prev)}</div>` : ''}
      <div class="row">
        <span class="price">${fmtPrice(s.price)}</span>
        <span class="more">Подробнее →</span>
      </div>
    </div>
  </a>`;
}

// «Услуги» — каталог
router.get('/services', async (req, res, next) => {
  try {
    const companyId = getCompanyId(req);
    const menu = await menuServices(companyId);
    const body = menu.length
      ? `<h1>Услуги</h1><div class="grid">${menu.map(cardHtml).join('')}</div>`
      : `<h1>Услуги</h1><div class="empty">Каталог услуг скоро появится.</div>`;
    const html = page({
      title: 'Услуги — Samaya',
      metaDescription: 'Каталог услуг косметологической клиники Samaya: описание, цены, онлайн-запись.',
      canonicalPath: '/services',
      menu,
      body,
    });
    return res.type('html').send(html);
  } catch (e) { return next(e); }
});

// Страница услуги
router.get('/services/:slug', async (req, res, next) => {
  try {
    const companyId = getCompanyId(req);
    const menu = await menuServices(companyId);
    const s = menu.find((x) => x.slug === req.params.slug);
    if (!s) {
      const html = page({
        title: 'Услуга не найдена — Samaya',
        metaDescription: 'Услуга не найдена.',
        canonicalPath: '/services',
        menu,
        body: `<div class="svc-page"><a class="back" href="/services">← Назад к услугам</a><div class="empty"><h1>Услуга не найдена</h1><p style="margin-top:8px;">Возможно, ссылка устарела.</p></div></div>`,
      });
      return res.status(404).type('html').send(html);
    }
    const hero = s.image_path
      ? `<div class="hero"><img src="/media/${esc(s.image_path)}" alt="${esc(s.name)}" /></div>`
      : '';
    const video = (s.preview_enabled && s.video_path)
      ? `<div class="video-wrap"><video controls playsinline preload="metadata" src="/media/${esc(s.video_path)}"></video></div>`
      : '';
    const body = `<div class="svc-page">
      <a class="back" href="/services">← Назад к услугам</a>
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
          <a class="cta" href="/book.html">Записаться</a>
        </div>
      </article>
    </div>`;
    const html = page({
      title: `${s.name} — Samaya`,
      metaDescription: preview(s.description, 160) || `${s.name}: цена ${fmtPrice(s.price)}, запись онлайн в клинике Samaya.`,
      canonicalPath: `/services/${s.slug}`,
      menu,
      activeSlug: s.slug,
      body,
    });
    return res.type('html').send(html);
  } catch (e) { return next(e); }
});

export default router;
