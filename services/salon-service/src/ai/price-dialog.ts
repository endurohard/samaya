// Разговор о цене: собрать город, вес и зону, затем назвать цену.
//
// Зачем отдельный модуль рядом с классификатором: классификатор отвечает на
// вопрос «про что это сообщение» и смотрит ровно один текст. Здесь задача
// другая — помнить, что клиент уже сказал. Ответы приходят порциями
// («Москва» → «80» → «живот»), и ни одно из этих сообщений само по себе не
// распознаётся как вопрос о цене.
//
// Поэтому порядок такой: сначала проверяем, идёт ли уже сбор ответов по
// этому диалогу (continueDialog), и только если нет — спрашиваем
// классификатор. Иначе «Москва» ушла бы в manual_review.
import { pool } from '../db';
import {
  City, ZoneKey, parseCity, parseWeight, parseZones, weightNeeded,
  buildQuote, hasUnpricedZone, asksWholeBody, wantsArmpits,
  wantsPubisWithBelly, zoneTitle, CITY_TITLE,
  AskParts, parseAskTemplate,
  QuoteTexts, parseQuoteTexts, DEFAULT_QUOTE_TEXTS,
  ZoneCatalog, BUILTIN_ZONES, Zone, looksLikeServiceInterest, isPoliteOnly,
  parseConfirmation,
} from './price';

/** Ключ темы, из шаблона которой берутся приветствие и тексты вопросов. */
const PRICE_TOPIC = process.env.AI_PRICE_TOPIC || 'liposakciya_ruk';

/**
 * Ключ темы со служебными текстами ответа (заголовок, итого, хвост,
 * переспросы). Отдельная тема, а не часть первой: там лежит текст, который
 * уходит клиенту целиком, а здесь — размеченные куски, и смешивать их в
 * одном поле админки означает сломать первый при правке второго.
 */
const QUOTE_TOPIC = process.env.AI_PRICE_TEXTS_TOPIC || 'price_quote_texts';

/**
 * Прочитать шаблон темы цены из БД.
 *
 * Тексты вопросов и приветствие — это то, что клиника говорит клиенту от
 * своего имени, и править их владелец должен в админке, а не коммитом.
 * В коде остаётся только расчёт по прайсу: выдумать сумму по-прежнему нечем.
 */
export async function loadAskParts(companyId: string): Promise<AskParts> {
  try {
    const { rows } = await pool.query(
      `SELECT body FROM ai.reply_templates WHERE company_id = $1 AND topic = $2`,
      [companyId, PRICE_TOPIC],
    );
    return parseAskTemplate(rows[0]?.body ?? '');
  } catch (e) {
    // Недоступная БД не должна оставить клиента без ответа — отвечаем
    // запасным текстом, но причину пишем: молчаливый откат на константу
    // выглядит как «правка шаблона не применилась».
    console.error('[AI][цена] шаблон вопросов не прочитан:', (e as Error).message);
    return parseAskTemplate('');
  }
}

/** Прочитать служебные тексты ответа (заголовок, итого, хвост, переспросы). */
export async function loadQuoteTexts(companyId: string): Promise<QuoteTexts> {
  try {
    const { rows } = await pool.query(
      `SELECT body FROM ai.reply_templates WHERE company_id = $1 AND topic = $2`,
      [companyId, QUOTE_TOPIC],
    );
    return parseQuoteTexts(rows[0]?.body ?? '');
  } catch (e) {
    console.error('[AI][цена] шаблон текстов ответа не прочитан:', (e as Error).message);
    return DEFAULT_QUOTE_TEXTS;
  }
}

/**
 * Включён ли ценовой опросник.
 *
 * Выключатель темы «Цена лазерной липосакции» в админке обязан гасить и
 * опросник: без этой проверки владелец выключает тему, а ассистент
 * продолжает вести разговор о цене — выключатель выглядит сломанным.
 * Проверка идёт по той же колонке `enabled`, что и у обычных шаблонов.
 *
 * Отсутствие строки означает, что тему ещё не завели, — тогда опросник
 * работает: так было до появления выключателя, и терять ответы из-за
 * незаполненного справочника нельзя.
 */
