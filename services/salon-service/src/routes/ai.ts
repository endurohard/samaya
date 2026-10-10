import { Router } from 'express';
import type { Request as ExpressRequest } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { authenticate, requireRole, HttpError } from '../middleware';
import { classify, logDecision, loadTemplates, render } from '../ai/classifier';

// Шаблоны ответов ИИ-ассистента: список, правка, проверка.
//
// Доступ под owner/admin: шаблон — это то, что клиника говорит клиенту от
// своего имени, и правка цены или формулировки о показаниях не должна быть
// доступна каждому сотруднику.
//
// Исключение — /reply: его вызывает не человек, а сервис канала
// (instagram-service) при входящем сообщении, и пользовательского JWT там
// нет. Для него отдельная проверка по внутреннему токену, и роутер
// подключается ДО общей authenticate.
const router = Router();

const INTERNAL_TOKEN = process.env.INTERNAL_TOKEN || '';
const DEFAULT_COMPANY_ID = process.env.DEFAULT_COMPANY_ID || '';

/**
 * Пропускает либо сервис по внутреннему токену, либо обычного пользователя
 * по JWT. Компания для сервисного вызова берётся из окружения: у сервиса
 * нет своей компании, а канал в системе один.
 */
async function serviceOrUser(req: ExpressRequest, res: any, next: any) {
  const h = req.headers.authorization;
  if (INTERNAL_TOKEN && h === `Bearer ${INTERNAL_TOKEN}`) {
    req.auth = {
      sub: 'service:instagram', company_id: DEFAULT_COMPANY_ID,
      role: 'service', type: 'access',
    } as any;
    return next();
  }
  return authenticate(req as any, res, next);
}

router.post('/reply', serviceOrUser, async (req: ExpressRequest, res, next) => {
  try {
    const { text, thread_id, channel, client_name } = z.object({
      text: z.string().min(1).max(4000),
      // nullable, а не только optional: канал присылает null, когда диалог
      // ещё не связан с карточкой клиента — это норма, а не ошибка.
      // optional() один такое значение отвергает, и весь разбор падает с 400.
      thread_id: z.string().max(200).nullish(),
      channel: z.string().max(32).nullish(),
      client_name: z.string().max(200).nullish(),
    }).parse(req.body);

    const companyId = req.auth!.company_id;
    const d = await classify(companyId, text, client_name);
    await logDecision(companyId, d, {
      channel: channel ?? 'instagram',
      threadId: thread_id ?? null,
      incoming: text,
    });

    return res.json({
      ok: d.ok, topic: d.topic, confidence: d.confidence,
      action: d.action, reply: d.reply, reason: d.reason,
    });
  } catch (e) { return next(e); }
});

// Всё остальное — только для вошедшего пользователя.
router.use(authenticate);
const manage = requireRole(['owner', 'admin']);

const templateSchema = z.object({
  // Латиница и подчёркивания: ключ уходит в запрос к классификатору как
  // идентификатор варианта, пробелы и кириллица там только мешают.
  topic: z.string().min(2).max(64).regex(/^[a-z][a-z0-9_]*$/,
    'ключ темы: латиница в нижнем регистре, цифры и подчёркивания'),
  title: z.string().min(1).max(200),
  matcher: z.string().min(10).max(2000),
  body: z.string().min(1).max(2000),
  autosend: z.boolean().optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
});

