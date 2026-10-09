import { Router } from 'express';
import type { Request as ExpressRequest } from 'express';
import { z } from 'zod';
import { ProxyAgent } from 'undici';
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
        req.auth!.company_id, provider, clean,
        JSON.stringify(probe.meta), probe.expires_at, req.auth!.sub ?? null,
      ],
    );
    return res.json({
      ...rows[0],
      connected: true,
      expired: false,
      token_mask: mask(clean),
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
    // (токен перевыпущен в кабинете Meta, аккаунт переименован).
    await pool.query(
      `UPDATE salons.integration_credentials
          SET meta = $3, expires_at = $4
        WHERE company_id = $1 AND provider = $2`,
      [req.auth!.company_id, provider, JSON.stringify(probe.meta), probe.expires_at],
    );
    return res.json({ ok: true, meta: probe.meta, expires_at: probe.expires_at });
  } catch (e) { return next(e); }
});

type Probe =
  | { ok: true; meta: Record<string, unknown>; expires_at: Date | null }
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
const proxyAgent = IG_PROXY ? new ProxyAgent(IG_PROXY) : undefined;

/**
 * Проверить токен Instagram.
 *
 * У Meta два разных пути к Direct, и по виду токена они неразличимы:
 *   graph.instagram.com — Instagram Login, токен пользователя Instagram;
 *   graph.facebook.com  — через привязанную страницу Facebook, токен страницы.
 * Пробуем оба и запоминаем в meta, какой сработал: от этого зависит, на
 * какой хост сервис будет отправлять ответы клиентам.
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

  // Путь 1: Instagram Login.
  const ig = await ask(
    `https://graph.instagram.com/${IG_VERSION}/me?fields=id,username,account_type&access_token=${encodeURIComponent(token)}`,
  );
  if (ig.status === 200 && ig.body.id) {
    return {
      ok: true,
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

  // Путь 2: через страницу Facebook.
  const fb = await ask(
    `https://graph.facebook.com/${IG_VERSION}/me?fields=id,name,instagram_business_account{id,username}&access_token=${encodeURIComponent(token)}`,
  );
  if (fb.status === 200 && fb.body.id) {
    const linked = fb.body.instagram_business_account;
    if (!linked?.id) {
      return { ok: false, error: 'токен принят, но к нему не привязан аккаунт Instagram Professional' };
    }
    // Срок жизни: короткоживущий токен умрёт через час, и бот замолчит.
    // Узнаём это сейчас, а не по жалобам клиентов.
    const dbg = await ask(
      `https://graph.facebook.com/${IG_VERSION}/debug_token?input_token=${encodeURIComponent(token)}&access_token=${encodeURIComponent(token)}`,
    );
    const exp = dbg.body?.data?.expires_at;
    return {
      ok: true,
      expires_at: exp ? new Date(exp * 1000) : null,
      meta: {
        transport: 'facebook_page',
        host: 'graph.facebook.com',
        api_version: IG_VERSION,
        page_id: fb.body.id,
        page_name: fb.body.name ?? null,
        ig_id: linked.id,
        username: linked.username ?? null,
        scopes: dbg.body?.data?.scopes ?? [],
        checked_at: new Date().toISOString(),
      },
    };
  }

  const msg = fb.body?.error?.message || ig.body?.error?.message || 'токен не принят ни одним из путей Meta API';
  return { ok: false, error: msg };
}

export default router;