export async function isPriceDialogEnabled(companyId: string): Promise<boolean> {
  try {
    const { rows } = await pool.query(
      `SELECT enabled FROM ai.reply_templates WHERE company_id = $1 AND topic = $2`,
      [companyId, PRICE_TOPIC],
    );
    return rows.length ? !!rows[0].enabled : true;
  } catch (e) {
    console.error('[AI][цена] состояние темы не прочитано:', (e as Error).message);
    return true;
  }
}

/**
 * Загрузить прайс из БД.
 *
 * Пустая или недоступная таблица — не повод молчать на вопросе о цене:
 * возвращаем встроенный прайс. Но причину пишем в лог, иначе «правлю цены
 * в админке, а ассистент называет старые» превратится в долгий поиск.
 *
 * Зона с `by_weight`, у которой нет ни одной ступени, пропускается: иначе
 * `steps!.find` в zonePrice упадёт на боевом вопросе. Такая строка —
 * результат незавершённой правки в админке, и правильная реакция на неё —
 * считать зону отсутствующей (вопрос уйдёт администратору), а не ронять
 * весь ответ.
 */
export async function loadZoneCatalog(companyId: string): Promise<ZoneCatalog> {
  try {
    const { rows: zrows } = await pool.query(
      `SELECT zone_key, title, by_weight, price_kaspiysk, price_moscow, note
         FROM ai.price_zones
        WHERE company_id = $1 AND enabled = true
        ORDER BY sort_order, title`,
      [companyId],
    );
    if (!zrows.length) return BUILTIN_ZONES;

    const { rows: srows } = await pool.query(
      `SELECT zone_key, max_weight, price_kaspiysk, price_moscow
         FROM ai.price_steps
        WHERE company_id = $1
        ORDER BY zone_key, sort_order`,
      [companyId],
    );
    const steps = new Map<string, { maxWeight: number; price: [number, number] }[]>();
    for (const s of srows) {
      const list = steps.get(s.zone_key) ?? [];
      // NULL в max_weight означает последнюю ступень «и выше»: в админке
      // так не нужно выдумывать 999, а здесь сравнение остаётся обычным.
      list.push({
        maxWeight: s.max_weight == null ? Infinity : Number(s.max_weight),
        price: [Number(s.price_kaspiysk), Number(s.price_moscow)],
      });
      steps.set(s.zone_key, list);
    }

    const catalog: ZoneCatalog = new Map();
    for (const z of zrows) {
      const byWeight = !!z.by_weight;
      const zoneSteps = steps.get(z.zone_key) ?? [];
      if (byWeight && !zoneSteps.length) {
        console.error(`[AI][цена] у зоны «${z.zone_key}» нет ступеней по весу — пропущена`);
        continue;
      }
      catalog.set(z.zone_key as ZoneKey, {
        key: z.zone_key as ZoneKey,
        title: z.title,
        byWeight,
        flat: byWeight
          ? undefined
          : [Number(z.price_kaspiysk), Number(z.price_moscow)] as [number, number],
        steps: byWeight ? zoneSteps : undefined,
        note: z.note ?? undefined,
      } as Zone);
    }
    return catalog.size ? catalog : BUILTIN_ZONES;
  } catch (e) {
    console.error('[AI][цена] прайс не прочитан, беру встроенный:', (e as Error).message);
    return BUILTIN_ZONES;
  }
}

/**
 * Сколько живёт незавершённый разговор.
 *
 * Сутки: клиент, вернувшийся через неделю со словом «живот», не должен
 * получить цену по весу, который называл в прошлый раз — он мог измениться,
 * да и речь, скорее всего, о другом.
 */
