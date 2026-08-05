// Публичный лендинг индивидуального купона: GET /api/bookings/public/promo/:token
// (nginx фронта проксирует красивый URL /promo/<token>).
// Первое открытие фиксирует opened_at (мониторинг воронки). Клиент оставляет
// имя+телефон обычной HTML-формой (без JS — CSP-friendly), POST /:token/claim
// переводит купон в claimed и редиректит обратно (PRG).

import { Router, urlencoded } from 'express';
import crypto from 'node:crypto';
import { pool } from '../db';
import { normalizePhone, findOrCreateClientId } from '../client-link';

// Карточка клиента для «акционной» аудитории: source='promo' → отдельный
// сегмент «Акционные» в разделе Клиенты. Ошибка создания не должна ломать
// клейм купона (клиент остаётся хотя бы в аудитории акции).
async function linkPromoClient(companyId: string, phone: string, name: string): Promise<string | null> {
  const conn = await pool.connect();
  try {
    await conn.query('BEGIN');
    const id = await findOrCreateClientId(conn, companyId, phone, name, 'promo');
    await conn.query('COMMIT');
    return id;
  } catch {
    await conn.query('ROLLBACK').catch(() => {});
    return null;
  } finally {
    conn.release();
  }
}

const router = Router();

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Бот или живой человек. Раньше отбрасывали по названию мессенджера в
// user-agent, и вместе с ботом-превью терялся реальный посетитель: люди
// открывают ссылку прямо из WhatsApp, и его встроенный браузер тоже пишет
// «WhatsApp» в user-agent. Теперь считаем наоборот — засчитываем только то,
// что выглядит настоящим браузером; превью и краулеры полноценным браузером
// не притворяются.
export function looksLikeBot(ua: string): boolean {
  const browserLike = /Mozilla\/5\.0/i.test(ua)
    && /(Chrome|CriOS|Firefox|FxiOS|YaBrowser|Edg|Version\/[\d.]+ (Mobile\/\S+ )?Safari)\//i.test(ua);
  const crawler = /(^|[^a-z])bot([^a-z]|$)|crawler|crawl|spider|preview|facebookexternalhit|vkshare|curl|wget|python-requests|okhttp|headless/i.test(ua);
  return crawler || !browserLike;
}

function fmtPrice(v: number): string {
  return `${new Intl.NumberFormat('ru-RU').format(v)} ₽`;
}

// Телефон из формы: 8XXXXXXXXXX и XXXXXXXXXX (10 цифр с 9) приводим к +7…
function claimPhone(raw: string): string {
  const base = normalizePhone(raw.trim());
  const digits = base.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith('9')) return `+7${digits}`;
  if (digits.length >= 10 && !base.startsWith('+')) return `+${digits}`;
  return base;
}

function fmtDate(d: string): string {
  const [y, m, day] = d.slice(0, 10).split('-');
  return `${day}.${m}.${y}`;
}

interface CouponRow {
  coupon_id: string; token: string; status: string;
  client_name: string | null;
  promo_id: string; promo_name: string; code: string; company_id: string;
  discount_pct: number | null; discount_amount: number | null;
  valid_from: string | null; valid_to: string | null; is_active: boolean;
}

async function loadCoupon(token: string): Promise<CouponRow | null> {
  const { rows } = await pool.query(
    `SELECT c.id AS coupon_id, c.token, c.status, c.client_name,
            p.id AS promo_id, p.name AS promo_name, p.code, p.company_id,
            p.discount_pct::float8 AS discount_pct,
            p.discount_amount::float8 AS discount_amount,
            p.valid_from::text, p.valid_to::text, p.is_active
     FROM bookings.promo_coupons c
     JOIN bookings.promotions p ON p.id = c.promo_id
     WHERE c.token = $1`,
    [token],
  );
  return rows[0] ?? null;
}