/** GET /api/salons/ai/templates — все шаблоны компании. */
router.get('/templates', manage, async (req: ExpressRequest, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, topic, title, matcher, body, autosend, enabled, sort_order, updated_at
         FROM ai.reply_templates
        WHERE company_id = $1
        ORDER BY sort_order, title`,
      [req.auth!.company_id],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

/** POST /api/salons/ai/templates — создать шаблон. */
router.post('/templates', manage, async (req: ExpressRequest, res, next) => {
  try {
    const t = templateSchema.parse(req.body);
    const { rows } = await pool.query(
      `INSERT INTO ai.reply_templates
         (company_id, topic, title, matcher, body, autosend, enabled, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id, topic, title, matcher, body, autosend, enabled, sort_order, updated_at`,
      [
        req.auth!.company_id, t.topic, t.title, t.matcher, t.body,
        t.autosend ?? false, t.enabled ?? true, t.sort_order ?? 100,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    // Понятное сообщение вместо текста нарушения уникального индекса:
    // администратор видит его прямо в форме.
    if ((e as any)?.code === '23505') {
      return next(new HttpError(409, 'Тема с таким ключом уже есть — выберите другой ключ', 'duplicate_topic'));
    }
    return next(e);
  }
});

/** PUT /api/salons/ai/templates/:id — изменить шаблон. */
router.put('/templates/:id', manage, async (req: ExpressRequest, res, next) => {
  try {
    const t = templateSchema.partial().parse(req.body);
    const fields: string[] = [];
    const values: unknown[] = [req.params.id, req.auth!.company_id];
    for (const [k, v] of Object.entries(t)) {
      if (v === undefined) continue;
      values.push(v);
      fields.push(`${k} = $${values.length}`);
    }
    if (!fields.length) throw new HttpError(400, 'Нечего менять');

    const { rows } = await pool.query(
      `UPDATE ai.reply_templates SET ${fields.join(', ')}
        WHERE id = $1 AND company_id = $2
       RETURNING id, topic, title, matcher, body, autosend, enabled, sort_order, updated_at`,
      values,
    );
    if (!rows[0]) throw new HttpError(404, 'Шаблон не найден');
    return res.json(rows[0]);
  } catch (e) {
    if ((e as any)?.code === '23505') {
      return next(new HttpError(409, 'Тема с таким ключом уже есть — выберите другой ключ', 'duplicate_topic'));
    }
    return next(e);
  }
});

/** DELETE /api/salons/ai/templates/:id */
router.delete('/templates/:id', manage, async (req: ExpressRequest, res, next) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM ai.reply_templates WHERE id = $1 AND company_id = $2`,
      [req.params.id, req.auth!.company_id],
    );
    if (!rowCount) throw new HttpError(404, 'Шаблон не найден');
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

/**
 * POST /api/salons/ai/try — песочница.
 *
 * Прогнать произвольный текст через классификатор и увидеть, что ответил бы
 * бот. Нужна, чтобы проверять формулировки описаний до того, как они начнут
 * работать на живых клиентах: ошибка в описании темы видна только на
 * примерах, а не при чтении.
 *
 * В журнал не пишется: это проверка, а не разговор с клиентом.
 */
router.post('/try', manage, async (req: ExpressRequest, res, next) => {
  try {
    const { text, client_name } = z.object({
      text: z.string().min(1).max(2000),
      client_name: z.string().max(200).optional(),
    }).parse(req.body);

    const d = await classify(req.auth!.company_id, text, client_name);
    return res.json({
      ok: d.ok,
      topic: d.topic,
      title: d.template?.title ?? null,
      confidence: d.confidence,
      action: d.action,
      reply: d.reply,
      reason: d.reason,
      probabilities: d.probabilities,
    });
  } catch (e) { return next(e); }
});

/**
 * GET /api/salons/ai/channel — режим канала.
 *
 * Режим обкатки: ассистент отвечает только перечисленным аккаунтам.
 * Пока клиника присматривается к ответам, это единственный безопасный
 * способ проверить поведение на живых сообщениях.
 */
router.get('/channel', manage, async (req: ExpressRequest, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT test_mode, test_users, updated_at
         FROM ai.channel_settings
        WHERE company_id = $1 AND channel = 'instagram'`,
      [req.auth!.company_id],
    );
    return res.json(rows[0] ?? { test_mode: false, test_users: [], updated_at: null });
  } catch (e) {
    return next(e);
  }
});

/** PUT /api/salons/ai/channel — включить/выключить режим обкатки. */
router.put('/channel', manage, async (req: ExpressRequest, res, next) => {
  try {
    const body = z.object({
      test_mode: z.boolean().optional(),
      // Ники принимаем и строкой через запятую (как вводит человек), и
      // массивом (как шлёт интерфейс). Собачку снимаем: её ставят по
      // привычке, а сравнение идёт с «голым» ником из профиля.
      test_users: z.union([z.string(), z.array(z.string())]).optional(),
    }).parse(req.body);

    const users = body.test_users === undefined ? undefined
      : (Array.isArray(body.test_users) ? body.test_users : body.test_users.split(','))
          .map(s => s.trim().replace(/^@/, '').toLowerCase())
          .filter(Boolean);

    const { rows } = await pool.query(
      `INSERT INTO ai.channel_settings (company_id, channel, test_mode, test_users, updated_by)
            VALUES ($1, 'instagram', COALESCE($2, false), COALESCE($3, '{}'), $4)
       ON CONFLICT (company_id, channel) DO UPDATE
          SET test_mode  = COALESCE($2, ai.channel_settings.test_mode),
              test_users = COALESCE($3, ai.channel_settings.test_users),
              updated_by = $4
      RETURNING test_mode, test_users, updated_at`,
      [req.auth!.company_id, body.test_mode ?? null, users ?? null, req.auth!.sub],
    );
    return res.json(rows[0]);
  } catch (e) {
    return next(e);
  }
});

/** GET /api/salons/ai/log — журнал решений. */
router.get('/log', manage, async (req: ExpressRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 50, 200);
    const { rows } = await pool.query(
      `SELECT l.id, l.channel, l.thread_id, l.incoming, l.topic, l.confidence,
              l.action, l.reply, l.reason, l.created_at, t.title
         FROM ai.reply_log l
         LEFT JOIN ai.reply_templates t ON t.id = l.template_id
        WHERE l.company_id = $1
        ORDER BY l.created_at DESC
        LIMIT $2`,
      [req.auth!.company_id, limit],
    );
    return res.json({ items: rows });
  } catch (e) { return next(e); }
});

/**
 * GET /api/salons/ai/status — состояние ассистента для интерфейса.
 *
 * Отвечает на вопрос «почему бот молчит» одним запросом: есть ли ключ
 * классификатора, сколько шаблонов включено, сколько из них отправляются
 * сами.
 */
router.get('/status', manage, async (req: ExpressRequest, res, next) => {
  try {
    const templates = await loadTemplates(req.auth!.company_id);
    return res.json({
      classifier_ready: !!process.env.TYPESAFE_API_KEY,
      model: process.env.JEV_MODEL || 'jev-latest',
      auto_confidence: Number(process.env.AI_AUTO_CONFIDENCE || 0.85),
      templates_enabled: templates.length,
      templates_autosend: templates.filter(t => t.autosend).length,
    });
  } catch (e) { return next(e); }
});

export default router;