const DIALOG_TTL_HOURS = Number(process.env.AI_PRICE_DIALOG_TTL_HOURS || 24);

/**
 * Сколько дней город и вес хранятся КАК ДАННЫЕ К ПОДТВЕРЖДЕНИЮ.
 *
 * Разговор забывается через сутки, но сами по себе город и вес меняются
 * редко. Владелец просил: вернулся клиент в течение недели — не спрашивать
 * всё заново, а уточнить, не изменились ли данные, и при «да, верно»
 * считать по прежним.
 *
 * Принципиально, что это НЕ продление TTL разговора: цену по весу
 * недельной давности называть нельзя, пока человек его не подтвердил.
 * Поэтому данные поднимаются отдельно и только для вопроса-подтверждения.
 */
const CONFIRM_TTL_DAYS = Number(process.env.AI_PRICE_CONFIRM_TTL_DAYS || 7);


export interface DialogState {
  city: City | null;
  weight: number | null;
  zones: ZoneKey[];
  armpits: boolean;
  pubisBelly: boolean;
  quotedAt: Date | null;
  /**
   * Когда ассистент задал вопросы о городе, весе и зоне.
   *
   * Отдельный признак нужен потому, что после первого сообщения
   * («Сколько стоит?») мы ещё ничего не знаем: город, вес и зоны пустые.
   * Без отметки «вопросы заданы» следующее сообщение «Москва» выглядело
   * бы как начало нового разговора и уходило в manual_review — ровно то,
   * на что жаловался владелец.
   */
  askedAt: Date | null;
  /**
   * Когда ассистент спросил «город и вес прежние?».
   *
   * Пока отметка стоит, короткая реплика («да», «всё верно», «нет, 80»)
   * разбирается как ответ на этот вопрос, а не как новый разговор.
   */
  confirmAskedAt: Date | null;
  /**
   * Город и вес, поднятые из ПРОШЛОГО разговора (до недели назад).
   *
   * Лежат отдельно от city/weight намеренно: в расчёт они попадают только
   * после того, как человек их подтвердил. Иначе ассистент назвал бы цену
   * по весу недельной давности, которого никто не подтверждал.
   */
  priorCity: City | null;
  priorWeight: number | null;
}

const EMPTY: DialogState = {
  city: null, weight: null, zones: [], armpits: false,
  pubisBelly: false, quotedAt: null, askedAt: null,
  confirmAskedAt: null, priorCity: null, priorWeight: null,
};

export async function loadState(
  companyId: string, channel: string, threadId: string,
): Promise<DialogState> {
  const { rows } = await pool.query(
    `SELECT city, weight, zones, armpits, pubis_belly, quoted_at, asked_at,
            confirm_asked_at,
            -- Город и вес прошлого разговора: строка та же, но «живой» она
            -- считается только сутки. За пределами суток поднимаем ТОЛЬКО
            -- эти два поля и только чтобы спросить, не изменились ли они.
            CASE WHEN updated_at > now() - ($5 || ' days')::interval
                 THEN city END  AS prior_city,
            CASE WHEN updated_at > now() - ($5 || ' days')::interval
                 THEN weight END AS prior_weight,
            updated_at > now() - ($4 || ' hours')::interval AS fresh
       FROM ai.price_dialog
      WHERE company_id = $1 AND channel = $2 AND thread_id = $3`,
    [companyId, channel, threadId, String(DIALOG_TTL_HOURS), String(CONFIRM_TTL_DAYS)],
  );
  if (!rows.length) return { ...EMPTY };
  const r = rows[0];

  // Разговор протух (прошло больше суток) — забываем его целиком, но
  // город и вес оставляем как данные К ПОДТВЕРЖДЕНИЮ: их ассистент
  // переспросит, а не подставит в расчёт молча.
  if (!r.fresh) {
    return {
      ...EMPTY,
      priorCity: (r.prior_city as City) ?? null,
      priorWeight: r.prior_weight == null ? null : Number(r.prior_weight),
    };
  }

  return {
    city: (r.city as City) ?? null,
    weight: r.weight == null ? null : Number(r.weight),
    zones: (r.zones ?? []) as ZoneKey[],
    armpits: r.armpits === true,
    pubisBelly: r.pubis_belly === true,
    quotedAt: r.quoted_at ?? null,
    askedAt: r.asked_at ?? null,
    confirmAskedAt: r.confirm_asked_at ?? null,
    priorCity: (r.prior_city as City) ?? null,
    priorWeight: r.prior_weight == null ? null : Number(r.prior_weight),
  };
}

