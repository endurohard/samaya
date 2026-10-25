// Расчёт стоимости лазерной липосакции по городу, весу и зоне.
//
// Почему прайс лежит в коде, а не в базе или шаблоне: цену нельзя
// «сочинить». В системе намеренно нет генератора текста (см. комментарий в
// classifier.ts), и расчёт здесь такой же — таблица чисел и выбор строки.
// Любая цена, которую увидит клиент, обязана совпадать с прайсом клиники
// символ в символ, поэтому значения заданы литералами и покрыты тестами.
//
// Единственное место, где цена может измениться, — этот файл. Правка цен
// требует выката, и это сознательный выбор: цена услуги на 700 000 ₽ не
// должна меняться из веб-формы без ревью.

export type City = 'kaspiysk' | 'moscow';

/** Ключ зоны прайса. */
export type ZoneKey =
  | 'chin' | 'contour_lift' | 'holka' | 'arms' | 'belly' | 'waist'
  | 'legs_circular' | 'inner_legs' | 'galife' | 'pubis' | 'shin' | 'buttocks';

export const CITY_TITLE: Record<City, string> = {
  kaspiysk: 'Каспийск',
  moscow: 'Москва',
};

/**
 * Запасной текст с тремя вопросами.
 *
 * Используется, только если шаблон темы «Цена лазерной липосакции» не найден
 * в БД: молчать в ответ на вопрос о цене хуже, чем ответить текстом из кода.
 * В обычной работе текст берётся из шаблона — его правит владелец в админке.
 */
export const ASK_ALL = `Здравствуйте 🌹

Для того чтобы мы написали вам стоимость лазерной липосакции
Укажите пожалуйста:

1️⃣Какой город вас интересует Каспийск или Москва (прием ведем только в двух городах)

2️⃣Ваш вес ?

3️⃣Какая зона вас интересует? 🤍`;

/** Разобранный на части шаблон: приветствие и три вопроса по отдельности. */
export interface AskParts {
  /** Всё до первого пункта: «Здравствуйте 🌹 … Укажите пожалуйста:» */
  greeting: string;
  /** Пункты в порядке город, вес, зона. */
  city: string;
  weight: string;
  zone: string;
  /** Исходный текст шаблона целиком — ответ на первое сообщение «цена?». */
  full: string;
}

/**
 * Разобрать текст шаблона на приветствие и три вопроса.
 *
 * Зачем разбирать, а не хранить четыре поля: шаблон владелец правит как
 * обычный текст в админке, и просить его заполнять отдельные графы ради
 * переспроса — лишняя форма. Пункты ищем по цифровым эмодзи 1️⃣2️⃣3️⃣ —
 * именно так написан боевой шаблон. Если пункт не найден (текст переписали
 * своими словами), берём запасную формулировку: лучше спросить иначе, чем
 * не спросить вовсе.
 */
