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
const router = Router();
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
 * POST /api/salons/ai/reply — решение по реальному входящему.
 *
 * Отдельно от /try: этот путь пишет журнал. Вызывается сервисом канала
 * (instagram, whatsapp), а не интерфейсом.
 */
router.post('/reply', async (req: ExpressRequest, res, next) => {
  try {
    const { text, thread_id, channel, client_name } = z.object({
      text: z.string().min(1).max(4000),
      thread_id: z.string().max(200).optional(),
      channel: z.string().max(32).optional(),
      client_name: z.string().max(200).optional(),
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