async function saveState(
  companyId: string, channel: string, threadId: string, s: DialogState,
): Promise<void> {
  await pool.query(
    `INSERT INTO ai.price_dialog
       (company_id, channel, thread_id, city, weight, zones, armpits,
        pubis_belly, quoted_at, asked_at, confirm_asked_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now())
     ON CONFLICT (company_id, channel, thread_id) DO UPDATE SET
       -- Город и вес не затираем пустыми: это та же строка, из которой мы
       -- поднимаем их на подтверждение следующие семь дней. Обнулив их
       -- здесь, мы потеряли бы данные ровно в тот момент, когда разговор
       -- начинается заново и city/weight ещё не заполнены.
       city = COALESCE(EXCLUDED.city, ai.price_dialog.city),
       weight = COALESCE(EXCLUDED.weight, ai.price_dialog.weight),
       zones = EXCLUDED.zones,
       armpits = EXCLUDED.armpits,
       pubis_belly = EXCLUDED.pubis_belly,
       quoted_at = EXCLUDED.quoted_at,
       asked_at = EXCLUDED.asked_at,
       confirm_asked_at = EXCLUDED.confirm_asked_at,
       updated_at = now()`,
    [
      companyId, channel, threadId, s.city, s.weight, s.zones,
      s.armpits, s.pubisBelly, s.quotedAt, s.askedAt, s.confirmAskedAt,
    ],
  );
}

/** Забыть разговор — например, администратор вмешался вручную. */
export async function resetState(
  companyId: string, channel: string, threadId: string,
): Promise<void> {
  await pool.query(
    `DELETE FROM ai.price_dialog
      WHERE company_id = $1 AND channel = $2 AND thread_id = $3`,
    [companyId, channel, threadId],
  );
}

export interface PriceOutcome {
  /** quote — назвали цену; ask — задали недостающие вопросы;
   *  handover — нужен администратор; none — модуль ни при чём. */
  kind: 'quote' | 'ask' | 'handover' | 'none';
  reply: string | null;
  reason: string | null;
  state?: DialogState;
}

/**
 * Текст переспроса — один недостающий пункт.
 *
 * Все три вопроса разом задаются только ПЕРВЫМ сообщением (parts.full).
 * Дальше спрашиваем по одному и в порядке город → вес → зона: повтор
 * всего списка читается так, будто клиента не услышали, а по данным
 * переписки на три пункта разом отвечают одним — остальное теряется.
 */
function askMissing(
  s: DialogState, needWeight: boolean, parts: AskParts, texts: QuoteTexts,
): string {
  // Ровно один вопрос — первый незакрытый по порядку.
  let question: string;
  if (!s.city) question = parts.city;
  else if (needWeight && s.weight == null) question = parts.weight;
  else question = parts.zone;

  // Сколько пунктов ещё не закрыто — от этого зависит вступление.
  const left =
    (s.city ? 0 : 1) +
    (needWeight && s.weight == null ? 1 : 0) +
    (s.zones.length ? 0 : 1);

  // «Остался один вопрос» уместно только когда он действительно
  // последний: на втором шаге из трёх это неправда.
  const head = left <= 1 ? texts.askOne : texts.askMany;
  // Пустой элемент в join обрастает разделителями с обеих сторон и даёт
  // четыре перевода строки — в переписке это выглядит как провал в тексте.
  return [head, question].join('\n\n');
}

