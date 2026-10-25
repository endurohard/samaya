// Проверка расчёта цены по прайсу: разбор города/веса/зоны и суммы.
// Запуск: npx tsx src/ai/price.test.ts
import {
  parseCity, parseWeight, parseZones, zonePrice, buildQuote,
  hasUnpricedZone, asksWholeBody, weightNeeded, zoneTitle,
  BUILTIN_ZONES, renderPrices, looksLikeServiceInterest, isPoliteOnly,
} from './price';
import type { ZoneCatalog } from './price';
import { parseAskTemplate, parseQuoteTexts, DEFAULT_QUOTE_TEXTS } from './price';

let ok = 0, fail = 0;
function check(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      получено: ${g}\n      ожидалось: ${w}`); }
}

console.log('— город —');
check('Москва', parseCity('Москва'), 'moscow');
check('мск', parseCity('интересует мск'), 'moscow');
check('Каспийск', parseCity('каспийск'), 'kaspiysk');
check('Махачкала → Каспийск', parseCity('я из Махачкалы'), 'kaspiysk');
check('оба города → null', parseCity('Москва или Каспийск?'), null);
check('нет города', parseCity('живот интересует'), null);

console.log('— вес —');
check('80 кг', parseWeight('80 кг'), 80);
check('просто 80', parseWeight('80'), 80);
check('вес 72,5', parseWeight('вес 72,5 кг'), 72.5);
check('рост не вес', parseWeight('рост 170'), null);
check('возраст не вес', parseWeight('мне 35 лет'), null);
check('рост и вес вместе', parseWeight('рост 170 вес 80 кг'), 80);
check('два разных числа → null', parseWeight('то 80 то 90'), null);
check('размер одежды не вес', parseWeight('размер 48'), null);

console.log('— зоны —');
check('живот', parseZones('живот'), ['belly']);
check('руки', parseZones('руки интересуют'), ['arms']);
check('подбородок', parseZones('второй подбородок'), ['chin']);
check('внутренняя поверхность ≠ круговая ног',
  parseZones('внутренняя поверхность ног'), ['inner_legs']);
check('ляшки → круговая ног', parseZones('ляшки'), ['legs_circular']);
check('бока → талия', parseZones('бока'), ['waist']);
check('галифе', parseZones('галифэ'), ['galife']);
check('две зоны', parseZones('живот и руки'), ['arms', 'belly']);
check('спина — нет в прайсе', hasUnpricedZone('спина'), true);
check('«до колен» — это зона из прайса, не колени',
  hasUnpricedZone('внутренняя поверхность ног до колен'), false);
check('«от колен и выше» — зона из прайса',
  hasUnpricedZone('круговая липосакция ног от колен и выше'), false);
check('липосакция колен — нет в прайсе',
  hasUnpricedZone('сколько стоит липосакция колен'), true);
check('всё тело', asksWholeBody('хочу всё тело'), true);

console.log('— границы веса (живот, Каспийск) —');
check('75 кг → 250 000', zonePrice('belly', 'kaspiysk', 75), 250_000);
check('76 кг → 300 000', zonePrice('belly', 'kaspiysk', 76), 300_000);
check('99 кг → 300 000', zonePrice('belly', 'kaspiysk', 99), 300_000);
check('100 кг → 350 000 (верхняя ступень)', zonePrice('belly', 'kaspiysk', 100), 350_000);
check('109 кг → 350 000', zonePrice('belly', 'kaspiysk', 109), 350_000);
check('110 кг → 400 000', zonePrice('belly', 'kaspiysk', 110), 400_000);
check('118 кг → 400 000', zonePrice('belly', 'kaspiysk', 118), 400_000);
check('119 кг → 500 000', zonePrice('belly', 'kaspiysk', 119), 500_000);

console.log('— границы веса (талия, Москва) —');
check('75 → 400 000', zonePrice('waist', 'moscow', 75), 400_000);
check('100 → 600 000', zonePrice('waist', 'moscow', 100), 600_000);
check('118 → 700 000', zonePrice('waist', 'moscow', 118), 700_000);
check('119 → 800 000', zonePrice('waist', 'moscow', 119), 800_000);

console.log('— фиксированные цены —');
check('подбородок Каспийск', zonePrice('chin', 'kaspiysk', null), 150_000);
check('подбородок Москва', zonePrice('chin', 'moscow', null), 200_000);
check('круговая ног Москва', zonePrice('legs_circular', 'moscow', null), 800_000);
check('лобок одинаков', zonePrice('pubis', 'moscow', null), 200_000);
check('голень Москва', zonePrice('shin', 'moscow', null), 600_000);
check('руки до 85 Каспийск', zonePrice('arms', 'kaspiysk', 85), 250_000);
check('руки от 86 Каспийск', zonePrice('arms', 'kaspiysk', 86), 300_000);

console.log('— нужен ли вес —');
check('живот требует вес', weightNeeded(['belly']), true);
check('подбородок не требует', weightNeeded(['chin']), false);
check('подбородок+живот требует', weightNeeded(['chin', 'belly']), true);

console.log('— текст ответа —');
const q1 = buildQuote({ city: 'moscow', weight: 80, zones: ['belly'] });
check('живот 80 кг Москва = 400 000',
  q1?.text.includes('400 000 ₽'), true);
check('город в тексте', q1?.text.includes('Москва'), true);

const q2 = buildQuote({ city: 'kaspiysk', weight: 90, zones: ['arms'], armpits: true });
check('руки с подмышками = 300 000 + 50 000',
  q2?.text.includes('350 000 ₽'), true);

const q3 = buildQuote({ city: 'moscow', weight: 80, zones: ['belly'], pubisWithBelly: true });
check('живот с лобком = 400 000 + 50 000',
  q3?.text.includes('450 000 ₽'), true);

const q4 = buildQuote({ city: 'moscow', weight: 80, zones: ['belly', 'chin'] });
check('две зоны: есть итого', q4?.text.includes('Итого'), true);
check('две зоны: сумма 400 000 + 200 000',
  q4?.text.includes('600 000 ₽'), true);

const q5 = buildQuote({ city: 'moscow', weight: null, zones: ['belly'] });
check('живот без веса — нельзя посчитать', q5, null);

const q6 = buildQuote({ city: 'moscow', weight: null, zones: ['chin'] });
check('подбородок без веса — можно', q6?.text.includes('200 000 ₽'), true);

console.log('— разбор шаблона вопросов —');
const TPL = `Здравствуйте 🌹

Для того чтобы мы написали вам стоимость лазерной липосакции
Укажите пожалуйста:

1️⃣Какой город вас интересует Каспийск или Москва

2️⃣Ваш вес ?

3️⃣Какая зона вас интересует? 🤍`;

const p = parseAskTemplate(TPL);
check('приветствие отделено от пунктов',
  p.greeting.startsWith('Здравствуйте') && !p.greeting.includes('1️⃣'), true);
check('пункт города без соседних', p.city.includes('город') && !p.city.includes('вес'), true);
check('пункт веса', p.weight, '2️⃣Ваш вес ?');
check('пункт зоны', p.zone, '3️⃣Какая зона вас интересует? 🤍');
check('полный текст сохранён', p.full, TPL);

// Шаблон, который владелец переписал своими словами без нумерации: пункты
// не найдены, но ответ всё равно должен быть осмысленным, а не пустым.
const plain = parseAskTemplate('Здравствуйте! Напишите город, вес и зону.');
check('шаблон без нумерации — вопросы запасные',
  plain.city.includes('город') && plain.weight.includes('вес'), true);
check('шаблон без нумерации — приветствия нет', plain.greeting, '');

// Пустой шаблон (темы ещё нет в БД) — берём запасной текст из кода.
const empty = parseAskTemplate('');
check('пустой шаблон → запасной текст', empty.greeting.startsWith('Здравствуйте'), true);

console.log('— служебные тексты ответа —');
const QT = parseQuoteTexts([
  'заголовок: Цены — {city}',
  'итого: Всего: {total}',
  'переспрос-один: Ещё один вопрос:',
  'переспрос-много: Уточните:',
  'хвост:',
  'Первая строка хвоста',
  'Вторая строка хвоста',
].join('\n'));
check('заголовок из шаблона', QT.header, 'Цены — {city}');
check('итого из шаблона', QT.total, 'Всего: {total}');
check('переспрос на один вопрос', QT.askOne, 'Ещё один вопрос:');
check('хвост — две строки', QT.footer, ['Первая строка хвоста', 'Вторая строка хвоста']);

// Частично заполненный шаблон не должен обрезать ответ: недостающие ключи
// берутся из умолчаний, иначе клиент получит цену без объяснения и призыва.
const QTpart = parseQuoteTexts('заголовок: Только заголовок — {city}');
check('частичный шаблон: свой заголовок', QTpart.header, 'Только заголовок — {city}');
check('частичный шаблон: хвост по умолчанию',
  QTpart.footer, DEFAULT_QUOTE_TEXTS.footer);
check('пустой шаблон текстов → умолчания', parseQuoteTexts(''), DEFAULT_QUOTE_TEXTS);

// Подстановки доезжают до готового текста ответа.
const qt = buildQuote({
  city: 'moscow', weight: 80, zones: ['belly'],
  texts: parseQuoteTexts('заголовок: ПРАЙС {city}\nхвост:\nхвостовая строка'),
});
check('заголовок подставил город', qt?.text.startsWith('ПРАЙС Москва'), true);
check('хвост из шаблона в ответе', qt?.text.includes('хвостовая строка'), true);
check('старый хвост не остался', qt?.text.includes('без общего наркоза'), false);

console.log('— прайс из каталога (правка цен в админке) —');
// Каталог той же формы, что строит loadZoneCatalog из БД: проверяем, что
// подменённая цена доезжает до текста ответа, а встроенная не побеждает.
const custom: ZoneCatalog = new Map(BUILTIN_ZONES);
custom.set('chin', {
  key: 'chin', title: 'подбородок (новый прайс)', byWeight: false,
  flat: [111_000, 222_000],
});
custom.set('belly', {
  key: 'belly', title: 'живот', byWeight: true,
  steps: [
    { maxWeight: 75, price: [10_000, 20_000] },
    { maxWeight: Infinity, price: [30_000, 40_000] },
  ],
});

check('фикс. цена из каталога (Каспийск)',
  zonePrice('chin', 'kaspiysk', null, custom), 111_000);
check('фикс. цена из каталога (Москва)',
  zonePrice('chin', 'moscow', null, custom), 222_000);
check('ступень из каталога: 70 кг', zonePrice('belly', 'moscow', 70, custom), 20_000);
check('ступень из каталога: 120 кг', zonePrice('belly', 'moscow', 120, custom), 40_000);
check('встроенный прайс не подменён', zonePrice('chin', 'kaspiysk', null), 150_000);

const qc = buildQuote({ city: 'moscow', weight: 70, zones: ['belly'], catalog: custom });
check('ответ собран по каталогу', qc?.text.includes('20 000 ₽'), true);
check('название зоны из каталога',
  zoneTitle('chin', custom), 'подбородок (новый прайс)');

// Зона, выключенная в админке, из каталога исчезает: считать её нечем, и
// вопрос обязан уйти администратору, а не получить цену из кода.
const without: ZoneCatalog = new Map(BUILTIN_ZONES);
without.delete('chin');
check('выключенная зона не считается',
  zonePrice('chin', 'moscow', null, without), null);
check('нужен ли вес — по каталогу',
  weightNeeded(['chin'], custom), false);

console.log('— подстановка цен в текст шаблона —');
check('цена по городу',
  renderPrices('Каспийск — {цена:chin:каспийск}', custom), 'Каспийск — 111 000 ₽');
check('цена по второму городу',
  renderPrices('Москва — {цена:chin:москва}', custom), 'Москва — 222 000 ₽');
check('обе цены без указания города',
  renderPrices('{цена:chin}', custom), '111 000 ₽ / 222 000 ₽');
check('две метки в одной строке',
  renderPrices('{цена:chin:каспийск} и {цена:galife:москва}', custom),
  '111 000 ₽ и 300 000 ₽');

// Весовую зону подставить нельзя — у неё нет одной суммы. Метка остаётся
// видимой: пустое место читается как потерянный текст, а метка сразу
// показывает, что зону надо вести опросником.
check('весовая зона не подставляется',
  renderPrices('{цена:belly:москва}', custom), '{цена:belly:москва}');
check('опечатка в ключе видна',
  renderPrices('{цена:неттакой:москва}', custom), '{цена:неттакой:москва}');
check('текст без меток не меняется',
  renderPrices('Просто текст про 150 000 ₽', custom), 'Просто текст про 150 000 ₽');

console.log('— интерес к цене: фразы из реальной переписки —');
// Все примеры взяты из выгрузки 8093 входящих за два месяца.
for (const t of [
  'Услуга липосакция',            // на этом бот вставал
  'Услуга',
  'Липосакция',
  'Зона галифе',
  'Лазерная липосакция ‼️НОГ‼️',
  'Каспийск / Вес 71кг / Зона живота',
  'Москва, 74кг, живот и бока',
  'Меня интересует живот руки и бедра',
  'Здравствуйте,устранение второго подбородка',
  'Сколько стоит?',
  'Прайс скиньте',
  'Вес 63',
  'каспийск',
  '75 кг',
]) check(`ловим: ${t.slice(0, 32)}`, looksLikeServiceInterest(t), true);

// Мимо опросника — проверено по тем же данным: это 670 первых сообщений,
// и ни одно из них не должно запускать расчёт цены.
for (const t of [
  'Здравствуйте', 'Добрый день', 'спасибо большое', '+', 'ок', '???',
  'Пока собираю информацию',
  'Ищу работу, есть вакансии косметолога?',
  'болит живот после родов?',
  'можно ли при беременности',
  'Здравствуйте.Я хотела узнать про реабилитацию после липосакции живота?',
  'А можно ли эту процедуру делать при аутоиммунных заболеваниях?',
  'Сколько по времени нужно носить белье и какие противопоказания',
  'Я сейчас кормлю грудью, через сколько можно проводить процедуру?',
]) check(`мимо: ${t.slice(0, 32)}`, looksLikeServiceInterest(t), false);

console.log('— вес: записи из реальной переписки —');
check('«Вес 63»', parseWeight('Вес 63'), 63);
check('«Вес-89»', parseWeight('Вес-89'), 89);
check('«мой вес 115»', parseWeight('здравствуйте,москва) мой вес 115'), 115);
check('«57 к»', parseWeight('57 к'), 57);
check('«66 ко»', parseWeight('москва 66 ко'), 66);
check('«68,5»', parseWeight('каспийск, вес 68,5'), 68.5);
check('рост не вес', parseWeight('166 см рост а вес 65 кг'), 65);
check('возраст не вес', parseWeight('живот и руки вес 95 кг 55 лет'), 95);

console.log('— город: населённые пункты из переписки —');
check('Избербаш → Каспийск', parseCity('город избербаш'), 'kaspiysk');
check('Кочубей → Каспийск', parseCity('я с кочубея'), 'kaspiysk');
check('Дербент → Каспийск', parseCity('дербент'), 'kaspiysk');
check('«и тот и тот» → не ответ', parseCity('и тот и тот'), null);
check('«в двух городах» → не ответ', parseCity('подскажите в двух городах'), null);
check('«оба» → не ответ', parseCity('можно оба города цена?'), null);

console.log('— вежливость посреди опроса не сбрасывает разговор —');
// Клиент вернулся через час и поздоровался заново: город и вес уже
// собраны, терять их нельзя. Проверяем сам распознаватель вежливости.
for (const t of [
  'Здравствуйте', 'здравствуйте!', 'Добрый день', 'Доброе утро',
  'спасибо', 'Спасибо большое', 'хорошо', 'ок', 'Да', '+', '🙏', '❤️',
]) check(`вежливость: ${t}`, isPoliteOnly(t), true);

for (const t of ['Каспийск', '70', 'живот', 'сколько стоит?', 'а ноги?']) {
  check(`не вежливость: ${t}`, isPoliteOnly(t), false);
}

console.log(`\nИтого: ${ok} прошло, ${fail} упало`);
process.exit(fail ? 1 : 0);