// Телефон клиники для кнопок «Связаться с менеджером»
async function companyPhone(companyId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT phone FROM salons.company_profile WHERE company_id = $1`, [companyId],
  );
  return rows[0]?.phone || '';
}

// Кнопки связи: WhatsApp (с готовым сообщением) + звонок
function contactHtml(phone: string, waText: string): string {
  const digits = phone.replace(/\D/g, '');
  if (!digits) return '';
  const waIco = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38a9.87 9.87 0 004.74 1.21c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0012.04 2zm4.52 13.99c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.25-.64.8-.78.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.02-.38.11-.51.11-.11.25-.29.37-.43.13-.14.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.13.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29z"/></svg>';
  const telIco = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="20" height="20"><path stroke-linecap="round" stroke-linejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"/></svg>';
  return `<h2 style="margin-top:22px;">Связаться с менеджером</h2>
    <div class="contact-row">
      <a class="contact-btn wa" href="https://wa.me/${esc(digits)}?text=${encodeURIComponent(waText)}" target="_blank" rel="noopener">
        ${waIco} Написать в WhatsApp
      </a>
      <a class="contact-btn" href="tel:+${esc(digits)}">
        ${telIco} Позвонить ${esc(phone)}
      </a>
    </div>`;
}

function pageHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#93494b" />
  <meta name="robots" content="noindex" />
  <title>${esc(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #faf7f4; --bg-soft: #f4efe9; --card: #ffffff;
      --border: #ece4de; --text: #2a2320; --text-dim: #7a6f68; --text-muted: #a89b94;
      --primary: #93494b; --primary-hover: #7a3b3d; --primary-soft: #f4e9e9; --primary-dark: #5e2b2d;
      --accent-gold: #b8894e;
      --shadow-md: 0 10px 30px rgba(42, 32, 32, 0.10);
      --shadow-brand: 0 8px 20px rgba(147, 73, 75, 0.28);
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Golos Text', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; }
    header { background: var(--card); border-bottom: 1px solid var(--border); }
    .header-inner { max-width: 560px; margin: 0 auto; display: flex; align-items: center; gap: 12px; height: 60px; padding: 0 20px; }
    .header-inner img { width: 34px; height: 34px; border-radius: 9px; object-fit: cover; }
    .brand-name { font-family: Fraunces, serif; font-weight: 600; font-size: 19px; }
    .brand-sub { font-size: 11px; color: var(--accent-gold); letter-spacing: 0.14em; text-transform: uppercase; display: block; }
    main { width: 100%; max-width: 560px; margin: 0 auto; padding: 28px 20px 48px; flex: 1; }
    .coupon { background: var(--card); border: 1px solid var(--border); border-radius: 22px; overflow: hidden; box-shadow: var(--shadow-md); }
    .coupon-top { background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); padding: 30px 26px; text-align: center; position: relative; }
    .coupon-top::after { content: ''; position: absolute; inset: 0; background: radial-gradient(ellipse at 75% 15%, rgba(184, 137, 78, 0.3), transparent 55%); }
    .coupon-top * { position: relative; }
    .c-overline { font-size: 11px; font-weight: 700; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(255, 246, 240, 0.75); }
    .c-amount { font-family: Fraunces, serif; font-weight: 600; font-size: 52px; color: #fff; margin-top: 8px; letter-spacing: -0.02em; }
    .c-name { margin-top: 6px; color: rgba(255, 246, 240, 0.9); font-size: 16px; }
    .c-valid { margin-top: 12px; display: inline-block; font-size: 12.5px; color: rgba(255, 246, 240, 0.85); border: 1px solid rgba(255, 246, 240, 0.35); border-radius: 999px; padding: 5px 14px; }
    .coupon-body { padding: 24px 26px 28px; }
    h2 { font-family: Fraunces, serif; font-weight: 600; font-size: 18px; letter-spacing: -0.01em; }
    .svc-list { margin-top: 12px; display: flex; flex-direction: column; gap: 8px; }
    .svc-item { display: flex; align-items: center; gap: 12px; font-size: 14px; padding: 8px 12px 8px 8px; background: var(--bg-soft); border-radius: 12px; text-decoration: none; color: var(--text); border: 1px solid transparent; transition: border-color 0.15s, background 0.15s; }
    a.svc-item:hover { border-color: var(--primary); background: var(--primary-soft); }
    .svc-item .th { flex: 0 0 48px; width: 48px; height: 48px; border-radius: 9px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%); }
    .svc-item .th img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .svc-item .th-ph { font-family: Fraunces, serif; font-size: 20px; color: rgba(255, 246, 240, 0.9); }
    .svc-item .sv-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .svc-item .sv-name { font-weight: 600; line-height: 1.3; }
    .svc-item .sv-meta { font-size: 12px; color: var(--text-dim); }
    .svc-item .p { color: var(--primary); font-weight: 700; white-space: nowrap; }
    .contact-row { margin-top: 12px; display: flex; flex-direction: column; gap: 10px; }
    .contact-btn { display: flex; align-items: center; justify-content: center; gap: 10px; text-decoration: none; border: 1px solid var(--border); border-radius: 12px; padding: 13px 16px; font-weight: 600; font-size: 15px; color: var(--text); transition: border-color 0.15s, background 0.15s; }
    .contact-btn:hover { border-color: var(--primary); background: var(--primary-soft); }
    .contact-btn.wa { background: #25d366; border-color: #25d366; color: #fff; }
    .contact-btn.wa:hover { background: #1fb857; }
    .any { margin-top: 10px; color: var(--text-dim); font-size: 14.5px; line-height: 1.6; }
    .more-link { color: var(--primary); }
    form { margin-top: 22px; display: flex; flex-direction: column; gap: 12px; }
    label { font-size: 13.5px; font-weight: 600; color: var(--text-dim); }
    input { width: 100%; border: 1px solid var(--border); border-radius: 10px; padding: 13px 14px; font-size: 16px; font-family: inherit; background: var(--card); color: var(--text); }
    input:focus { outline: none; border-color: var(--primary); box-shadow: 0 0 0 3px rgba(147, 73, 75, 0.2); }
    button { margin-top: 6px; background: var(--primary); color: #fff; border: none; border-radius: 12px; padding: 15px; font-size: 16px; font-weight: 600; font-family: inherit; cursor: pointer; box-shadow: var(--shadow-brand); }
    button:hover { background: var(--primary-hover); }
    .hint { font-size: 12.5px; color: var(--text-muted); line-height: 1.5; }
    .ok-badge { display: inline-flex; align-items: center; gap: 8px; background: #f0fdf4; color: #0ea372; font-weight: 600; font-size: 14px; border-radius: 999px; padding: 8px 16px; }
    .code-box { margin-top: 16px; text-align: center; background: var(--bg-soft); border: 1px dashed var(--accent-gold); border-radius: 14px; padding: 16px; }
    .code-box .cb-label { font-size: 12px; color: var(--text-dim); letter-spacing: 0.08em; text-transform: uppercase; }
    .code-box .cb-code { font-family: Fraunces, serif; font-weight: 600; font-size: 26px; letter-spacing: 0.06em; margin-top: 4px; color: var(--primary); }
    .dead { text-align: center; padding: 40px 20px; color: var(--text-dim); }
    .dead h1 { font-family: Fraunces, serif; font-weight: 600; font-size: 24px; color: var(--text); margin-bottom: 10px; }
    footer { color: var(--text-muted); font-size: 12px; padding: 20px; text-align: center; }
    .err { background: #fee2e2; color: #dc2626; border-radius: 10px; padding: 10px 14px; font-size: 14px; }
  </style>
</head>
<body>
  <header>
    <div class="header-inner">
      <img src="/zb-logo.jpg" alt="Samaya" />
      <span>
        <span class="brand-name">Samaya</span>
        <span class="brand-sub">Косметология · Каспийск</span>
      </span>
    </div>
  </header>
  <main>${body}</main>
  <footer>© Samaya · Клиника эстетической медицины</footer>
</body>
</html>`;
}