export function parseAskTemplate(body: string): AskParts {
  const text = (body || '').trim() || ASK_ALL;
  const i1 = text.indexOf('1️⃣');
  const i2 = text.indexOf('2️⃣');
  const i3 = text.indexOf('3️⃣');
  const cut = (from: number, to: number) =>
    from < 0 ? '' : text.slice(from, to < 0 ? undefined : to).trim();

  const first = [i1, i2, i3].filter(i => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  return {
    greeting: first > 0 ? text.slice(0, first).trim() : '',
    city: cut(i1, i2)
      || '1️⃣Какой город вас интересует Каспийск или Москва (прием ведем только в двух городах)',
    weight: cut(i2, i3) || '2️⃣Ваш вес ?',
    zone: cut(i3, -1) || '3️⃣Какая зона вас интересует? 🤍',
    full: text,
  };
}

interface Zone {
  key: ZoneKey;
  title: string;
  /** Зависит ли цена от веса — у большинства зон цена фиксированная. */
  byWeight: boolean;
  /** Фиксированная цена: [Каспийск, Москва]. */
  flat?: [number, number];
  /**
   * Ступени по весу: maxWeight — верхняя граница включительно, последняя
   * ступень задаётся Infinity.
   *
   * Границы согласованы с владельцем: ровно 100 кг относится к ступени
   * «100–109», то есть предыдущая заканчивается на 99. В исходном прайсе
   * «До 76-100» и «От 100-109» пересекались, и 100 кг попадал в обе.
   * Талия приведена к тем же ступеням, что живот (110–118, затем 119+): в
   * прайсе у талии был пропуск между 109 и 110.
   */
  steps?: { maxWeight: number; price: [number, number] }[];
  /** Примечание, которое уходит клиенту вместе с ценой. */
  note?: string;
}

const ZONES: Zone[] = [
  {
    key: 'chin', title: 'второй подбородок', byWeight: false,
    flat: [150_000, 200_000],
  },
  {
    key: 'contour_lift',
    title: 'Contour Lift (средняя и нижняя треть, шея, Morpheus 8 и FaceTite)',
    byWeight: false, flat: [300_000, 400_000],
  },
  {
    key: 'holka', title: 'холка', byWeight: false, flat: [200_000, 300_000],
    note: 'плечики в подарок 🎁',
  },
  {
    key: 'arms', title: 'круговая липосакция рук', byWeight: true,
    steps: [
      { maxWeight: 85, price: [250_000, 300_000] },
      { maxWeight: Infinity, price: [300_000, 350_000] },
    ],
    note: 'подмышечные зоны вместе с руками — плюс 50 000 ₽',
  },
  {
    key: 'belly', title: 'живот', byWeight: true,
    steps: [
      { maxWeight: 75, price: [250_000, 350_000] },
      { maxWeight: 99, price: [300_000, 400_000] },
      { maxWeight: 109, price: [350_000, 500_000] },
      { maxWeight: 118, price: [400_000, 550_000] },
      { maxWeight: Infinity, price: [500_000, 600_000] },
    ],
    note: 'живот вместе с лобком — плюс 50 000 ₽',
  },
  {
    key: 'waist', title: 'талия', byWeight: true,
    steps: [
      { maxWeight: 75, price: [300_000, 400_000] },
      { maxWeight: 99, price: [400_000, 500_000] },
      { maxWeight: 109, price: [500_000, 600_000] },
      { maxWeight: 118, price: [600_000, 700_000] },
      { maxWeight: Infinity, price: [700_000, 800_000] },
    ],
  },
  {
    key: 'legs_circular', title: 'круговая липосакция ног (от колен и выше)',
    byWeight: false, flat: [700_000, 800_000],
  },
  {
    key: 'inner_legs', title: 'внутренняя поверхность ног до колен',
    byWeight: false, flat: [300_000, 350_000],
  },
  { key: 'galife', title: 'галифе', byWeight: false, flat: [250_000, 300_000] },
  { key: 'pubis', title: 'лобок', byWeight: false, flat: [200_000, 200_000] },
  {
    key: 'shin', title: 'голень (круговая)', byWeight: false,
    flat: [350_000, 600_000],
  },
  {
    key: 'buttocks', title: 'уменьшение ягодиц', byWeight: false,
    flat: [350_000, 400_000],
  },
];

const ZONE_BY_KEY = new Map<ZoneKey, Zone>(ZONES.map(z => [z.key, z]));

/**
 * Каталог зон с ценами: имя -> описание зоны.
 *
 * Прайс живёт в БД (`ai.price_zones` / `ai.price_steps`) и правится в
 * админке, а встроенный ZONES остаётся запасным: если таблица пуста или
 * недоступна, ассистент продолжает считать по последним известным ценам,
 * а не молчит на боевом вопросе.
 *
 * Гарантия «цену нельзя сочинить» от переезда не страдает: сумма
 * по-прежнему БЕРЁТСЯ ИЗ ТАБЛИЦЫ, просто таблица теперь редактируемая.
 */
export type ZoneCatalog = Map<ZoneKey, Zone>;

/** Встроенный прайс — запасной вариант и источник переноса в БД. */
export const BUILTIN_ZONES: ZoneCatalog = ZONE_BY_KEY;

/** Описание зоны для сборки каталога из строк БД. */
export type { Zone };

/**
 * Слова, по которым узнаём зону.
 *
 * Порядок важен: длинные и более конкретные выражения стоят раньше, иначе
 * «второй подбородок» подхватится как «подбородок» в составе Contour Lift.
 * Поиск идёт по вхождению корня, поэтому окончания не нужны.
 *
 * generic — слова, которые могут относиться к нескольким зонам сразу.
 * «Ног» есть и в «круговой липосакции ног», и во «внутренней поверхности
 * ног до колен», а цены различаются вдвое (700 000 против 300 000 ₽).
 * Поэтому общее слово учитывается только тогда, когда ни одна зона не
 * опознана по конкретному выражению.
 */
const ZONE_WORDS: { key: ZoneKey; words: string[]; generic?: string[] }[] = [
  { key: 'contour_lift', words: ['contour', 'контур лифт', 'контурлифт', 'morpheus', 'морфеус', 'facetite'] },
  { key: 'inner_legs', words: ['внутренняя поверхность', 'внутренню', 'внутренняя част', 'между ног', 'внутри ног'] },
  {
    key: 'legs_circular',
    words: ['круговая ног', 'ноги полностью', 'ног от колен', 'нога целиком', 'ляшк', 'бедр'],
    generic: ['ног'],
  },
  { key: 'chin', words: ['подбородок', 'подбородк', 'второй подбород', 'овал лица', 'брыл'] },
  { key: 'holka', words: ['холк', 'загривок', 'вдовий горб', 'горбик'] },
  { key: 'arms', words: ['рук', 'предплеч', 'подмышк'] },
  { key: 'belly', words: ['живот', 'пузо', 'эпигастр'] },
  { key: 'waist', words: ['тали', 'бок', 'флан'] },
  { key: 'galife', words: ['галиф', 'галифэ', 'ушк'] },
  { key: 'pubis', words: ['лобок', 'лобк', 'пубис'] },
  { key: 'shin', words: ['голен', 'икр'] },
  { key: 'buttocks', words: ['ягодиц', 'попа', 'попу', 'зад'] },
];

/**
 * Зоны, которые клиент называет, но в прайсе их нет.
 *
 * «Колени» заданы с границей слова и без предлога «до»: во «внутренней
 * поверхности ног ДО КОЛЕН» речь о зоне из прайса (300 000 ₽), а не о
 * липосакции самих колен, которой в прайсе нет. Без этой оговорки
 * законный вопрос уходил администратору.
 */
const UNPRICED_WORDS = ['спин', 'лопатк', 'шея отдельно', 'щёк', 'щек'];
const UNPRICED_RE = [
  // «колени», но не «до колен» / «от колен»
  /(?<!(?:до|от)\s)колен/,
  /липосакци[а-я]*\s+колен/,
];

/**
 * Распознать город.
 *
 * Возвращает null, если город не назван или названы оба сразу — во втором
 * случае угадывать нельзя, вопрос нужно задать заново.
 */
export function parseCity(text: string): City | null {
  const t = String(text || '').toLowerCase();
  const kas = /каспийск|каспийске|каспийск[а-я]*|дагестан|махачкал/.test(t);
  const mos = /москв|мск|москве|москва/.test(t);
  if (kas && mos) return null;
  if (kas) return 'kaspiysk';
  if (mos) return 'moscow';
  return null;
}

/**
 * Распознать вес в килограммах.
 *
 * Главная сложность — не принять за вес чужое число. В одном сообщении
 * легко встречаются рост, возраст и количество зон: «мне 35, рост 170,
 * вес 80». Поэтому:
 *   1. если рядом с числом стоит «кг» — это вес, остальное не смотрим;
 *   2. иначе берём одиночное число из диапазона 40–200, но только когда
 *      рядом нет слов про возраст, рост или размер.
 * Если подходящих чисел несколько и они разные — возвращаем null: лучше
 * переспросить, чем посчитать цену по чужому числу.
 */
export function parseWeight(text: string): number | null {
  const t = String(text || '').toLowerCase().replace(',', '.');

  // Явное «кг» — самый надёжный признак.
  const withUnit = [...t.matchAll(/(\d{2,3}(?:\.\d)?)\s*(?:кг|kg|килограмм)/g)]
    .map(m => Number(m[1]))
    .filter(n => n >= 30 && n <= 300);
  if (withUnit.length) {
    const uniq = [...new Set(withUnit)];
    return uniq.length === 1 ? uniq[0] : null;
  }

  // Без единиц измерения: отбрасываем числа, у которых рядом возраст,
  // рост или размер одежды.
  const bad = /(лет|год|года|возраст|рост|см|размер)/;
  const candidates: number[] = [];
  for (const m of t.matchAll(/(\d{2,3}(?:\.\d)?)/g)) {
    const n = Number(m[1]);
    if (n < 40 || n > 200) continue;
    const from = Math.max(0, (m.index ?? 0) - 12);
    const around = t.slice(from, (m.index ?? 0) + m[0].length + 12);
    if (bad.test(around)) continue;
    candidates.push(n);
  }
  const uniq = [...new Set(candidates)];
  return uniq.length === 1 ? uniq[0] : null;
}

/**
 * Похоже ли сообщение на интерес к услуге, по которому уместно начать
 * разговор о цене.
 *
 * Зачем: классификатор смотрит ровно один текст и не помнит, что ассистент
 * только что спросил «услуга, стоимость или запись?». Ответы «услуга»,
 * «липосакция», «+» сами по себе не похожи ни на одну тему и уходили в
 * manual_review — для клиента это выглядит как замолчавший бот сразу
 * после приветствия. Поймано на живом диалоге: «Здравствуйте» → ответ,
 * «Услуга» → тишина, «Липосакция» → тишина.
 *
 * Сюда попадают только короткие реплики: в длинной фразе есть о чём
 * спросить классификатор, и подменять его разбор нельзя.
 */
const SERVICE_INTENT = [
  // Ответ на вопрос «услуга, стоимость или запись?»
  /^\s*услуг[аиу]?\s*$/i,
  /^\s*стоимост[ьи]\s*$/i,
  /^\s*цен[аыу]\s*$/i,
  // Название процедуры без вопроса: человек, написавший «липосакция»,
  // почти всегда хочет узнать цену.
  /^\s*липо(сакци[яюи])?\s*$/i,
  /^\s*лазерн[ая]{1,2}\s+липосакци[яюи]\s*$/i,
];

export function looksLikeServiceInterest(text: string): boolean {
  const t = String(text || '').trim();
  // Длинную фразу отдаём классификатору: там есть что разбирать.
  if (t.length > 40) return false;
  if (SERVICE_INTENT.some(re => re.test(t))) return true;
  // Короткая реплика, целиком состоящая из названия зоны («живот»,
  // «руки и живот»), — тоже интерес к цене, а не отдельная тема.
  const zones = parseZones(t);
  if (!zones.length) return false;
  // Отсекаем случаи, где зона лишь упомянута внутри другого вопроса
  // («болит живот после родов?»): таких слов в коротком интересе нет.
  return !/\?|как |почему|можно ли|болит|после|через/i.test(t);
}

/** Распознать зоны. Клиент может назвать несколько сразу. */
export function parseZones(text: string): ZoneKey[] {
  const t = String(text || '').toLowerCase();
  const found: ZoneKey[] = [];
  for (const { key, words } of ZONE_WORDS) {
    if (words.some(w => t.includes(w)) && !found.includes(key)) found.push(key);
  }
  // Общие слова — только когда конкретных совпадений не нашлось. «Ног» в
  // «внутренней поверхности ног» не должно добавлять круговую липосакцию:
  // это разные зоны с разницей в цене более чем вдвое.
  if (!found.length) {
    for (const { key, generic } of ZONE_WORDS) {
      if (generic?.some(w => t.includes(w)) && !found.includes(key)) found.push(key);
    }
  }
  // «Всё тело» — набор зон не выводим: это разговор с администратором.
  return found;
}

/** Названа ли зона, которой нет в прайсе. */
export function hasUnpricedZone(text: string): boolean {
  const t = String(text || '').toLowerCase();
  if (UNPRICED_WORDS.some(w => t.includes(w))) return true;
  return UNPRICED_RE.some(re => re.test(t));
}

/** Просит ли клиент цену сразу всего тела — такой строки в прайсе нет. */
export function asksWholeBody(text: string): boolean {
  const t = String(text || '').toLowerCase();
  return /все тело|всё тело|весь тело|полностью все|целиком/.test(t);
}

/** Нужен ли вес, чтобы назвать цену по этим зонам. */
export function weightNeeded(zones: ZoneKey[], catalog: ZoneCatalog = BUILTIN_ZONES): boolean {
  return zones.some(z => catalog.get(z)?.byWeight === true);
}

/** Упоминал ли клиент подмышечные зоны (доплата к рукам). */
export function wantsArmpits(text: string): boolean {
  return /подмышк|подмышеч/i.test(String(text || ''));
}

/** Упоминал ли клиент лобок вместе с животом (доплата к животу). */
export function wantsPubisWithBelly(text: string, zones: ZoneKey[]): boolean {
  return zones.includes('belly') && /лобок|лобк/i.test(String(text || ''));
}

function formatMoney(n: number): string {
  // Пробелы по разрядам, как в прайсе клиники: 250 000 ₽
  return n.toLocaleString('ru-RU').replace(/\u00a0/g, ' ') + ' ₽';
}

/** Цена одной зоны. null — зону нельзя посчитать без веса. */
export function zonePrice(
  zone: ZoneKey, city: City, weight: number | null,
  catalog: ZoneCatalog = BUILTIN_ZONES,
): number | null {
  const z = catalog.get(zone);
  if (!z) return null;
  const idx = city === 'kaspiysk' ? 0 : 1;
  if (!z.byWeight) return z.flat ? z.flat[idx] : null;
  if (weight == null) return null;
  const step = z.steps!.find(s => weight <= s.maxWeight);
  return step ? step.price[idx] : null;
}

export interface QuoteLine {
  zone: ZoneKey;
  title: string;
  price: number;
  note?: string;
}

/**
 * Служебные тексты ценового ответа, которые правит владелец.
 *
 * Вынесены из кода, потому что это ОБЫЧНЫЕ фразы, а не числа: «процедура
 * проходит без наркоза» и приглашение записаться клиника меняет так же
 * часто, как приветствие, и ради запятой в них не должно быть выката.
 * Числа прайса остаются в коде — их по-прежнему нельзя сочинить.
 */
export interface QuoteTexts {
  /** Заголовок ответа; {city} подставляется. */
  header: string;
  /** Строка итога при нескольких зонах; {total} подставляется. */
  total: string;
  /** Хвост после перечня цен — одна строка на абзац. */
  footer: string[];
  /** Вступление переспроса, когда не хватает одного ответа. */
  askOne: string;
  /** Вступление переспроса, когда не хватает нескольких. */
  askMany: string;
}

export const DEFAULT_QUOTE_TEXTS: QuoteTexts = {
  header: 'Стоимость лазерной липосакции — {city}:',
  total: 'Итого: {total}',
  footer: [
    'Процедура проходит под местной анестезией, без общего наркоза 🤍',
    'Подскажите, вам удобнее записаться на консультацию или остались вопросы?',
  ],
  askOne: 'Спасибо! Остался один вопрос:',
  askMany: 'Спасибо! Уточните, пожалуйста:',
};

/**
 * Разобрать шаблон служебных текстов.
 *
 * Формат — размеченные строки `ключ:` в начале строки, остальное до
 * следующего ключа считается значением. Разметка выбрана такой, чтобы
 * владелец видел в админке обычный текст с подписями, а не JSON: JSON он
 * сломает первой же правкой, и ответ клиенту пропадёт целиком.
 *
 * Отсутствующий или пустой ключ берётся из умолчаний — частично
 * заполненный шаблон не должен обрезать ответ.
 */
export function parseQuoteTexts(body: string): QuoteTexts {
  const text = (body || '').trim();
  if (!text) return DEFAULT_QUOTE_TEXTS;

  const KEYS = ['заголовок', 'итого', 'хвост', 'переспрос-один', 'переспрос-много'];
  const found: Record<string, string> = {};
  let current = '';
  for (const raw of text.split('\n')) {
    const m = /^\s*([а-яё-]+)\s*:\s*(.*)$/i.exec(raw);
    if (m && KEYS.includes(m[1].toLowerCase())) {
      current = m[1].toLowerCase();
      found[current] = m[2].trim();
      continue;
    }
    if (current) found[current] = (found[current] ? found[current] + '\n' : '') + raw;
  }
  const take = (k: string, def: string) => (found[k] ?? '').trim() || def;
  const footerRaw = (found['хвост'] ?? '').trim();

  return {
    header: take('заголовок', DEFAULT_QUOTE_TEXTS.header),
    total: take('итого', DEFAULT_QUOTE_TEXTS.total),
    footer: footerRaw
      ? footerRaw.split('\n').map(s => s.trim()).filter(Boolean)
      : DEFAULT_QUOTE_TEXTS.footer,
    askOne: take('переспрос-один', DEFAULT_QUOTE_TEXTS.askOne),
    askMany: take('переспрос-много', DEFAULT_QUOTE_TEXTS.askMany),
  };
}

/**
 * Собрать текст ответа с ценой.
 *
 * Возвращает null, если ни одну зону посчитать не удалось — тогда отвечать
 * нельзя и сообщение уходит администратору.
 */
export function buildQuote(opts: {
  city: City;
  weight: number | null;
  zones: ZoneKey[];
  armpits?: boolean;
  pubisWithBelly?: boolean;
  /** Служебные тексты из шаблона; без них берутся умолчания. */
  texts?: QuoteTexts;
  /** Каталог цен; без него — встроенный прайс. */
  catalog?: ZoneCatalog;
}): { text: string; lines: QuoteLine[] } | null {
  const catalog = opts.catalog ?? BUILTIN_ZONES;
  const lines: QuoteLine[] = [];
  for (const zone of opts.zones) {
    const price = zonePrice(zone, opts.city, opts.weight, catalog);
    if (price == null) continue;
    const z = catalog.get(zone)!;
    lines.push({ zone, title: z.title, price, note: z.note });
  }
  if (!lines.length) return null;

  const city = CITY_TITLE[opts.city];
  const t = opts.texts ?? DEFAULT_QUOTE_TEXTS;
  const parts: string[] = [];
  parts.push(t.header.replace('{city}', city));
  parts.push('');

  let total = 0;
  for (const l of lines) {
    let price = l.price;
    // Доплаты применяем к самой цене, а не отдельной строкой: клиент
    // спросил цену зоны с дополнением, и ответ должен быть одной суммой.
    if (l.zone === 'arms' && opts.armpits) price += 50_000;
    if (l.zone === 'belly' && opts.pubisWithBelly) price += 50_000;
    total += price;

    let line = `🔴 ${l.title.charAt(0).toUpperCase()}${l.title.slice(1)} — ${formatMoney(price)}`;
    if (l.zone === 'arms' && opts.armpits) line += ' (с подмышечными зонами)';
    if (l.zone === 'belly' && opts.pubisWithBelly) line += ' (вместе с лобком)';
    parts.push(line);

    // Примечание показываем только когда доплата ещё не учтена в сумме —
    // иначе клиент дважды прочитает про одни и те же 50 000 ₽.
    const applied =
      (l.zone === 'arms' && opts.armpits) ||
      (l.zone === 'belly' && opts.pubisWithBelly);
    if (l.note && !applied) parts.push(`     ${l.note}`);
  }

  if (lines.length > 1) {
    parts.push('');
    parts.push(t.total.replace('{total}', formatMoney(total)));
  }

  parts.push('');
  for (const line of t.footer) parts.push(line);

  return { text: parts.join('\n'), lines };
}

/**
 * Подставить цены из прайса в текст шаблона.
 *
 * Зачем: цены, написанные прямо в теле шаблона, — это второй источник
 * правды рядом с прайсом. Владелец меняет сумму в прайсе, а клиент
 * получает старую из текста, и разъезд обнаруживается уже в переписке.
 * Теперь в шаблоне пишется метка, а число берётся из той же таблицы, что
 * и у опросника.
 *
 * Разметка: `{цена:ключ_зоны:город}`, город — `каспийск` или `москва`.
 * Без города подставляются обе суммы через « / » — так удобнее в строке
 * вида «Каспийск — … Москва — …» писать каждую отдельно.
 *
 * Неизвестный ключ оставляем как есть: пустая строка на месте цены
 * выглядит как потерянный текст, а видимая метка сразу показывает
 * опечатку в названии зоны.
 */
export function renderPrices(body: string, catalog: ZoneCatalog): string {
  return String(body || '').replace(
    /\{цена:([a-z_]+)(?::(каспийск|москва))?\}/gi,
    (whole, key: string, city?: string) => {
      const z = catalog.get(key as ZoneKey);
      // Весовую зону в шаблон подставить нельзя: у неё нет одной суммы,
      // цена зависит от веса клиента. Такой вопрос ведёт опросник.
      if (!z || z.byWeight || !z.flat) return whole;
      const [kas, msk] = z.flat;
      if (!city) return `${formatMoney(kas)} / ${formatMoney(msk)}`;
      return formatMoney(city.toLowerCase() === 'москва' ? msk : kas);
    },
  );
}

/** Человеческое название зоны — для уведомлений администратору. */
export function zoneTitle(zone: ZoneKey, catalog: ZoneCatalog = BUILTIN_ZONES): string {
  return catalog.get(zone)?.title ?? zone;
}
