import { Router } from 'express';
import type { Request as ExpressRequest } from 'express';
import { z } from 'zod';
import { pool } from '../db';
import { notifyNeedsReply, sendTelegram, telegramTarget, tgDispatcher } from '../ai/telegram';
import { rememberNotification } from '../ai/telegram-replies';
import { authenticate, requireRole, requirePermission, HttpError } from '../middleware';
import { classify, logDecision, loadTemplates, render } from '../ai/classifier';
import type { Decision } from '../ai/classifier';
import {
  handleMessage as handlePriceMessage, isCollecting, isCitySwitch, isPriceDialogEnabled,
  resetState as resetPriceState,
  loadZoneCatalog,
  PriceOutcome,
} from '../ai/price-dialog';
import { looksLikeServiceInterest, renderPrices } from '../ai/price';
import { legsIntroFor, markIntroSent, LEGS_INTRO_TOPIC } from '../ai/intro';
import { parseParts } from '../ai/parts';
import type { ReplyPart } from '../ai/parts';

/**
 * Ключ темы, по которой запускается сбор города, веса и зоны.
 *
 * Берётся из окружения: тему владелец заводит сам в админке, и ключ
 * генерируется из названия. Значение по умолчанию — ключ существующей
 * боевой темы «Цена лазерной липосакции».
 */
const PRICE_TOPIC = process.env.AI_PRICE_TOPIC || 'liposakciya_ruk';

/**
 * Превратить итог разговора о цене в обычное решение ассистента, чтобы
 * журнал и ответ каналу были такими же, как у шаблонных тем.
 *
 * Цена и вопросы уходят клиенту сами (владелец выбрал автоотправку):
 * текст собран по таблице прайса, выдумать в нём нечего. Передача
 * человеку — всегда черновик без текста, чтобы администратор написал сам.
 */
