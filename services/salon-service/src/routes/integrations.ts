import { Router } from 'express';
import type { Request as ExpressRequest } from 'express';
import { z } from 'zod';
import { ProxyAgent, Agent } from 'undici';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';

// Учётные данные внешних интеграций: сохранение и проверка токена.
//
// Главное правило модуля: значение токена НИКОГДА не уходит наружу. Ни в
// GET, ни в ответе на сохранение, ни в логах. Администратор видит маску
// («…a1b2»), срок годности и имя подключённого аккаунта — этого достаточно,
// чтобы понять, что подключено и не пора ли перевыпускать. Иначе токен
// доступа к переписке клиентов утёк бы в любой консоли браузера, открытой
// на странице настроек.
const router = Router();
router.use(authenticate);

// Владелец и администратор. Токен Instagram даёт доступ ко всей переписке
// клиентов, поэтому мастер его не меняет и не видит.
const manage = requireRole(['owner', 'admin']);

// Провайдеры, которые умеет хранить система. Закрытый список, а не
// свободная строка: иначе опечатка в имени провайдера молча создаст
// «подключение», которого никто не читает.
const PROVIDERS = ['instagram'] as const;
type Provider = (typeof PROVIDERS)[number];

function assertProvider(value: string): Provider {
  if (!(PROVIDERS as readonly string[]).includes(value)) {
    throw new HttpError(400, `Неизвестная интеграция: ${value}`, 'unknown_provider');
  }
  return value as Provider;
}

// Маска для показа в интерфейсе. Показываем только хвост: по первым
// символам токены Meta неразличимы, а хвост позволяет сверить «тот ли это
// токен, что я вставлял».
function mask(token: string | null): string | null {
  if (!token) return null;
  return token.length <= 8 ? '••••' : `••••${token.slice(-4)}`;
}

/**
 * GET /api/salons/integrations
 * Состояние всех интеграций. Без значений токенов.
 */
