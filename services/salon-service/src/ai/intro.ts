// Вступление с фотографиями зон — на каждый запрос про круговую липосакцию ног.
//
// Задача владельца: когда спрашивают про круговую лазерную липосакцию ног,
// ПЕРВЫМ делом отправить объяснение и две схемы зон (спереди и сзади), и
// только потом вести обычный разговор о цене. Без картинок клиент не
// понимает, что именно прорабатывается, и дальше разговор идёт вслепую.
//
// Клиент может вернуться к вопросу через день или после обсуждения другой
// зоны. В этом случае две схемы и описание нужны снова: постоянная отметка
// «уже отправляли» оставляла повторный запрос только с ценой и выглядела как
// потерянная настройка.
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
 * Сложить части вступления в порядке, который просил владелец:
 * СХЕМЫ ЗОН → текст про методику и 7 зон → просьба прислать свои фото.
 *
 * Вынесено из loadIntroParts отдельно, чтобы порядок проверялся тестом без
 * БД: именно он и есть требование владельца, а не деталь реализации.
 *
 * Почему не простая склейка «всё из intro, потом method»: текст про
 * методику заканчивается словами «Выше показали, какие именно 7 зон», и он
 * обязан идти сразу за картинками. А просьба сфотографироваться должна быть
 * последней — иначе клиента просят раздеться и прислать фото раньше, чем
 * объяснили, что за процедура.
 */
export function orderIntroParts(ownParts: ReplyPart[], methodParts: ReplyPart[]): ReplyPart[] {
  const images = ownParts.filter(p => p.type === 'image');
  const texts = ownParts.filter(p => p.type !== 'image');
  return [...images, ...methodParts, ...texts];
}

/**
 * Прочитать части вступления из шаблонов.
 *
 * Пустой список означает «тема выключена или не заведена» — тогда
 * вступление просто не отправляется, а обычный ответ уходит как раньше.
 */
export async function loadIntroParts(companyId: string): Promise<ReplyPart[]> {
  try {
    const { rows } = await pool.query(
      `SELECT topic, body, enabled, autosend FROM ai.reply_templates
        WHERE company_id = $1 AND topic = ANY($2::text[])`,
      [companyId, [LEGS_INTRO_TOPIC, LEGS_METHOD_TOPIC]],
    );
    const by = new Map(rows.map(r => [r.topic, r]));
    const head = by.get(LEGS_INTRO_TOPIC);
    // Выключить вступление целиком владелец может первой темой: она
    // главная, и без неё схемы зон отправлять незачем.
    //
    // autosend проверяется так же, как у любого шаблона: части уходят клиенту
    // без участия человека, и при autosend=false их отправлять нельзя. Раньше
    // смотрели только enabled — и 4 ноября схемы круговой процедуры
    // автоматически ушли в сотню диалогов при выключенной автоотправке.
    if (!head || head.enabled === false || head.autosend !== true) return [];

    const method = by.get(LEGS_METHOD_TOPIC);
    // Вторую часть добавляем только если она включена и заполнена:
    // заготовка-подсказка «(текст не заполнен)» клиенту уйти не должна.
    const methodParts = method && method.enabled !== false
      ? parseParts(method.body ?? '')
      : [];

    return orderIntroParts(parseParts(head.body ?? ''), methodParts);
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
 * ассистента: ответ уходит отдельным полем. Маршрут зовёт эту функцию только
 * для отправляемого ответа — черновик администратору материалов не несёт.
 */
export async function legsIntroFor(opts: {
  companyId: string;
  channel: string;
  threadId: string;
  text: string;
}): Promise<ReplyPart[]> {
  const { companyId, channel, threadId, text } = opts;
  if (!mentionsLegs(text)) return [];
  // Не подавляем повтор по ai.thread_intro: владелец требует заново показать
  // обе схемы и описание при каждом новом сообщении про круговую ЛЛ ног.
  // Метка остаётся журналом фактической отправки, но больше не выключателем.
  return loadIntroParts(companyId);
}