function priceOutcomeToDecision(out: PriceOutcome, base?: Decision): Decision {
  const common = {
    ok: true as const,
    topic: PRICE_TOPIC,
    template: base?.template ?? null,
    confidence: base?.confidence ?? 1,
    probabilities: base?.probabilities,
  };
  if (out.kind === 'handover') {
    return {
      ...common, action: 'draft', reply: null,
      reason: out.reason ?? 'нужен администратор',
    };
  }
  return {
    ...common, action: 'sent', reply: out.reply,
    reason: out.reason,
  };
}

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
    const ch = channel ?? 'instagram';

    /**
     * Ответ каналу. Единая точка, потому что вступление с фотографиями зон
     * обязано уехать из ЛЮБОЙ ветки — и когда бот называет цену, и когда
     * отдаёт разговор администратору. Разложенный по четырём return'ам,
     * он потерялся бы в той ветке, которую забыли поправить.
     */
    const reply_parts: ReplyPart[] = thread_id
      ? await legsIntroFor({ companyId, channel: ch, threadId: thread_id, text })
        .catch((e) => {
          // Сбой вступления не должен превращаться в молчание: обычный
          // ответ клиенту важнее картинок.
          console.error('[ai] вступление не собрано:', (e as Error).message);
          return [] as ReplyPart[];
        })
      : [];
    const respond = (d: Decision) => res.json({
      ok: d.ok, topic: d.topic, confidence: d.confidence,
      action: d.action, reply: d.reply, reason: d.reason,
      // Канал отправляет их ПЕРЕД reply и подтверждает отметкой
      // (POST /ai/intro-sent) — иначе при выключенном автоответе схемы
      // зон были бы помечены отправленными, не уйдя клиенту.
      reply_parts,
      intro_key: reply_parts.length ? LEGS_INTRO_TOPIC : null,
    });

    // Разговор о цене ведётся отдельно от классификатора: он помнит, что
    // клиент уже назвал город, вес или зону. Проверка стоит ПЕРЕД
    // классификатором, потому что короткие ответы («Москва», «80»,
    // «живот») сами по себе не похожи на вопрос о цене и ушли бы в
    // manual_review, а клиент получил бы третий раз те же три вопроса.
    //
    // Но выключенная владельцем тема обязана гасить и опросник: иначе
    // выключатель в админке ничего не делает, а ассистент продолжает
    // называть цены.
    const priceOn = await isPriceDialogEnabled(companyId);
    if (thread_id && priceOn) {
      // Смена города после уже названной цены («а в Каспийске?») — тот же
      // модуль, но условие отдельное: сбор ответов закрыт, а пересчитать по
      // прайсу другого города надо, не переспрашивая зоны и вес заново.
      const collecting = await isCollecting(companyId, ch, thread_id)
        || await isCitySwitch(companyId, ch, thread_id, text);
      if (collecting) {
        const out = await handlePriceMessage({
          companyId, channel: ch, threadId: thread_id, text, fresh: false,
        });
        if (out.kind !== 'none') {
          const decision = priceOutcomeToDecision(out);
          await logDecision(companyId, decision, {
            channel: ch, threadId: thread_id, incoming: text,
          });
          if (out.kind === 'handover') {
            void notifyNeedsReply({
              channel: ch,
              who: client_name || '#' + thread_id,
              question: text,
              reason: out.reason ?? null,
              draft: null,
            }).catch(() => {});
          }
          return respond(decision);
        }
      }
    }

    const d = await classify(companyId, text, client_name);

    // Классификатор не понял тему, но сообщение похоже на интерес к услуге
    // («Услуга», «Липосакция», «живот») — ведём в опросник цены, а не в
    // черновик администратору. Без этого разговор обрывался сразу после
    // приветствия: бот сам спрашивает «услуга, стоимость или запись?», а
    // ответ на свой же вопрос разобрать не мог, потому что классификатор
    // видит одно сообщение без контекста.
    if (
      thread_id && priceOn &&
      (!d.ok || d.topic === 'manual_review') &&
      looksLikeServiceInterest(text)
    ) {
      const out = await handlePriceMessage({
        companyId, channel: ch, threadId: thread_id, text, fresh: true,
      });
      if (out.kind !== 'none') {
        const decision = priceOutcomeToDecision(out, d.ok ? d : undefined);
        await logDecision(companyId, decision, {
          channel: ch, threadId: thread_id, incoming: text,
        });
        if (out.kind === 'handover') {
          void notifyNeedsReply({
            channel: ch,
            who: client_name || '#' + thread_id,
            question: text,
            reason: out.reason ?? null,
            draft: null,
          }).catch(() => {});
        }
        return respond(decision);
      }
    }

    // Тема цены распознана — запускаем сбор ответов вместо шаблонного
    // текста. Шаблон остаётся на случай, когда идентификатора диалога нет
    // (ручная проверка из админки): состояние хранить негде.
    if (d.ok && d.topic === PRICE_TOPIC && d.action !== 'skipped' && thread_id && priceOn) {
      const out = await handlePriceMessage({
        companyId, channel: ch, threadId: thread_id, text, fresh: true,
      });
      if (out.kind !== 'none') {
        const decision = priceOutcomeToDecision(out, d);
        await logDecision(companyId, decision, {
          channel: ch, threadId: thread_id, incoming: text,
        });
        if (out.kind === 'handover') {
          void notifyNeedsReply({
            channel: ch,
            who: client_name || '#' + thread_id,
            question: text,
            reason: out.reason ?? null,
            draft: null,
          }).catch(() => {});
        }
        return respond(decision);
      }
    }
    await logDecision(companyId, d, {
      channel: channel ?? 'instagram',
      threadId: thread_id ?? null,
      incoming: text,
    });

    // Уведомление менеджерам: всё, что ассистент не отправил сам и не
    // пропустил намеренно, ждёт человека. Шлём ПОСЛЕ ответа каналу —
    // сбой Telegram не должен задерживать обработку входящего.
    const needsHuman = d.action !== 'sent' && d.action !== 'skipped';
    if (needsHuman) {
      const who = client_name || (thread_id ? '#' + thread_id : 'неизвестный');
      void notifyNeedsReply({
        channel: channel ?? 'instagram',
        who,
        question: text,
        reason: d.reason ?? null,
        draft: d.reply ?? null,
      }).then(async (r) => {
        // Причину пишем всегда: «не настроено» и «бот выгнан из группы» —
        // разные проблемы, а снаружи обе выглядят как тишина в Telegram.
        if (!r.ok) {
          if (r.reason !== 'группа не настроена') {
            console.warn('[ai] уведомление в Telegram не ушло:', r.reason);
          }
          return;
        }
        // Запоминаем связь «уведомление → диалог»: по ней ответ менеджера
        // реплаем попадёт тому клиенту, о котором уведомление.
        if (r.messageId && r.chatId && thread_id) {
          await rememberNotification({
            chatId: r.chatId,
            messageId: r.messageId,
            channel: channel ?? 'instagram',
            threadKey: thread_id,
            who,
          }).catch((e) => console.warn('[ai] связь уведомления не сохранена:', e.message));
        }
      });
    }

    return respond(d);
  } catch (e) { return next(e); }
});

/**
 * POST /api/salons/ai/intro-sent — канал подтвердил отправку вступления.
 *
 * Отметка ставится ЗДЕСЬ, а не в момент решения в /reply: там отправки ещё
 * не было. При выключенном автоответе или отказе Meta отметка «уже
 * отправляли» заблокировала бы схемы зон навсегда, и клиент не получил бы
 * их никогда — молча, без единой строки в логе.
 */
