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
  ZoneCatalog, BUILTIN_ZONES, Zone, looksLikeServiceInterest,
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
}

const EMPTY: DialogState = {
  city: null, weight: null, zones: [], armpits: false,
  pubisBelly: false, quotedAt: null, askedAt: null,
};

export async function loadState(
  companyId: string, channel: string, threadId: string,
): Promise<DialogState> {
  const { rows } = await pool.query(
    `SELECT city, weight, zones, armpits, pubis_belly, quoted_at, asked_at
       FROM ai.price_dialog
      WHERE company_id = $1 AND channel = $2 AND thread_id = $3
        AND updated_at > now() - ($4 || ' hours')::interval`,
    [companyId, channel, threadId, String(DIALOG_TTL_HOURS)],
  );
  if (!rows.length) return { ...EMPTY };
  const r = rows[0];
  return {
    city: (r.city as City) ?? null,
    weight: r.weight == null ? null : Number(r.weight),
    zones: (r.zones ?? []) as ZoneKey[],
    armpits: r.armpits === true,
    pubisBelly: r.pubis_belly === true,
    quotedAt: r.quoted_at ?? null,
    askedAt: r.asked_at ?? null,
  };
}

async function saveState(
  companyId: string, channel: string, threadId: string, s: DialogState,
): Promise<void> {
  await pool.query(
    `INSERT INTO ai.price_dialog
       (company_id, channel, thread_id, city, weight, zones, armpits,
        pubis_belly, quoted_at, asked_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (company_id, channel, thread_id) DO UPDATE SET
       city = EXCLUDED.city,
       weight = EXCLUDED.weight,
       zones = EXCLUDED.zones,
       armpits = EXCLUDED.armpits,
       pubis_belly = EXCLUDED.pubis_belly,
       quoted_at = EXCLUDED.quoted_at,
       asked_at = EXCLUDED.asked_at,
       updated_at = now()`,
    [
      companyId, channel, threadId, s.city, s.weight, s.zones,
      s.armpits, s.pubisBelly, s.quotedAt, s.askedAt,
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
 * Текст следующего вопроса.
 *
 * Спрашиваем СТРОГО ПО ОДНОМУ и в заданном владельцем порядке:
 * 1) город, 2) вес, 3) зона. Три пункта разом клиент дочитывает редко —
 * отвечает на первый или на последний, остальное теряется, и дальше идёт
 * переспрос по кругу. Один вопрос даёт один понятный ответ.
 *
 * Порядок не «какого поля не хватает», а именно этот: вес у фиксированных
 * зон не нужен вовсе, но узнаём мы это только после названной зоны,
 * поэтому пропуск веса решается отдельно (needWeight) уже по ходу.
 *
 * `first` — первое сообщение ассистента в разговоре: начинаем с
 * приветствия из шаблона, а не со «Спасибо!» — благодарить ещё не за что.
 */
function askMissing(
  s: DialogState, needWeight: boolean, parts: AskParts, first: boolean,
  texts: QuoteTexts,
): string {
  // Ровно один вопрос — первый незакрытый по порядку.
  let question: string;
  if (!s.city) question = parts.city;
  else if (needWeight && s.weight == null) question = parts.weight;
  else question = parts.zone;

  const head = first
    ? (parts.greeting || 'Здравствуйте 🌹')
    : texts.askOne;
  // Пустой элемент в join обрастает разделителями с обеих сторон и даёт
  // четыре перевода строки — в переписке это выглядит как провал в тексте.
  return [head, question].join('\n\n');
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
  const { companyId, channel, threadId, text } = opts;
  const prev = await loadState(companyId, channel, threadId);

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

  const city = parseCity(text) ?? prev.city;
  const weight = parseWeight(text) ?? prev.weight;
  const newZones = parseZones(text);
  const zones = [...new Set([...prev.zones, ...newZones])] as ZoneKey[];

  // Служебные тексты ответа — из шаблона, владелец правит их в админке.
  const texts = await loadQuoteTexts(companyId);
  // Прайс — из БД; при пустой таблице вернётся встроенный.
  const catalog = await loadZoneCatalog(companyId);

  const next: DialogState = {
    city,
    weight,
    zones,
    armpits: prev.armpits || wantsArmpits(text),
    pubisBelly: prev.pubisBelly || wantsPubisWithBelly(text, zones),
    quotedAt: prev.quotedAt,
    askedAt: prev.askedAt,
  };

  const needWeight = zones.length ? weightNeeded(zones, catalog) : true;
  const ready = !!next.city && zones.length > 0 && (!needWeight || next.weight != null);

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
    if (!learned && !opts.fresh && !looksLikeServiceInterest(text)) {
      return {
        kind: 'handover', reply: null,
        reason: 'клиент не отвечает на вопросы о городе, весе и зоне',
        state: next,
      };
    }
    // Всегда один вопрос по порядку — включая самое первое сообщение.
    // Полный текст шаблона (все три пункта сразу) больше не отправляем:
    // клиент отвечает на один пункт, остальные теряются, и дальше идёт
    // переспрос по кругу. Шаблон остаётся источником формулировок.
    const reply = askMissing(next, needWeight, parts, !prev.askedAt, texts);
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
 * Идёт ли по этому диалогу сбор ответов о цене.
 *
 * Нужна, чтобы короткие ответы вроде «Москва» или «80» попали в этот
 * модуль, а не к классификатору: сами по себе они не похожи на вопрос о
 * цене и ушли бы в manual_review.
 *
 * Разговор считается активным, пока цена не названа. После отправки цены
 * ведём клиента обычным путём — дальше он спрашивает про процедуру,
 * запись, врача, и это уже темы шаблонов.
 */
export async function isCollecting(
  companyId: string, channel: string, threadId: string,
): Promise<boolean> {
  const s = await loadState(companyId, channel, threadId);
  if (s.quotedAt) return false;
  // askedAt важнее остальных полей: после первого вопроса о цене мы ещё
  // ничего не знаем, но разговор уже идёт, и ответ «Москва» принадлежит
  // ему, а не классификатору.
  if (s.askedAt) return true;
  return !!s.city || s.weight != null || s.zones.length > 0;
}