router.get('/', manage, async (req: ExpressRequest, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT provider, token, meta, expires_at, updated_at
         FROM salons.integration_credentials
        WHERE company_id = $1`,
      [req.auth!.company_id],
    );
    const byProvider = new Map(rows.map(r => [r.provider, r]));
    const out = PROVIDERS.map((p) => {
      const r = byProvider.get(p);
      if (!r?.token) return { provider: p, connected: false };
      // Протухший токен отдаём отдельным признаком, а не просто датой:
      // в интерфейсе это разные состояния — «подключено» и «истёк, нужен
      // новый», и администратор не должен вычислять это сам по дате.
      const expired = !!r.expires_at && new Date(r.expires_at) < new Date();
      return {
        provider: p,
        connected: true,
        expired,
        token_mask: mask(r.token),
        meta: r.meta ?? {},
        expires_at: r.expires_at,
        updated_at: r.updated_at,
      };
    });
    return res.json(out);
  } catch (e) { return next(e); }
});

const putSchema = z.object({
  // Нижняя граница в 20 символов отсекает случайную вставку обрывка:
  // настоящий токен Meta — больше сотни символов.
  token: z.string().min(20).max(1000),
});

/**
 * PUT /api/salons/integrations/:provider
 * Сохранить токен. В ответе — то же состояние, что отдаёт GET, без значения.
 */
router.put('/:provider', manage, async (req: ExpressRequest, res, next) => {
  try {
    const provider = assertProvider(req.params.provider);
    const { token } = putSchema.parse(req.body);
    const clean = token.trim();

    // Проверяем токен до сохранения: сохранённый нерабочий токен выглядит
    // в интерфейсе как «подключено» и выясняется только тогда, когда бот
    // молча не отвечает клиенту.
    const probe = await probeInstagram(clean);
    if (!probe.ok) {
      throw new HttpError(400, `Instagram отклонил токен: ${probe.error}`, 'token_rejected');
    }

    const { rows } = await pool.query(
      `INSERT INTO salons.integration_credentials
         (company_id, provider, token, meta, expires_at, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (company_id, provider) DO UPDATE SET
         token      = EXCLUDED.token,
         meta       = EXCLUDED.meta,
         expires_at = EXCLUDED.expires_at,
         updated_by = EXCLUDED.updated_by
       RETURNING provider, meta, expires_at, updated_at`,
      [
        // Сохраняем probe.token, а не введённый: при вводе пользовательского
        // токена здесь уже лежит обменянный токен страницы, и только им
        // можно отправлять сообщения.
        req.auth!.company_id, provider, probe.token,
        JSON.stringify(probe.meta), probe.expires_at, req.auth!.sub ?? null,
      ],
    );
    return res.json({
      ...rows[0],
      connected: true,
      expired: false,
      token_mask: mask(probe.token),
    });
  } catch (e) { return next(e); }
});

/**
 * DELETE /api/salons/integrations/:provider — отключить интеграцию.
 */
router.delete('/:provider', manage, async (req: ExpressRequest, res, next) => {
  try {
    const provider = assertProvider(req.params.provider);
    await pool.query(
      `DELETE FROM salons.integration_credentials WHERE company_id = $1 AND provider = $2`,
      [req.auth!.company_id, provider],
    );
    return res.json({ provider, connected: false });
  } catch (e) { return next(e); }
});

/**
 * POST /api/salons/integrations/:provider/check
 * Перепроверить уже сохранённый токен, не вводя его заново.
 */
router.post('/:provider/check', manage, async (req: ExpressRequest, res, next) => {
  try {
    const provider = assertProvider(req.params.provider);
    const { rows } = await pool.query(
      `SELECT token FROM salons.integration_credentials
        WHERE company_id = $1 AND provider = $2`,
      [req.auth!.company_id, provider],
    );
    const token = rows[0]?.token;
    if (!token) throw new HttpError(404, 'Токен не сохранён', 'not_connected');

    const probe = await probeInstagram(token);
    if (!probe.ok) return res.json({ ok: false, error: probe.error });

    // Результат проверки записываем: имя аккаунта и срок могли измениться
    // (токен перевыпущен в кабинете Meta, аккаунт переименован). Пишем и сам
    // token: проверка пользовательского токена возвращает обменянный токен
    // страницы, и он может быть свежее сохранённого.
    await pool.query(
      `UPDATE salons.integration_credentials
          SET meta = $3, expires_at = $4, token = $5
        WHERE company_id = $1 AND provider = $2`,
      [req.auth!.company_id, provider, JSON.stringify(probe.meta), probe.expires_at, probe.token],
    );
    return res.json({ ok: true, meta: probe.meta, expires_at: probe.expires_at });
  } catch (e) { return next(e); }
});

type Probe =
  // token — то, что надо СОХРАНИТЬ. Может отличаться от введённого:
  // пользовательский токен обменивается на токен страницы.
  | { ok: true; token: string; meta: Record<string, unknown>; expires_at: Date | null }
  | { ok: false; error: string };

const IG_VERSION = process.env.IG_API_VERSION || 'v23.0';

// Выход к Meta — через тот же VLESS-мост, что и у WhatsApp.
//
// Сервер стоит в Нидерландах, и прямого маршрута до graph.facebook.com с
// него нет: DNS отдаёт ENOTFOUND, запрос падает с «fetch failed». Соседние
// хосты (google.com, api.typesafe.ai) при этом резолвятся — то есть дело не
// в сломанном DNS, а в блокировке именно доменов Meta на пути.
//
// Тот же мост (host.docker.internal:1181 → xray → VLESS) уже используется
// браузером WhatsApp и по той же второй причине: клиника и аккаунт
// российские, а выход с голландского адреса для Meta выглядит как угон
// аккаунта. Проверено на сервере: через xray graph.facebook.com отвечает за
// 0.76 с, напрямую — не резолвится вовсе.
const IG_PROXY = process.env.INSTAGRAM_SOCKS_PROXY || '';
// Явный агент обязателен в обоих случаях. В окружении контейнера заданы
// системные HTTPS_PROXY/http_proxy (порт 1080 — прямой выход), и undici
// подхватывает их молча. Без явного указания запрос к Meta ушёл бы не в
// VLESS-мост, а в системный прокси, то есть голландским адресом — ровно
// то, из-за чего блокируют аккаунт.
const proxyAgent = IG_PROXY ? new ProxyAgent(IG_PROXY) : new Agent({ connect: { timeout: 10_000 } });

/**
 * Проверить токен и привести его к пригодному для отправки виду.
 *
 * У Meta два пути к Direct, и по виду токена они неразличимы:
 *   graph.instagram.com — Instagram Login, токен пользователя Instagram;
 *   graph.facebook.com  — через привязанную страницу Facebook, токен страницы.
 *
 * Отдельная тонкость второго пути: отправлять сообщения умеет только токен
 * СТРАНИЦЫ. Из Graph API Explorer по умолчанию выдаётся токен пользователя,
 * и на нём поле instagram_business_account не существует — Meta отвечает
 * «(#100) Tried accessing nonexisting field». Поэтому пользовательский токен
 * здесь не отвергается, а обменивается: через /me/accounts находится
 * страница с привязанным Instagram, и дальше хранится её токен.
 */
async function probeInstagram(token: string): Promise<Probe> {
  const ask = async (url: string) => {
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(15_000),
        // @ts-expect-error — dispatcher не описан в типах DOM fetch,
        // но поддерживается рантаймом Node (undici).
        dispatcher: proxyAgent,
      });
      return { status: r.status, body: await r.json().catch(() => ({})) as Record<string, any> };
    } catch (e) {
      // Причина сетевого сбоя лежит в cause: без неё в интерфейс попадает
      // бесполезное «fetch failed», по которому нельзя отличить недоступный
      // хост от отвергнутого токена.
      const err = e as Error & { cause?: { code?: string } };
      const code = err.cause?.code;
      const detail = code === 'ENOTFOUND'
        ? 'нет маршрута до серверов Meta (проверьте INSTAGRAM_SOCKS_PROXY)'
        : err.message;
      return { status: 0, body: { error: { message: detail } } };
    }
  };

  // Срок жизни токена. Короткоживущий умрёт через час-два, и бот замолчит
  // посреди рабочего дня — это надо знать при сохранении, а не по жалобам.
  const lifetime = async (t: string) => {
    const dbg = await ask(
      `https://graph.facebook.com/${IG_VERSION}/debug_token?input_token=${encodeURIComponent(t)}&access_token=${encodeURIComponent(token)}`,
    );
    const d = dbg.body?.data;
    return {
      expires_at: d?.expires_at ? new Date(d.expires_at * 1000) : null,
      scopes: d?.scopes ?? [],
      type: d?.type ?? null,
    };
  };

  // Путь 1: Instagram Login.
  const ig = await ask(
    `https://graph.instagram.com/${IG_VERSION}/me?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`,
  );
  if (ig.status === 200 && ig.body.id) {
    return {
      ok: true,
      token,
      expires_at: null,
      meta: {
        transport: 'instagram_login',
        host: 'graph.instagram.com',
        api_version: IG_VERSION,
        ig_id: ig.body.id,
        username: ig.body.username ?? null,
        account_type: ig.body.account_type ?? null,
        checked_at: new Date().toISOString(),
      },
    };
  }

  // Путь 2: через страницу Facebook. Сначала выясняем, кому принадлежит
  // токен, НЕ запрашивая полей страницы: на токене пользователя такой
  // запрос падает с #100 и скрывает настоящую картину.
  const who = await ask(
    `https://graph.facebook.com/${IG_VERSION}/me?fields=id,name&access_token=${encodeURIComponent(token)}`,
  );
  if (who.status !== 200 || !who.body.id) {
    const msg = who.body?.error?.message || ig.body?.error?.message
      || 'токен не принят ни одним из путей Meta API';
    return { ok: false, error: msg };
  }

  // Вариант А: это уже токен страницы — у неё поле есть.
  const asPage = await ask(
    `https://graph.facebook.com/${IG_VERSION}/me?fields=instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`,
  );
  const linked = asPage.body?.instagram_business_account;
  if (asPage.status === 200 && linked?.id) {
    const life = await lifetime(token);
    return {
      ok: true,
      token,
      expires_at: life.expires_at,
      meta: {
        transport: 'facebook_page',
        host: 'graph.facebook.com',
        api_version: IG_VERSION,
        token_kind: 'page',
        page_id: who.body.id,
        page_name: who.body.name ?? null,
        ig_id: linked.id,
        username: linked.username ?? null,
        scopes: life.scopes,
        checked_at: new Date().toISOString(),
      },
    };
  }

  // Вариант Б: токен пользователя. Ищем среди его страниц ту, к которой
  // привязан Instagram, и забираем ТОКЕН СТРАНИЦЫ: пользовательским
  // отправить сообщение нельзя.
  const accounts = await ask(
    `https://graph.facebook.com/${IG_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`,
  );
  const pages: any[] = accounts.body?.data ?? [];
  if (!pages.length) {
    return {
      ok: false,
      error: 'это токен пользователя, но у него нет ни одной страницы Facebook. '
        + 'Нужна страница с привязанным аккаунтом Instagram Professional.',
    };
  }

  const page = pages.find(p => p.instagram_business_account?.id);
  if (!page) {
    const names = pages.map(p => p.name).filter(Boolean).join(', ');
    return {
      ok: false,
      error: `ни к одной из страниц (${names}) не привязан аккаунт Instagram Professional. `
        + 'Привязка делается в настройках страницы Facebook.',
    };
  }
  if (!page.access_token) {
    return {
      ok: false,
      error: 'у токена нет разрешения pages_show_list — без него не получить токен страницы',
    };
  }

  const life = await lifetime(page.access_token);
  return {
    ok: true,
    // Наружу и в хранилище уходит токен СТРАНИЦЫ, а не тот, что ввели.
    token: page.access_token,
    expires_at: life.expires_at,
    meta: {
      transport: 'facebook_page',
      host: 'graph.facebook.com',
      api_version: IG_VERSION,
      token_kind: 'page',
      // Признак обмена: в интерфейсе видно, что сохранён не введённый токен.
      exchanged_from: 'user_token',
      page_id: page.id,
      page_name: page.name ?? null,
      ig_id: page.instagram_business_account.id,
      username: page.instagram_business_account.username ?? null,
      scopes: life.scopes,
      checked_at: new Date().toISOString(),
    },
  };
}

export default router;