function discountLabel(c: CouponRow): string {
  return c.discount_amount != null ? `−${fmtPrice(c.discount_amount)}` : `−${c.discount_pct}%`;
}

function fmtDuration(min: number): string {
  const h = Math.floor(min / 60); const m = min % 60;
  return (h ? `${h} ч ` : '') + (m ? `${m} мин` : (h ? '' : `${min} мин`));
}

// Меню услуг акции — мини-карточки как в каталоге: миниатюра, название,
// длительность, цена; кликабельны, ведут на страницу услуги.
async function servicesListHtml(promoId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT s.name, s.price::float8 AS price, s.duration_minutes,
            s.slug, s.show_in_menu, s.image_path, s.color
     FROM bookings.promotion_services ps
     JOIN salons.services s ON s.id = ps.service_id
     WHERE ps.promo_id = $1 AND s.is_active = TRUE
     ORDER BY s.name`,
    [promoId],
  );
  if (!rows.length) {
    return `<div class="any">Купон действует на <b>любую услугу</b> клиники — <a class="more-link" href="/services">смотреть каталог</a>.</div>`;
  }
  const items = rows.map((s) => {
    const thumb = s.image_path
      ? `<img src="/media/${esc(s.image_path)}" alt="" loading="lazy" />`
      : `<span class="th-ph">${esc([...(s.name as string)][0] ?? '•').toUpperCase()}</span>`;
    const linked = s.show_in_menu && s.slug;
    const inner = `
      <span class="th">${thumb}</span>
      <span class="sv-body">
        <span class="sv-name">${esc(s.name)}</span>
        <span class="sv-meta">${esc(fmtDuration(s.duration_minutes))}${linked ? ' · подробнее →' : ''}</span>
      </span>
      <span class="p">${fmtPrice(s.price)}</span>`;
    return linked
      ? `<a class="svc-item" href="/services/${esc(s.slug)}">${inner}</a>`
      : `<div class="svc-item">${inner}</div>`;
  }).join('');
  return `<div class="svc-list">${items}</div>`;
}

function isExpired(c: CouponRow): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return !c.is_active || (!!c.valid_to && c.valid_to.slice(0, 10) < today);
}

// ===== Общая страница акции (одна ссылка на всех, счётчик переходов) =====
interface PromoRow {
  promo_id: string; promo_name: string; code: string; company_id: string;
  discount_pct: number | null; discount_amount: number | null;
  valid_from: string | null; valid_to: string | null; is_active: boolean;
}

async function loadPromoByPublicToken(ptoken: string): Promise<PromoRow | null> {
  const { rows } = await pool.query(
    `SELECT p.id AS promo_id, p.name AS promo_name, p.code, p.company_id,
            p.discount_pct::float8 AS discount_pct,
            p.discount_amount::float8 AS discount_amount,
            p.valid_from::text, p.valid_to::text, p.is_active
     FROM bookings.promotions p WHERE p.public_token = $1`,
    [ptoken],
  );
  return rows[0] ?? null;
}

function promoAsCoupon(p: PromoRow): CouponRow {
  return { ...p, coupon_id: '', token: '', status: 'issued', client_name: null };
}

// GET /a/:ptoken — страница акции; каждый переход считается
router.get('/a/:ptoken', async (req, res, next) => {
  try {
    const p = await loadPromoByPublicToken(req.params.ptoken);
    if (!p) {
      return res.status(404).type('html').send(pageHtml('Акция не найдена — Samaya',
        `<div class="dead"><h1>Акция не найдена</h1><p>Проверьте ссылку — возможно, она скопирована не полностью.</p></div>`));
    }
    if (isExpired(promoAsCoupon(p))) {
      return res.status(410).type('html').send(pageHtml('Акция завершена — Samaya',
        `<div class="dead"><h1>Акция завершена</h1><p>«${esc(p.promo_name)}» уже закончилась. Загляните в <a class="more-link" href="/services">каталог услуг</a>.</p></div>`));
    }
    // Два счётчика: page_opens — все открытия, page_views — уникальные
    // посетители (первый заход браузера, дальше метка в cookie на год).
    // Боты и предпросмотры ссылок в мессенджерах не считаются вовсе:
    // WhatsApp/Telegram дёргают страницу при вставке ссылки в чат.
    const ua = String(req.headers['user-agent'] ?? '');
    const isBot = looksLikeBot(ua);
    if (!isBot) {
      const seenCookie = `pv_${p.promo_id.slice(0, 8)}`;
      const isFirstVisit = !(req.headers.cookie ?? '').includes(`${seenCookie}=1`);
      await pool.query(
        `UPDATE bookings.promotions
         SET page_opens = page_opens + 1,
             page_views = page_views + $2
         WHERE id = $1`,
        [p.promo_id, isFirstVisit ? 1 : 0],
      );
      if (isFirstVisit) {
        res.setHeader('Set-Cookie', `${seenCookie}=1; Max-Age=31536000; Path=/promo; SameSite=Lax`);
      }
    }
    const c = promoAsCoupon(p);
    const services = await servicesListHtml(p.promo_id);
    const validTo = p.valid_to ? `<span class="c-valid">Действует до ${fmtDate(p.valid_to)}</span>` : '';
    const top = `<div class="coupon-top">
      <div class="c-overline">Акция</div>
      <div class="c-amount">${esc(discountLabel(c))}</div>
      <div class="c-name">${esc(p.promo_name)}</div>
      ${validTo}
    </div>`;
    const claimForm = `
      <h2>На что действует скидка</h2>
      ${services}
      <form method="POST" action="/promo/a/${esc(req.params.ptoken)}/claim">
        ${req.query.err ? `<div class="err">Укажите имя и корректный телефон</div>` : ''}
        <div>
          <label for="f-name">Ваше имя</label>
          <input id="f-name" name="name" required maxlength="100" placeholder="Как к вам обращаться" />
        </div>
        <div>
          <label for="f-phone">Телефон</label>
          <input id="f-phone" name="phone" type="tel" required maxlength="20" value="+7 " inputmode="tel" placeholder="+7 ___ ___-__-__" />
        </div>
        <button type="submit">Получить скидку ${esc(discountLabel(c))}</button>
        <p class="hint">Оставьте контакты — скидка закрепится за вами, и администратор свяжется для записи. Нажимая кнопку, вы соглашаетесь на обработку персональных данных.</p>
      </form>
      ${contactHtml(await companyPhone(p.company_id), `Здравствуйте! Хочу узнать про акцию «${p.promo_name}».`)}`;
    const body = `<div class="coupon">${top}<div class="coupon-body">${claimForm}</div></div>`;
    return res.type('html').send(pageHtml(`${p.promo_name} — ${discountLabel(c)} — Samaya`, body));
  } catch (e) { return next(e); }
});

// POST /a/:ptoken/claim — посетитель страницы акции оставил контакты:
// создаётся (или переиспользуется по телефону) личный купон → редирект на него.
router.post('/a/:ptoken/claim', urlencoded({ extended: false, limit: '5kb' }), async (req, res, next) => {
  try {
    const p = await loadPromoByPublicToken(req.params.ptoken);
    if (!p || isExpired(promoAsCoupon(p))) {
      return res.redirect(303, `/promo/a/${encodeURIComponent(req.params.ptoken)}`);
    }
    const name = String(req.body?.name ?? '').trim().slice(0, 100);
    const phone = claimPhone(String(req.body?.phone ?? ''));
    if (!name || !phone || phone.replace(/\D/g, '').length < 10) {
      return res.redirect(303, `/promo/a/${encodeURIComponent(req.params.ptoken)}?err=1`);
    }
    // Один телефон — один купон на акцию (повторная отправка не задваивает аудиторию)
    const existing = await pool.query(
      `SELECT token FROM bookings.promo_coupons WHERE promo_id = $1 AND client_phone = $2 LIMIT 1`,
      [p.promo_id, phone],
    );
    if (existing.rows.length) {
      return res.redirect(303, `/promo/${encodeURIComponent(existing.rows[0].token)}`);
    }
    const token = crypto.randomBytes(8).toString('base64url');
    const clientId = await linkPromoClient(p.company_id, phone, name);
    await pool.query(
      `INSERT INTO bookings.promo_coupons
         (company_id, promo_id, token, label, status, opened_at, claimed_at, client_name, client_phone, client_id)
       VALUES ($1, $2, $3, 'со страницы акции', 'claimed', NOW(), NOW(), $4, $5, $6)`,
      [p.company_id, p.promo_id, token, name, phone, clientId],
    );
    return res.redirect(303, `/promo/${encodeURIComponent(token)}`);
  } catch (e) { return next(e); }
});

// GET /:token — лендинг купона
router.get('/:token', async (req, res, next) => {
  try {
    const c = await loadCoupon(req.params.token);
    if (!c) {
      return res.status(404).type('html').send(pageHtml('Купон не найден — Samaya',
        `<div class="dead"><h1>Купон не найден</h1><p>Проверьте ссылку — возможно, она скопирована не полностью.</p></div>`));
    }
    if (isExpired(c)) {
      return res.status(410).type('html').send(pageHtml('Купон недействителен — Samaya',
        `<div class="dead"><h1>Срок купона истёк</h1><p>Акция «${esc(c.promo_name)}» завершена. Загляните в <a class="more-link" href="/services">каталог услуг</a> — там много интересного.</p></div>`));
    }
    if (c.status === 'used') {
      return res.status(410).type('html').send(pageHtml('Купон использован — Samaya',
        `<div class="dead"><h1>Купон уже использован</h1><p>Этот купон был погашен. Следите за новыми акциями клиники.</p></div>`));
    }
    // Первое открытие — фиксируем для воронки
    if (c.status === 'issued') {
      await pool.query(
        `UPDATE bookings.promo_coupons SET status = 'opened', opened_at = NOW()
         WHERE id = $1 AND status = 'issued'`,
        [c.coupon_id],
      );
    }
    const services = await servicesListHtml(c.promo_id);
    const phone = await companyPhone(c.company_id);
    const couponCode = `${c.code}-${c.token.slice(0, 4).toUpperCase()}`;
    const contactsClaimed = contactHtml(phone,
      `Здравствуйте! У меня купон ${couponCode} по акции «${c.promo_name}». Хочу записаться.`);
    const contactsFresh = contactHtml(phone,
      `Здравствуйте! Хочу узнать про акцию «${c.promo_name}».`);
    const validTo = c.valid_to ? `<span class="c-valid">Действует до ${fmtDate(c.valid_to)}</span>` : '';
    const top = `<div class="coupon-top">
      <div class="c-overline">Персональный купон</div>
      <div class="c-amount">${esc(discountLabel(c))}</div>
      <div class="c-name">${esc(c.promo_name)}</div>
      ${validTo}
    </div>`;
    const claimedBlock = `
      <div class="ok-badge">✓ Купон закреплён за вами${c.client_name ? `, ${esc(c.client_name)}` : ''}</div>
      <div class="code-box">
        <div class="cb-label">Ваш код купона</div>
        <div class="cb-code">${esc(couponCode)}</div>
      </div>
      <p class="hint" style="margin-top:14px;">Купон одноразовый: назовите код администратору при записи или визите — скидка будет применена один раз.</p>
      ${contactsClaimed}
      <h2 style="margin-top:22px;">На что действует купон</h2>
      ${services}`;
    const claimForm = `
      <h2>На что действует купон</h2>
      ${services}
      <form method="POST" action="/promo/${esc(c.token)}/claim">
        ${req.query.err ? `<div class="err">Укажите имя и корректный телефон</div>` : ''}
        <div>
          <label for="f-name">Ваше имя</label>
          <input id="f-name" name="name" required maxlength="100" placeholder="Как к вам обращаться" />
        </div>
        <div>
          <label for="f-phone">Телефон</label>
          <input id="f-phone" name="phone" type="tel" required maxlength="20" value="+7 " inputmode="tel" placeholder="+7 ___ ___-__-__" />
        </div>
        <button type="submit">Забрать купон ${esc(discountLabel(c))}</button>
        <p class="hint">Оставьте контакты — купон закрепится за вами, и администратор свяжется для записи. Нажимая кнопку, вы соглашаетесь на обработку персональных данных.</p>
      </form>
      ${contactsFresh}`;
    const body = `<div class="coupon">${top}<div class="coupon-body">${c.status === 'claimed' ? claimedBlock : claimForm}</div></div>`;
    return res.type('html').send(pageHtml(`${c.promo_name} — купон ${discountLabel(c)} — Samaya`, body));
  } catch (e) { return next(e); }
});

// POST /:token/claim — клиент оставил контакты (обычная HTML-форма)
router.post('/:token/claim', urlencoded({ extended: false, limit: '5kb' }), async (req, res, next) => {
  try {
    const c = await loadCoupon(req.params.token);
    if (!c) return res.redirect(303, `/promo/${encodeURIComponent(req.params.token)}`);
    const name = String(req.body?.name ?? '').trim().slice(0, 100);
    const phoneRaw = String(req.body?.phone ?? '').trim();
    const phone = claimPhone(phoneRaw);
    if (!name || !phone || phone.replace(/\D/g, '').length < 10) {
      return res.redirect(303, `/promo/${encodeURIComponent(c.token)}?err=1`);
    }
    if (!isExpired(c) && (c.status === 'issued' || c.status === 'opened')) {
      const clientId = await linkPromoClient(c.company_id, phone, name);
      await pool.query(
        `UPDATE bookings.promo_coupons
         SET status = 'claimed', claimed_at = NOW(), client_name = $2, client_phone = $3,
             client_id = $4, opened_at = COALESCE(opened_at, NOW())
         WHERE id = $1 AND status IN ('issued', 'opened')`,
        [c.coupon_id, name, phone, clientId],
      );
    }
    return res.redirect(303, `/promo/${encodeURIComponent(c.token)}`);
  } catch (e) { return next(e); }
});

export default router;