/**
 * Начинается ли НОВЫЙ запрос цены поверх уже названной.
 *
 * Состояние разговора живёт сутки, и без этой проверки позиции копились
 * весь день: на вопрос про овал лица клиент получал ноги + руки +
 * подбородок и «Итого: 1 300 000 ₽». Клиника выглядит так, будто
 * навязывает процедуры, а сумма не имеет отношения к вопросу.
 *
 * Два случая, оба только ПОСЛЕ выданной цены:
 *  - названа новая зона («меня интересует овал лица»);
 *  - классификатор снова распознал вопрос о цене (`fresh`) — вернувшийся
 *    через часы клиент пишет «Стоимость» и должен получить вопросы, а не
 *    прошлый счёт.
 *
 * Чего триггерить НЕЛЬЗЯ: «а в Каспийске?» и «когда можно записаться?»
 * новых зон не содержат — там пересчёт идёт по тем же позициям, и
 * обнуление заставило бы спрашивать всё заново.
 */
export function startsNewQuote(
  prev: Pick<DialogState, 'quotedAt'>, newZones: ZoneKey[], fresh: boolean,
): boolean {
  return !!prev.quotedAt && (newZones.length > 0 || fresh);
}

/**
 * Применить сообщение к состоянию разговора.
 *
 * Возвращает решение: назвать цену, переспросить или позвать человека.
 * handleMessage НЕ решает, относится ли сообщение к теме цены — это задача
 * вызывающей стороны (см. shouldHandle).
 */