router.post('/intro-sent', serviceOrUser, async (req: ExpressRequest, res, next) => {
  try {
    const { thread_id, channel, intro_key } = z.object({
      thread_id: z.string().min(1).max(200),
      channel: z.string().max(32).nullish(),
      intro_key: z.string().max(64).nullish(),
    }).parse(req.body);

    await markIntroSent(
      req.auth!.company_id, channel ?? 'instagram', thread_id,
      intro_key ?? LEGS_INTRO_TOPIC,
    );
    return res.json({ ok: true });
  } catch (e) { return next(e); }
});

// Уведомление о вложении без текста.
//
// Классификатор здесь не зовём: разбирать нечего, темы у фото нет. Но менеджер
// должен узнать о присланном файле — иначе фото зоны лежит в CRM незамеченным,
// пока кто-нибудь не откроет переписку.
router.post('/notify-media', serviceOrUser, async (req: ExpressRequest, res, next) => {
  try {
    const { thread_id, channel, client_name, kind } = z.object({
      thread_id: z.string().max(200).nullish(),
      channel: z.string().max(32).nullish(),
      client_name: z.string().max(200).nullish(),
      kind: z.string().max(32).nullish(),
    }).parse(req.body);

    const who = client_name || (thread_id ? '#' + thread_id : 'неизвестный');
    const KIND: Record<string, string> = {
      image: 'фото', video: 'видео', audio: 'голосовое',
      voice: 'голосовое', share: 'пост', story_mention: 'упоминание в сторис',
    };
    const what = KIND[String(kind ?? '')] ?? 'вложение';

    const r = await notifyNeedsReply({
      channel: channel ?? 'instagram',
      who,
      question: `прислал(а) ${what} без текста`,
      reason: 'вложение — нужен администратор',
      draft: null,
    });

    if (r.ok && r.messageId && r.chatId && thread_id) {
      await rememberNotification({
        chatId: r.chatId,
        messageId: r.messageId,
        channel: channel ?? 'instagram',
        threadKey: thread_id,
        who,
      }).catch((e) => console.warn('[ai] связь уведомления не сохранена:', e.message));
    } else if (!r.ok && r.reason !== 'группа не настроена') {
      console.warn('[ai] уведомление о вложении не ушло:', r.reason);
    }

    return res.json({ ok: r.ok, reason: r.ok ? null : r.reason });
  } catch (e) { return next(e); }
});

/**
 * GET /api/salons/ai/shortcut/:code — текст и части по коду быстрого шаблона.
 *
 * Зовёт канал (instagram-service), когда менеджер набрал код в поле ответа.
 * Отдаёт и готовый текст, и разложенные части: у шаблона вступления про
 * ноги в теле есть фотографии, и отправить его одной строкой нельзя.
 *
 * Выключенные темы здесь доступны намеренно: `enabled` управляет
 * АВТОМАТИКОЙ, а не правом менеджера отправить текст руками. Заготовка без
 * текста отдаётся с пометкой — иначе клиенту уйдёт «(текст не заполнен)».
 */
