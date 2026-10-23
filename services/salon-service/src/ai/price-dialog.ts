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
} from './price';

/** Текст с тремя вопросами — он же шаблон темы «Цена лазерной липосакции». */
export const ASK_ALL = `Здравствуйте 🌹

Для того чтобы мы написали вам стоимость лазерной липосакции
Укажите пожалуйста:

1️⃣Какой город вас интересует Каспийск или Москва (прием ведем только в двух городах)

2️⃣Ваш вес ?

3️⃣Какая зона вас интересует? 🤍`;

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
}

const EMPTY: DialogState = {
  city: null, weight: null, zones: [], armpits: false,
  pubisBelly: false, quotedAt: null,
};

export async function loadState(
  companyId: string, channel: string, threadId: string,
): Promise<DialogState> {
  const { rows } = await pool.query(
    `SELECT city, weight, zones, armpits, pubis_belly, quoted_at
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
  };
}

async function saveState(
  companyId: string, channel: string, threadId: string, s: DialogState,
): Promise<void> {
  await pool.query(
    `INSERT INTO ai.price_dialog
       (company_id, channel, thread_id, city, weight, zones, armpits,
        pubis_belly, quoted_at, asked_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, now(), now())
     ON CONFLICT (company_id, channel, thread_id) DO UPDATE SET
       city = EXCLUDED.city,
       weight = EXCLUDED.weight,
       zones = EXCLUDED.zones,
       armpits = EXCLUDED.armpits,
       pubis_belly = EXCLUDED.pubis_belly,
       quoted_at = EXCLUDED.quoted_at,
       updated_at = now()`,
    [
      companyId, channel, threadId, s.city, s.weight, s.zones,
      s.armpits, s.pubisBelly, s.quotedAt,
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

/** Текст с вопросами, которых ещё не хватает. */
function askMissing(s: DialogState, needWeight: boolean): string {
  const q: string[] = [];
  if (!s.city) {
    q.push('1️⃣Какой город вас интересует Каспийск или Москва (прием ведем только в двух городах)');
  }
  if (needWeight && s.weight == null) q.push('2️⃣Ваш вес ?');
  if (!s.zones.length) q.push('3️⃣Какая зона вас интересует? 🤍');

  // Для консультации нужны все три ответа, поэтому формулировка мягкая:
  // клиент уже что-то ответил, и повторять «укажите пожалуйста» целиком
  // выглядело бы так, будто его не услышали.
  const head = q.length === 1
    ? 'Спасибо! Остался один вопрос:'
    : 'Спасибо! Уточните, пожалуйста:';
  return [head, '', ...q].join('\n\n');
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

  const next: DialogState = {
    city,
    weight,
    zones,
    armpits: prev.armpits || wantsArmpits(text),
    pubisBelly: prev.pubisBelly || wantsPubisWithBelly(text, zones),
    quotedAt: prev.quotedAt,
  };

  const needWeight = zones.length ? weightNeeded(zones) : true;
  const ready = !!next.city && zones.length > 0 && (!needWeight || next.weight != null);

  if (!ready) {
    await saveState(companyId, channel, threadId, next);
    // Ничего нового не узнали и вопросы уже задавали — не повторяем их по
    // кругу: клиент мог написать «ну так сколько?», и третий одинаковый
    // ответ выглядит как неисправный бот. Отдаём администратору.
    const learned =
      next.city !== prev.city ||
      next.weight !== prev.weight ||
      zones.length !== prev.zones.length;
    if (!learned && !opts.fresh) {
      return {
        kind: 'handover', reply: null,
        reason: 'клиент не отвечает на вопросы о городе, весе и зоне',
        state: next,
      };
    }
    const reply = opts.fresh && !next.city && !next.weight && !zones.length
      ? ASK_ALL
      : askMissing(next, needWeight);
    return { kind: 'ask', reply, reason: null, state: next };
  }

  const quote = buildQuote({
    city: next.city!,
    weight: next.weight,
    zones,
    armpits: next.armpits,
    pubisWithBelly: next.pubisBelly,
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
  const zonesText = zones.map(zoneTitle).join(', ');
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
  return !!s.city || s.weight != null || s.zones.length > 0;
}