export async function handleMessage(opts: {
  companyId: string;
  channel: string;
  threadId: string;
  text: string;
  /** true — вопрос о цене распознан классификатором (первое сообщение). */
  fresh: boolean;
}): Promise<PriceOutcome> {
  const { companyId, channel, threadId, text, fresh } = opts;
  let prev = await loadState(companyId, channel, threadId);

  // Зона, которой нет в прайсе, и «всё тело» — только через администратора:
  // цену для них ассистент выдумывать не должен.
  if (hasUnpricedZone(text)) {
    return {
      kind: 'handover', reply: null,
      reason: 'названа зона, которой нет в прайсе — нужен администратор',
    };
  }
  if (asksWholeBody(text)) {
    return {
      kind: 'handover', reply: null,
      reason: 'цена за всё тело не считается по прайсу — нужен администратор',
    };
  }

  const newZones = parseZones(text);

  // ── Ответ на вопрос «город и вес прежние?» ──
  //
  // Проверяем ДО всего остального: короткое «да» или «нет» само по себе ни
  // на что не похоже и ушло бы в общий разбор, где «да» считается
  // вежливостью. Тогда вопрос-подтверждение остался бы без ответа и
  // задавался по кругу.
  const confirmation = prev.confirmAskedAt ? parseConfirmation(text) : null;
  if (confirmation === true) {
    // Подтвердил — переносим прошлые данные в расчёт и продолжаем обычным
    // путём: дальше не хватает только зоны, её и спросим (или посчитаем,
    // если клиент назвал её в том же сообщении).
    prev = {
      ...prev,
      city: parseCity(text) ?? prev.priorCity,
      weight: parseWeight(text) ?? prev.priorWeight,
      confirmAskedAt: null,
    };
  } else if (confirmation === false) {
    // Данные изменились — забываем прошлые и спрашиваем заново. Если новые
    // названы прямо здесь («нет, теперь 80»), они подхватятся ниже.
    prev = {
      ...prev,
      city: null, weight: null,
      priorCity: null, priorWeight: null,
      confirmAskedAt: null,
    };
  }

  // Зоны НЕ накапливаются после уже названной цены.
  //
  // Объединение со прошлыми зонами нужно, пока идёт сбор ответов: клиент
  // перечисляет их по частям («ноги», потом «и руки»), и расчёт должен
  // собраться целиком. Но после выданной цены новая зона — это НОВЫЙ
  // вопрос («меня интересует овал лица»), а не добавка к прошлому счёту.
  //
  // Без этого зоны копились весь день и каждый следующий ответ становился
  // дороже: на вопрос про овал лица клиент получил ноги + руки +
  // подбородок и «Итого: 1 300 000 ₽». Клиника выглядит так, будто
  // навязывает процедуры, а названная сумма не имеет отношения к вопросу.
  const startsOver = startsNewQuote(prev, newZones, fresh);
  const zones = startsOver
    ? ([...new Set(newZones)] as ZoneKey[])
    : ([...new Set([...prev.zones, ...newZones])] as ZoneKey[]);

  // Новый вопрос — заново город, вес и услуга (требование владельца).
  //
  // Соблазн сохранить вес («он же про человека, а не про зону») на живых
  // диалогах оказался неверным: между вопросами проходят часы, клиент
  // спрашивает за подругу или называет другой вес, а бот молча считает по
  // старому и выдаёт сумму, которую никто не подтверждал. Ошибка в цене
  // дороже лишнего вопроса, поэтому данные переспрашиваются.
  //
  // Но в пределах недели — не «с нуля», а подтверждением: см. ниже блок с
  // confirmAskedAt. Там прежние город и вес предлагаются готовыми.
  //
  // Названное В ЭТОМ ЖЕ сообщении всегда побеждает: «а в Каспийске руки?»
  // не превратится в переспрос города, который клиент только что назвал.
  const city = parseCity(text) ?? (startsOver ? null : prev.city);
  const weight = parseWeight(text) ?? (startsOver ? null : prev.weight);

  // Клиент назвал другой город после уже полученной цены («а в Каспийске?»)
  // — считаем это новым запросом по тем же позициям: снимаем отметку о
  // выданной цене, чтобы расчёт ушёл повторно, уже по прайсу нового города.
  // Без этого состояние осталось бы «цена названа» и ответ не отправился.
  const cityChanged = !!prev.quotedAt && !!city && city !== prev.city;

  // Служебные тексты ответа — из шаблона, владелец правит их в админке.
  const texts = await loadQuoteTexts(companyId);
  // Прайс — из БД; при пустой таблице вернётся встроенный.
  const catalog = await loadZoneCatalog(companyId);

  const next: DialogState = {
    city,
    weight,
    zones,
    // Доплаты относятся к КОНКРЕТНЫМ позициям, поэтому при новом вопросе
    // сбрасываются вместе с зонами: иначе подмышечные зоны, добавленные к
    // рукам, приклеятся плюсом 50 000 ₽ к цене овала лица.
    armpits: (startsOver ? false : prev.armpits) || wantsArmpits(text),
    pubisBelly: (startsOver ? false : prev.pubisBelly) || wantsPubisWithBelly(text, zones),
    // Новый вопрос обязан снять отметку о выданной цене — иначе состояние
    // останется «цена названа» и ответ не отправится вовсе.
    quotedAt: (cityChanged || startsOver) ? null : prev.quotedAt,
    // При новом вопросе забываем и то, что вопросы уже задавались: иначе
    // клиент получит переспрос одним пунктом («Ваш вес?») вместо полного
    // списка, хотя про новую услугу не известно вообще ничего.
    // Смена города — не новый разговор, там askedAt сохраняется.
    askedAt: startsOver ? null : prev.askedAt,
    confirmAskedAt: null,
    priorCity: prev.priorCity,
    priorWeight: prev.priorWeight,
  };

  const needWeight = zones.length ? weightNeeded(zones, catalog) : true;
  const ready = !!next.city && zones.length > 0 && (!needWeight || next.weight != null);

  // ── Подтверждение прежних данных вместо опроса с нуля ──
  //
  // Клиент вернулся в течение недели: город и вес у нас есть, но они из
  // прошлого разговора и могли измениться. Называть по ним цену молча
  // нельзя, спрашивать всё заново — лишняя работа для человека, который
  // уже всё это писал. Поэтому показываем их и просим подтвердить.
  //
  // Условие узкое: спрашиваем только когда прежние данные ЕСТЬ, а текущих
  // нет, и только если вопрос ещё не задан (иначе он пойдёт по кругу).
  const hasPrior = next.city == null && next.weight == null
    && (prev.priorCity != null || prev.priorWeight != null);
  if (!ready && hasPrior && !prev.confirmAskedAt) {
    next.confirmAskedAt = new Date();
    // askedAt не ставим: вопросы о городе и весе ещё не задавались, и при
    // ответе «нет» клиент должен получить их полным списком.
    await saveState(companyId, channel, threadId, next);
    const parts: string[] = [];
    if (prev.priorCity) parts.push(`город — ${CITY_TITLE[prev.priorCity]}`);
    if (prev.priorWeight != null) {
      // Вес храним как numeric, и 65.0 в тексте читается как опечатка —
      // целое показываем без дробной части.
      const w = Number(prev.priorWeight);
      parts.push(`вес — ${Number.isInteger(w) ? w : w.toFixed(1)} кг`);
    }
    return {
      kind: 'ask',
      reply: `${texts.confirmHead}\n\n${parts.join(', ')}\n\n${texts.confirmTail}`,
      reason: 'уточняем, не изменились ли город и вес',
      state: next,
    };
  }

  if (!ready) {
    // Тексты вопросов берём из шаблона темы: владелец правит формулировки в
    // админке. Читаем только здесь — когда ответ действительно нужен.
    const parts = await loadAskParts(companyId);
    // Отмечаем, что вопросы заданы: следующее сообщение клиента («Москва»)
    // должно попасть в этот модуль, а не выглядеть новым разговором.
    next.askedAt = new Date();
    await saveState(companyId, channel, threadId, next);
    // Ничего нового не узнали и вопросы уже задавали — не повторяем их по
    // кругу: клиент мог написать «ну так сколько?», и третий одинаковый
    // ответ выглядит как неисправный бот. Отдаём администратору.
    const learned =
      next.city !== prev.city ||
      next.weight !== prev.weight ||
      zones.length !== prev.zones.length;
    // Исключение — реплика вида «Липосакция»: клиент называет услугу, а не
    // уклоняется от вопросов. Нового в ней действительно нет (зона не
    // названа), но отдавать такой разговор администратору рано — человек
    // просто уточнил, о чём речь. Поймано на живом диалоге: «Услуга» →
    // вопросы, «Липосакция» → «клиент не отвечает» и тишина.
    //
    // Второе исключение — вежливость посреди опроса: «Здравствуйте»,
    // «спасибо», «ок». Клиент здоровается заново, вернувшись в диалог, и
    // терять из-за этого уже собранные город и вес нельзя: админу уходил
    // разговор, где оставалось спросить одну зону. Вместо передачи
    // человеку просто повторяем недостающий вопрос.
    const politeOnly = isPoliteOnly(text);
    // Третье исключение — ответ на вопрос «город и вес прежние?».
    // Подтверждение («да, всё верно») новых данных не приносит: city и
    // weight переносятся из прошлого разговора ДО этой проверки, поэтому
    // learned ложно, и разговор ушёл бы администратору ровно в тот момент,
    // когда клиент всё сделал правильно. Отказ («нет») — тем более ответ:
    // он очищает данные, и следом надо задать вопросы, а не сдаваться.
    const answeredConfirm = confirmation !== null;
    if (!learned && !opts.fresh && !looksLikeServiceInterest(text)
        && !politeOnly && !answeredConfirm) {
      return {
        kind: 'handover', reply: null,
        reason: 'клиент не отвечает на вопросы о городе, весе и зоне',
        state: next,
      };
    }
    // Первое сообщение ассистента в разговоре — все три вопроса сразу
    // (так решил владелец): клиент видит полный список и часто отвечает
    // на всё одной строкой «Каспийск, 70, живот». Дальше переспрашиваем
    // уже по одному и только то, чего не хватает, — иначе повтор всех
    // трёх пунктов читается так, будто клиента не услышали.
    const reply = !prev.askedAt
      ? parts.full
      : askMissing(next, needWeight, parts, texts);
    return { kind: 'ask', reply, reason: null, state: next };
  }

  const quote = buildQuote({
    city: next.city!,
    weight: next.weight,
    zones,
    armpits: next.armpits,
    pubisWithBelly: next.pubisBelly,
    texts,
    catalog,
  });
  if (!quote) {
    return {
      kind: 'handover', reply: null,
      reason: 'не удалось посчитать цену по прайсу — нужен администратор',
      state: next,
    };
  }

  next.quotedAt = new Date();
  await saveState(companyId, channel, threadId, next);
  const zonesText = zones.map(z => zoneTitle(z, catalog)).join(', ');
  return {
    kind: 'quote', reply: quote.text,
    reason: `цена по прайсу: ${CITY_TITLE[next.city!]}, ` +
      `${next.weight != null ? next.weight + ' кг, ' : ''}${zonesText}`,
    state: next,
  };
}