router.get('/shortcut/:code', serviceOrUser, async (req: ExpressRequest, res, next) => {
  try {
    const code = String(req.params.code || '');
    if (!/^[0-9]{1,8}$/.test(code)) throw new HttpError(400, 'Код шаблона — только цифры');

    const { rows } = await pool.query(
      `SELECT topic, title, body FROM ai.reply_templates
        WHERE company_id = $1 AND shortcut = $2`,
      [req.auth!.company_id, code],
    );
    const t = rows[0];
    if (!t) throw new HttpError(404, `Шаблона с кодом ${code} нет`, 'shortcut_not_found');

    const parts = parseParts(t.body ?? '');
    // Цены в тексте — из прайса: сумма, написанная в шаблоне руками, это
    // второй источник правды, который разъезжается с прайсом молча.
    const catalog = await loadZoneCatalog(req.auth!.company_id);
    const rendered: ReplyPart[] = parts.map(p => (
      p.type === 'text' ? { ...p, text: renderPrices(p.text, catalog) } : p
    ));

    return res.json({
      ok: true,
      topic: t.topic,
      title: t.title,
      // Текст для подстановки в поле ответа — все текстовые части подряд.
      text: rendered.flatMap(p => (p.type === 'text' ? [p.text] : [])).join('\n\n'),
      parts: rendered,
      images: rendered.filter(p => p.type === 'image').length,
      filled: !/^\(текст не заполнен/.test(String(t.body || '').trim()),
    });
  } catch (e) { return next(e); }
});

// Всё остальное — только для вошедшего пользователя.
router.use(authenticate);
// Доступ по праву, а не по роли: шаблонами ответов занимается маркетолог
// (роль master), и жёсткое requireRole(['owner','admin']) не давало выдать
// ему доступ даже персональной галочкой. owner и admin получают 'ai.manage'
// по умолчанию, поэтому для них ничего не меняется.
const manage = requirePermission('ai.manage');
// Просмотр шаблонов и статуса — более слабое право: можно дать тому, кто
// только смотрит, не разрешая править тексты.
const view = requirePermission('ai.view', 'ai.manage');
// Журнал решений показывает переписку клиентов — отдельное право.
const viewLog = requirePermission('ai.view_log', 'ai.manage');

/**
 * Ключ темы из названия: транслитерация RU→latin.
 *
 * Отдельная функция, а не slugify() из slug.ts: там разделитель — дефис, он
 * годится для ЧПУ, но ключ темы уходит к классификатору идентификатором
 * варианта и обязан совпадать с /^[a-z][a-z0-9_]*$/ — то есть подчёркивания.
 *
 * Если название без латиницы и кириллицы (одни эмодзи или иероглифы), вернётся
 * пустая строка — вызывающий код подставит запасной ключ.
 */
export function topicKey(title: string): string {
  const MULTI: Record<string, string> = {
    ж: 'zh', ч: 'ch', ш: 'sh', щ: 'sch', ю: 'yu', я: 'ya', ё: 'yo', х: 'kh',
  };
  const SINGLE: Record<string, string> = {
    а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', з: 'z', и: 'i', й: 'j',
    к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
    у: 'u', ф: 'f', ц: 'c', ы: 'y', ь: '_', ъ: '_', э: 'e',
  };
  const out: string[] = [];
  for (const ch of title.toLowerCase()) {
    if (MULTI[ch] !== undefined) out.push(MULTI[ch]);
    else if (SINGLE[ch] !== undefined) out.push(SINGLE[ch]);
    else if (/[a-z0-9]/.test(ch)) out.push(ch);
    else out.push('_');
  }
  const key = out.join('')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
    .replace(/_+$/, '');
  // Ключ обязан начинаться с буквы: название вида «2 подбородок» дало бы
  // «2_podborodok», а это не проходит проверку.
  return /^[a-z]/.test(key) ? key : (key ? `t_${key}`.slice(0, 64) : '');
}

/** Свободный ключ темы: base, base_2, base_3, … */
async function freeTopic(companyId: string, base: string): Promise<string> {
  const root = base || `tema_${Date.now().toString(36)}`;
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? root : `${root}_${i}`.slice(0, 64);
    const { rowCount } = await pool.query(
      `SELECT 1 FROM ai.reply_templates WHERE company_id = $1 AND topic = $2`,
      [companyId, candidate],
    );
    if (!rowCount) return candidate;
  }
  return `${root}_${Date.now().toString(36)}`.slice(0, 64);
}

const templateSchema = z.object({
  // Латиница и подчёркивания: ключ уходит в запрос к классификатору как
  // идентификатор варианта, пробелы и кириллица там только мешают.
  //
  // Необязателен: при создании ключ генерируется из названия, и администратору
  // не нужно знать про транслитерацию вообще. Явно переданный — уважаем.
  topic: z.string().min(2).max(64).regex(/^[a-z][a-z0-9_]*$/,
    'ключ темы: латиница в нижнем регистре, цифры и подчёркивания').optional(),
  title: z.string().min(1).max(200),
  matcher: z.string().min(10).max(2000),
  body: z.string().min(1).max(2000),
  autosend: z.boolean().optional(),
  enabled: z.boolean().optional(),
  // Код быстрого шаблона: менеджер пишет «000» в поле ответа и получает
  // этот текст. Только цифры — коды набирают с телефона посреди диалога,
  // и буква в коде означала бы случайные срабатывания на обычном слове.
  // Пустая строка = «кода нет»: в базе лежит NULL, иначе несколько
  // шаблонов с '' нарушат уникальный индекс.
  shortcut: z.string().max(8).regex(/^[0-9]*$/, 'код шаблона: только цифры')
    .nullable().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
});

/**
 * Прайс: чтение и правка из админки.
 *
 * Правка цен — это деньги, поэтому гейт `manage`, тот же, что у шаблонов.
 * Чтение под `view`: администратору полезно видеть прайс рядом с перепиской.
 */
