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
function groupByCategory(items: MenuService[]): Array<{ name: string; anchor: string; items: MenuService[] }> {
  const map = new Map<string, MenuService[]>();
  for (const s of items) {
    const key = s.category_name || NO_CATEGORY;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  const groups = [...map.entries()].map(([name, list]) => ({
    name, anchor: `cat-${slugify(name) || 'other'}`, items: list,
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
  const menuHtml = opts.menu.map((m) =>
    `<a class="menu-link${m.active ? ' active' : ''}" href="${esc(m.href)}">${esc(m.label)}</a>`,
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

    header { background: rgba(255,255,255,0.92); backdrop-filter: blur(8px); border-bottom: 1px solid var(--border); position: sticky; top: 0; z-index: 20; }
    .header-inner { max-width: 1120px; margin: 0 auto; display: flex; align-items: center; gap: 12px; height: 64px; padding: 0 24px; }
    .brand { display: flex; align-items: center; gap: 12px; text-decoration: none; }
    .brand img { width: 36px; height: 36px; border-radius: 10px; object-fit: cover; box-shadow: var(--shadow-sm); }
    .brand-name { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: 20px; letter-spacing: -0.01em; }
    .brand-sub { font-size: var(--fs-xs); color: var(--accent-gold); letter-spacing: 0.14em; text-transform: uppercase; display: block; margin-top: 1px; }
    .spacer { flex: 1; }
    .header-cta { text-decoration: none; background: var(--primary); color: #fff; font-weight: 600; font-size: var(--fs-sm); padding: 10px 20px; border-radius: var(--radius-pill); box-shadow: var(--shadow-brand); transition: background 0.15s, transform 0.15s; }
    .header-cta:hover { background: var(--primary-hover); transform: translateY(-1px); }

    nav.cat-menu { background: var(--card); border-bottom: 1px solid var(--border); position: sticky; top: 64px; z-index: 19; }
    .menu-inner { max-width: 1120px; margin: 0 auto; padding: 10px 20px; display: flex; gap: 8px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }
    .menu-inner::-webkit-scrollbar { display: none; }
    .menu-link { white-space: nowrap; text-decoration: none; font-size: var(--fs-sm); color: var(--text-dim); padding: 7px 14px; border: 1px solid var(--border); border-radius: var(--radius-pill); background: var(--bg); transition: all 0.15s; }
    .menu-link:hover { border-color: var(--primary); color: var(--primary); background: var(--primary-soft); }
    .menu-link.active { background: var(--primary); border-color: var(--primary); color: #fff; font-weight: 600; }

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

    footer { background: var(--primary-dark); color: rgba(255, 246, 240, 0.8); margin-top: 40px; }
    .footer-inner { max-width: 1120px; margin: 0 auto; padding: 32px 24px; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
    .footer-inner img { width: 34px; height: 34px; border-radius: 9px; object-fit: cover; }
    .footer-brand { font-family: var(--font-display, Fraunces, serif); font-weight: 600; font-size: 18px; color: #fff; }
    .footer-note { font-size: var(--fs-xs); opacity: 0.75; }
    .footer-inner .spacer { flex: 1; }
    .footer-cta { text-decoration: none; font-weight: 600; font-size: var(--fs-sm); color: #fff; border: 1px solid rgba(255, 246, 240, 0.35); padding: 9px 18px; border-radius: var(--radius-pill); transition: all 0.15s; }
    .footer-cta:hover { background: rgba(255, 246, 240, 0.12); border-color: rgba(255, 246, 240, 0.6); }
    @media (max-width: 640px) {
      .header-inner { padding: 0 16px; }
      main { padding: 0 16px 40px; }
      .hero { padding: 32px 0 4px; }
      nav.cat-menu { top: 64px; }
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
      <a class="header-cta" href="/book.html">Записаться</a>
    </div>
  </header>
  ${opts.menu.length ? `<nav class="cat-menu" aria-label="Меню услуг"><div class="menu-inner">${menuHtml}</div></nav>` : ''}
  <main>${opts.body}</main>
  <footer>
    <div class="footer-inner">
      <img src="/zb-logo.jpg" alt="" />
      <div>
        <div class="footer-brand">Samaya</div>
        <div class="footer-note">Косметологическая клиника · © ${new Date().getFullYear()}</div>
      </div>
      <div class="spacer"></div>
      <a class="footer-cta" href="/book.html">Онлайн-запись</a>
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

// «Услуги» — каталог секциями по категориям, меню — якоря категорий
router.get('/services', async (req, res, next) => {
  try {
    const companyId = getCompanyId(req);
    const items = await menuServices(companyId);
    const groups = groupByCategory(items);
    const hero = `<div class="hero">
      <div class="overline">Косметологическая клиника</div>
      <h1>Наши услуги</h1>
      <p>Аппаратная косметология, лазерная эпиляция и уходовые процедуры. Выберите услугу, чтобы узнать подробности и записаться онлайн.</p>
    </div>`;
    const sections = groups.map((g) => `<section class="cat-section" id="${esc(g.anchor)}">
      <div class="cat-head"><h2>${esc(g.name)}</h2><span class="count">${g.items.length}</span></div>
      <div class="grid">${g.items.map(cardHtml).join('')}</div>
    </section>`).join('');
    const body = items.length
      ? hero + sections
      : `${hero}<div class="empty">Каталог услуг скоро появится.</div>`;
    const html = page({
      title: 'Услуги — Samaya',
      metaDescription: 'Каталог услуг косметологической клиники Samaya: аппаратная косметология, лазерная эпиляция, описание, цены, онлайн-запись.',
      canonicalPath: '/services',
      menu: groups.map((g) => ({ label: g.name, href: `#${g.anchor}` })),
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
    const menu = groups.map((g) => ({
      label: g.name,
      href: `/services#${g.anchor}`,
      active: !!s && (s.category_name || NO_CATEGORY) === g.name,
    }));
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
    const group = groups.find((g) => g.name === catName);
    const related = (group?.items ?? []).filter((x) => x.id !== s.id).slice(0, 3);
    const hero = s.image_path
      ? `<div class="hero-img"><img src="/media/${esc(s.image_path)}" alt="${esc(s.name)}" /></div>`
      : '';
    const video = (s.preview_enabled && s.video_path)
      ? `<div class="video-wrap"><video controls playsinline preload="metadata" src="/media/${esc(s.video_path)}"></video></div>`
      : '';
    const body = `
      <div class="crumbs"><a href="/services">Услуги</a> · <a href="/services#${esc(group?.anchor ?? '')}">${esc(catName)}</a></div>
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
              <a class="cta" href="/book.html">Записаться онлайн</a>
              <a class="cta-ghost" href="/services">← Назад к услугам</a>
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

export default router;
