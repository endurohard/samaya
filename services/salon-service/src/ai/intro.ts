// Вступление с фотографиями зон — один раз на диалог.
//
// Задача владельца: когда спрашивают про круговую лазерную липосакцию ног,
// ПЕРВЫМ делом отправить объяснение и две схемы зон (спереди и сзади), и
// только потом вести обычный разговор о цене. Без картинок клиент не
// понимает, что именно прорабатывается, и дальше разговор идёт вслепую.
//
// Почему «один раз на диалог», а не на каждое упоминание: клиент называет
// ноги по нескольку раз подряд («ноги», потом «круговая», потом «Москва,
// 70, ноги»), и повторная пара одинаковых картинок читается как
// зациклившийся бот.
import { pool } from '../db';
import { parseParts } from './parts';
import type { ReplyPart } from './parts';
import { parseZones } from './price';
import type { ZoneKey } from './price';

/** Тема-хранилище текстов и порядка частей вступления. */
export const LEGS_INTRO_TOPIC = process.env.AI_LEGS_INTRO_TOPIC || 'legs_intro';

/**
 * Вторая половина вступления — текст про авторскую методику и 7 зон.
 *
 * Отдельной темой, а не куском первой: у менеджера обе части живут под
 * своими кодами быстрых шаблонов (6 и 66), и склеенный текст пришлось бы
 * держать в базе дважды. Автоответ склеивает их здесь.
 */
export const LEGS_METHOD_TOPIC = process.env.AI_LEGS_METHOD_TOPIC || 'legs_method';

/** Зона, при упоминании которой вступление обязательно. */
const LEGS_ZONE: ZoneKey = 'legs_circular';

/** Нужно ли вступление по этому сообщению (зона ног названа). */
export function mentionsLegs(text: string): boolean {
  return parseZones(text).includes(LEGS_ZONE);
}

/**
 * Прочитать части вступления из шаблона.
 *
 * Пустой список означает «тема выключена или не заведена» — тогда
 * вступление просто не отправляется, а обычный ответ уходит как раньше.
 */
export async function loadIntroParts(companyId: string): Promise<ReplyPart[]> {
  try {
    const { rows } = await pool.query(
      `SELECT topic, body, enabled FROM ai.reply_templates
        WHERE company_id = $1 AND topic = ANY($2::text[])`,
      [companyId, [LEGS_INTRO_TOPIC, LEGS_METHOD_TOPIC]],
    );
    const by = new Map(rows.map(r => [r.topic, r]));
    const head = by.get(LEGS_INTRO_TOPIC);
    // Выключить вступление целиком владелец может первой темой: она
    // главная, и без неё схемы зон отправлять незачем.
    if (!head || head.enabled === false) return [];

    const parts = parseParts(head.body ?? '');
    const method = by.get(LEGS_METHOD_TOPIC);
    // Вторую часть добавляем только если она включена и заполнена:
    // заготовка-подсказка «(текст не заполнен)» клиенту уйти не должна.
    if (method && method.enabled !== false) {
      parts.push(...parseParts(method.body ?? ''));
    }
    return parts;
  } catch (e) {
    // Молчаливый пропуск выглядел бы как «вступление перестало
    // отправляться» без единой подсказки, где искать.
    console.error('[AI][ноги] вступление не прочитано:', (e as Error).message);
    return [];
  }
}

/** Отправляли ли уже это вступление в этот диалог. */
export async function introSent(
  companyId: string, channel: string, threadId: string, key = LEGS_INTRO_TOPIC,
): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM ai.thread_intro
      WHERE company_id = $1 AND channel = $2 AND thread_id = $3 AND intro_key = $4`,
    [companyId, channel, threadId, key],
  );
  return rows.length > 0;
}

/**
 * Отметить вступление отправленным.
 *
 * Зовётся КАНАЛОМ после фактической отправки, а не здесь в момент решения.
 * Иначе при выключенном автоответе отметка встала бы, отправки не
 * произошло, и клиент не получил бы схемы зон уже никогда — молча.
 */
export async function markIntroSent(
  companyId: string, channel: string, threadId: string, key = LEGS_INTRO_TOPIC,
): Promise<void> {
  await pool.query(
    `INSERT INTO ai.thread_intro (company_id, channel, thread_id, intro_key)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (company_id, channel, thread_id, intro_key) DO NOTHING`,
    [companyId, channel, threadId, key],
  );
}

/**
 * Вступление для этого сообщения, если оно нужно.
 *
 * Возвращает только САМО вступление (тексты и фотографии), без ответа
 * ассистента: ответ уходит отдельным полем. При передаче администратору
 * ответа нет вовсе, а схемы зон показать всё равно надо — владелец просил
 * показывать их ПЕРЕД любым разговором о ногах.
 */
export async function legsIntroFor(opts: {
  companyId: string;
  channel: string;
  threadId: string;
  text: string;
}): Promise<ReplyPart[]> {
  const { companyId, channel, threadId, text } = opts;
  if (!mentionsLegs(text)) return [];
  if (await introSent(companyId, channel, threadId)) return [];
  return loadIntroParts(companyId);
}