const zoneSchema = z.object({
  title: z.string().min(1).max(300),
  by_weight: z.boolean(),
  // Для весовой зоны цены живут в ступенях, здесь их быть не должно —
  // это же проверяет CHECK в таблице.
  price_kaspiysk: z.number().min(0).max(100_000_000).nullable().optional(),
  price_moscow: z.number().min(0).max(100_000_000).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  enabled: z.boolean().optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
  steps: z.array(z.object({
    // null — последняя ступень «и выше».
    max_weight: z.number().min(0).max(500).nullable(),
    price_kaspiysk: z.number().min(0).max(100_000_000),
    price_moscow: z.number().min(0).max(100_000_000),
  })).max(20).optional(),
});

/** GET /api/salons/ai/price — прайс со ступенями. */
router.get('/price', view, async (req: ExpressRequest, res, next) => {
  try {
    const companyId = req.auth!.company_id;
    const { rows: zones } = await pool.query(
      `SELECT zone_key, title, by_weight, price_kaspiysk, price_moscow,
              note, enabled, sort_order, updated_at
         FROM ai.price_zones WHERE company_id = $1
        ORDER BY sort_order, title`,
      [companyId],
    );
    const { rows: steps } = await pool.query(
      `SELECT zone_key, max_weight, price_kaspiysk, price_moscow, sort_order
         FROM ai.price_steps WHERE company_id = $1
        ORDER BY zone_key, sort_order`,
      [companyId],
    );
    const byZone = new Map<string, any[]>();
    for (const s of steps) {
      const list = byZone.get(s.zone_key) ?? [];
      list.push(s);
      byZone.set(s.zone_key, list);
    }
    return res.json({
      items: zones.map((z: any) => ({ ...z, steps: byZone.get(z.zone_key) ?? [] })),
    });
  } catch (e) { return next(e); }
});

/**
 * PUT /api/salons/ai/price/:zone — изменить зону прайса.
 *
 * Зона и её ступени переписываются одной транзакцией: без неё падение
 * между удалением старых ступеней и вставкой новых оставит весовую зону
 * без ступеней, то есть без цены, — и ассистент начнёт отдавать вопрос
 * администратору, хотя в админке всё выглядит заполненным.
 */