/**
 * Переспрос цены по другому городу после уже названной цены.
 *
 * Живой случай: клиент спросил стоимость по Москве, получил расчёт, а
 * следом пишет «а в Каспийске?». Ответы про зоны и вес он уже дал — заново
 * спрашивать их нельзя, нужно пересчитать ТЕ ЖЕ позиции по прайсу другого
 * города.
 *
 * Почему отдельной функцией, а не через isCollecting: после отправки цены
 * сбор ответов осознанно закрыт (дальше клиент спрашивает про процедуру,
 * врача, запись — это темы шаблонов). Здесь нужен узкий случай: цена
 * названа, позиции известны, и в сообщении назван ДРУГОЙ город.
 */
export async function isCitySwitch(
  companyId: string, channel: string, threadId: string, text: string,
): Promise<boolean> {
  const s = await loadState(companyId, channel, threadId);
  if (!s.quotedAt) return false;          // цену ещё не называли — обычный путь
  if (!s.zones.length) return false;      // пересчитывать нечего
  const city = parseCity(text);
  return !!city && city !== s.city;
}

/**
 * Идёт ли по этому диалогу сбор ответов о цене.
 *
 * Нужна, чтобы короткие ответы вроде «Москва» или «80» попали в этот
 * модуль, а не к классификатору: сами по себе они не похожи на вопрос о
 * цене и ушли бы в manual_review.
 *
 * Разговор считается активным, пока цена не названа. После отправки цены
 * ведём клиента обычным путём — дальше он спрашивает про процедуру,
 * запись, врача, и это уже темы шаблонов. Исключение — смена города,
 * см. isCitySwitch.
 */
export async function isCollecting(
  companyId: string, channel: string, threadId: string,
): Promise<boolean> {
  const s = await loadState(companyId, channel, threadId);
  if (s.quotedAt) return false;
  // Задан вопрос «город и вес прежние?» — короткое «да» или «нет»
  // принадлежит ему. Без этой строки ответ ушёл бы к классификатору,
  // вопрос остался бы без обработки и задавался по кругу.
  if (s.confirmAskedAt) return true;
  // askedAt важнее остальных полей: после первого вопроса о цене мы ещё
  // ничего не знаем, но разговор уже идёт, и ответ «Москва» принадлежит
  // ему, а не классификатору.
  if (s.askedAt) return true;
  return !!s.city || s.weight != null || s.zones.length > 0;
}