router.put('/price/:zone', manage, async (req: ExpressRequest, res, next) => {
  const client = await pool.connect();
  try {
    const body = zoneSchema.parse(req.body);
    const companyId = req.auth!.company_id;
    const zoneKey = String(req.params.zone);

    if (body.by_weight && !(body.steps && body.steps.length)) {
      throw new HttpError(400,
        'у зоны с ценой по весу должна быть хотя бы одна ступень', 'steps_required');
    }
    if (!body.by_weight && (body.price_kaspiysk == null || body.price_moscow == null)) {
      throw new HttpError(400,
        'укажите цену для обоих городов', 'price_required');
    }

    await client.query('BEGIN');
    const { rowCount } = await client.query(
      `UPDATE ai.price_zones
          SET title = $3, by_weight = $4,
              price_kaspiysk = $5, price_moscow = $6,
              note = $7,
              enabled = COALESCE($8, enabled),
              sort_order = COALESCE($9, sort_order)
        WHERE company_id = $1 AND zone_key = $2`,
      [companyId, zoneKey, body.title, body.by_weight,
       body.by_weight ? null : body.price_kaspiysk,
       body.by_weight ? null : body.price_moscow,
       body.note ?? null, body.enabled ?? null, body.sort_order ?? null],
    );
    if (!rowCount) throw new HttpError(404, 'зона прайса не найдена', 'zone_not_found');

    await client.query(
      `DELETE FROM ai.price_steps WHERE company_id = $1 AND zone_key = $2`,
      [companyId, zoneKey],
    );
    if (body.by_weight) {
      // Порядок ступеней задаёт их смысл («до 75», потом «до 99»), поэтому
      // сохраняем ровно тот, что прислала форма, а не сортируем по весу:
      // последняя ступень с max_weight = null обязана остаться последней.
      let i = 0;
      for (const s of body.steps!) {
        await client.query(
          `INSERT INTO ai.price_steps
             (company_id, zone_key, max_weight, price_kaspiysk, price_moscow, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [companyId, zoneKey, s.max_weight, s.price_kaspiysk, s.price_moscow, i++],
        );
      }
    }
    await client.query('COMMIT');
    return res.json({ ok: true });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    return next(e);
  } finally {
    client.release();
  }
});

/** GET /api/salons/ai/templates — все шаблоны компании. */
router.get('/templates', view, async (req: ExpressRequest, res, next) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, topic, title, matcher, body, autosend, enabled, shortcut, sort_order, updated_at
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
    // Ключ не прислали — делаем его из названия и подбираем свободный.
    // Генерация на сервере, а не только в форме: ключ обязан быть уникальным
    // внутри компании, а это знает только база.
    const topic = t.topic ?? await freeTopic(req.auth!.company_id, topicKey(t.title));
    const { rows } = await pool.query(
      `INSERT INTO ai.reply_templates
         (company_id, topic, title, matcher, body, autosend, enabled, shortcut, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id, topic, title, matcher, body, autosend, enabled, shortcut, sort_order, updated_at`,
      [
        req.auth!.company_id, topic, t.title, t.matcher, t.body,
        t.autosend ?? false, t.enabled ?? true,
        // Пустая строка из формы = «кода нет». В базе должен лежать NULL:
        // уникальный индекс частичный, и несколько '' его нарушат.
        t.shortcut || null,
        t.sort_order ?? 100,
      ],
    );
    return res.status(201).json(rows[0]);
  } catch (e) {
    // Понятное сообщение вместо текста нарушения уникального индекса:
    // администратор видит его прямо в форме.
    if ((e as any)?.code === '23505') {
      // Два разных нарушения уникальности: ключ темы и код шаблона.
      // Общее сообщение про ключ на дубле кода уводит в сторону —
      // администратор правит ключ, а виноват код.
      const dup = String((e as any)?.constraint || '');
      if (dup.includes('shortcut')) {
        return next(new HttpError(409, 'Этот код уже занят другим шаблоном — выберите свободный', 'duplicate_shortcut'));
      }
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
      // Пустой код из формы означает «снять код», а не «код = пустая
      // строка»: частичный уникальный индекс не допустит двух таких.
      values.push(k === 'shortcut' ? (v || null) : v);
      fields.push(`${k} = $${values.length}`);
    }
    if (!fields.length) throw new HttpError(400, 'Нечего менять');

    const { rows } = await pool.query(
      `UPDATE ai.reply_templates SET ${fields.join(', ')}
        WHERE id = $1 AND company_id = $2
       RETURNING id, topic, title, matcher, body, autosend, enabled, shortcut, sort_order, updated_at`,
      values,
    );
    if (!rows[0]) throw new HttpError(404, 'Шаблон не найден');
    return res.json(rows[0]);
  } catch (e) {
    if ((e as any)?.code === '23505') {
      // Два разных нарушения уникальности: ключ темы и код шаблона.
      // Общее сообщение про ключ на дубле кода уводит в сторону —
      // администратор правит ключ, а виноват код.
      const dup = String((e as any)?.constraint || '');
      if (dup.includes('shortcut')) {
        return next(new HttpError(409, 'Этот код уже занят другим шаблоном — выберите свободный', 'duplicate_shortcut'));
      }
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
 * Прогнать произвольный текст и увидеть, что ответил бы бот. Нужна, чтобы
 * проверять формулировки описаний до того, как они начнут работать на живых
 * клиентах: ошибка в описании темы видна только на примерах, а не при
 * чтении.
 *
 * Показывает ТО ЖЕ решение, что примет живой разговор. Раньше здесь
 * работал только классификатор, и песочница врала: «услуга лл ног»
 * показывалась как manual_review → «черновик администратору», хотя
 * настоящий бот на это сообщение запускает опросник цены и отвечает
 * прайсом. Владелец проверял формулировку по этой вкладке и видел
 * несуществующую проблему.
 *
 * В журнал не пишется и состояние разговора не сохраняется: это проверка,
 * а не разговор с клиентом. Поэтому проверяется первое сообщение — ответы
 * «Каспийск», «70» в песочнице смысла не имеют, им нужен живой диалог.
 */
router.post('/try', manage, async (req: ExpressRequest, res, next) => {
  try {
    const { text, client_name } = z.object({
      text: z.string().min(1).max(2000),
      client_name: z.string().max(200).optional(),
    }).parse(req.body);

    const companyId = req.auth!.company_id;
    const d = await classify(companyId, text, client_name);

    // Та же развилка, что в /reply: классификатор не понял тему, но
    // сообщение похоже на интерес к услуге — ведём в опросник цены.
    const priceOn = await isPriceDialogEnabled(companyId);
    if (priceOn && (!d.ok || d.topic === 'manual_review') && looksLikeServiceInterest(text)) {
      // Отдельный канал и одноразовый идентификатор: состояние ляжет в свою
      // строку и тут же удаляется, живые диалоги не затрагиваются.
      const tryThread = 'try-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
      const out = await handlePriceMessage({
        companyId, channel: 'try', threadId: tryThread, text, fresh: true,
      });
      // Строку состояния за собой убираем: иначе каждая проверка из админки
      // оставляла бы мусор в ai.price_dialog.
      await resetPriceState(companyId, 'try', tryThread).catch(() => {});
      if (out.kind !== 'none') {
        const decision = priceOutcomeToDecision(out, d.ok ? d : undefined);
        return res.json({
          ok: true,
          topic: decision.topic,
          title: 'Стоимость',
          confidence: decision.confidence ?? 1,
          action: decision.action,
          reply: decision.reply,
          reason: decision.reason,
          probabilities: d.probabilities,
        });
      }
    }

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
 * GET /api/salons/ai/telegram — куда слать уведомления и настроен ли бот.
 * Токен наружу не отдаём, только факт его наличия: страницу открывает
 * владелец, но пересылать секрет в браузер незачем.
 */
router.get('/telegram', view, async (req: ExpressRequest, res, next) => {
  try {
    const companyId = req.auth!.company_id;
    const { rows } = await pool.query(
      `SELECT channel, chat_id, thread_id, enabled
         FROM ai.telegram_targets
        WHERE company_id = $1
        ORDER BY channel`,
      [companyId],
    );
    const tok = await pool.query<{ token: string | null }>(
      `SELECT token FROM salons.integration_credentials
        WHERE company_id = $1 AND provider = 'telegram'`,
      [companyId],
    );
    const token = tok.rows[0]?.token || '';
    // Если бот видел ровно одну группу, отдаём её id — фронт подставит его
    // в пустые поля, чтобы владелец не переписывал четырнадцать цифр.
    const chats = await pool.query<{ chat_id: string }>(
      `SELECT DISTINCT chat_id FROM ai.telegram_seen WHERE company_id = $1::uuid`,
      [companyId],
    );
    return res.json({
      items: rows,
      bot_configured: !!token,
      bot_hint: token ? '…' + token.slice(-6) : '',
      only_chat_id: chats.rows.length === 1 ? chats.rows[0].chat_id : null,
    });
  } catch (e) { return next(e); }
});

/** PUT /api/salons/ai/telegram/:channel — группа и тема для канала. */
router.put('/telegram/:channel', manage, async (req: ExpressRequest, res, next) => {
  try {
    const channel = String(req.params.channel);
    if (channel !== 'instagram' && channel !== 'whatsapp') {
      throw new HttpError(400, 'канал может быть instagram или whatsapp');
    }
    const body = z.object({
      chat_id: z.string().max(64).nullish(),
      thread_id: z.number().int().min(1).nullish(),
      enabled: z.boolean().optional(),
    }).parse(req.body);

    const { rows } = await pool.query(
      `UPDATE ai.telegram_targets
          SET chat_id = COALESCE($3::text, chat_id),
              thread_id = $4::integer,
              enabled = COALESCE($5::boolean, enabled),
              updated_by = $6::uuid
        WHERE company_id = $1::uuid AND channel = $2
    RETURNING channel, chat_id, thread_id, enabled`,
      [req.auth!.company_id, channel, body.chat_id ?? null,
       body.thread_id ?? null, body.enabled ?? null, req.auth!.user_id],
    );
    return res.json(rows[0] || null);
  } catch (e) { return next(e); }
});

/**
 * GET /api/salons/ai/telegram/detect — найти группы и темы по свежим
 * сообщениям бота (getUpdates).
 *
 * Иначе владельцу пришлось бы доставать id группы вручную через сторонние
 * боты, а id темы в интерфейсе Telegram не показывается вовсе — его видно
 * только в ссылке на сообщение.
 */
router.get('/telegram/detect', manage, async (req: ExpressRequest, res, next) => {
  try {
    const { rows } = await pool.query<{ token: string }>(
      `SELECT token FROM salons.integration_credentials
        WHERE company_id = $1 AND provider = 'telegram' AND token IS NOT NULL`,
      [req.auth!.company_id],
    );
    const token = rows[0]?.token;
    if (!token) return res.json({ ok: false, reason: 'токен бота не сохранён', items: [] });

    // Очередь getUpdates НЕ читаем: её читает фоновый опрос ответов
    // менеджеров, и второй читатель крал бы у него события — часть ответов
    // просто не дошла бы до клиентов. Группы и темы копятся в
    // ai.telegram_seen тем самым опросом, отсюда их и берём.
    const body = { ok: true, result: [] as any[] };

    // Схлопываем по паре «чат + тема»: за сто обновлений одна тема
    // встречается много раз, а владельцу нужен список мест, а не сообщений.
    const seen = new Map<string, { chat_id: string; chat_title: string; thread_id: number; topic_name: string | null; last_text: string }>();
    for (const u of body.result || []) {
      // my_chat_member приходит при добавлении бота в группу — чат в нём
      // есть, а сообщения нет, и без этой ветки группа не находилась бы,
      // пока в неё кто-нибудь не напишет.
      const m = u.message || u.channel_post || u.my_chat_member || u.chat_member;
      if (!m?.chat) continue;
      const threadId = m.is_topic_message ? (m.message_thread_id ?? 0) : 0;
      const key = `${m.chat.id}|${threadId}`;
      seen.set(key, {
        chat_id: String(m.chat.id),
        chat_title: m.chat.title || m.chat.username || 'без названия',
        thread_id: threadId,
        // Имя темы приходит либо при её создании, либо в сообщении-шапке,
        // на которое ссылается ответ.
        topic_name: m.forum_topic_created?.name
          ?? m.reply_to_message?.forum_topic_created?.name
          ?? null,
        last_text: String(m.text || m.caption || '').slice(0, 60),
      });
    }

    // Очередь getUpdates одноразовая: Telegram отдаёт события и забывает
    // их. Без накопления повторное нажатие «Определить» показало бы пустой
    // список, хотя тема никуда не делась.
    for (const v of seen.values()) {
      await pool.query(
        `INSERT INTO ai.telegram_seen
           (company_id, chat_id, thread_id, chat_title, topic_name, last_text, seen_at)
         VALUES ($1::uuid, $2, $3, $4, $5, $6, now())
         ON CONFLICT (company_id, chat_id, thread_id) DO UPDATE SET
           chat_title = EXCLUDED.chat_title,
           topic_name = COALESCE(EXCLUDED.topic_name, ai.telegram_seen.topic_name),
           last_text  = COALESCE(NULLIF(EXCLUDED.last_text, ''), ai.telegram_seen.last_text),
           seen_at    = now()`,
        [req.auth!.company_id, v.chat_id, v.thread_id, v.chat_title, v.topic_name, v.last_text],
      );
    }

    const acc = await pool.query(
      `SELECT chat_id, chat_title, NULLIF(thread_id, 0) AS thread_id, topic_name, last_text
         FROM ai.telegram_seen
        WHERE company_id = $1::uuid
        ORDER BY chat_title, thread_id`,
      [req.auth!.company_id],
    );
    return res.json({ ok: true, items: acc.rows, fresh: seen.size });
  } catch (e) { return next(e); }
});

/**
 * POST /api/salons/ai/telegram/:channel/test — пробное сообщение.
 * Без него владелец узнает об ошибке в id группы только когда клиент
 * уже ждёт ответа, а уведомление молча не дошло.
 */
router.post('/telegram/:channel/test', manage, async (req: ExpressRequest, res, next) => {
  try {
    const channel = String(req.params.channel);
    if (channel !== 'instagram' && channel !== 'whatsapp') {
      throw new HttpError(400, 'канал может быть instagram или whatsapp');
    }
    const target = await telegramTarget(channel);
    if (!target) {
      return res.json({ ok: false, reason: 'не указан токен бота или id группы' });
    }
    const r = await sendTelegram(channel,
      '✅ Проверка связи. Сюда будут приходить диалоги, на которые ассистент не ответил сам.');
    return res.json(r);
  } catch (e) { return next(e); }
});

/**
 * GET /api/salons/ai/channel — режим канала.
 *
 * Режим обкатки: ассистент отвечает только перечисленным аккаунтам.
 * Пока клиника присматривается к ответам, это единственный безопасный
 * способ проверить поведение на живых сообщениях.
 */
router.get('/channel', view, async (req: ExpressRequest, res, next) => {
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
      // Типы у параметров проставлены явно: без них Postgres считает
      // массив из драйвера неизвестным типом и падает на COALESCE с
      // text[] (ошибка 42804, «types ... cannot be matched»).
      `INSERT INTO ai.channel_settings (company_id, channel, test_mode, test_users, updated_by)
            VALUES ($1::uuid, 'instagram', COALESCE($2::boolean, false), COALESCE($3::text[], '{}'::text[]), $4::uuid)
       ON CONFLICT (company_id, channel) DO UPDATE
          SET test_mode  = COALESCE($2::boolean, ai.channel_settings.test_mode),
              test_users = COALESCE($3::text[], ai.channel_settings.test_users),
              updated_by = $4::uuid
      RETURNING test_mode, test_users, updated_at`,
      [req.auth!.company_id, body.test_mode ?? null, users ?? null, req.auth!.sub],
    );
    return res.json(rows[0]);
  } catch (e) {
    return next(e);
  }
});

/** GET /api/salons/ai/log — журнал решений. */
router.get('/log', viewLog, async (req: ExpressRequest, res, next) => {
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
router.get('/status', view, async (req: ExpressRequest, res, next) => {
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
