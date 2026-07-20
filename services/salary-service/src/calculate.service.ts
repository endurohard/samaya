export type SchemeType = 'rate' | 'rate_plus_percent' | 'percent_only';
export type RatePeriod = 'day' | 'week' | 'month';

export interface SalaryScheme {
  id: string;
  scheme_type: SchemeType;
  rate_amount: number;
  rate_period: RatePeriod;
  percent_services: number;
  percent_goods: number;
  guaranteed: number;
}

export interface MasterSalaryResult {
  rate: number;
  pct_services: number;
  pct_goods: number;
  guaranteed: number;
  total: number;
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

// Число календарных дней в месяце локальной даты YYYY-MM-DD.
export function daysInMonthOf(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function computeMasterSalary(
  scheme: SalaryScheme | null,
  salesTotal: number,
  days: number,
  // Опционально: делитель ставки за «месяц» = реальное число дней месяца периода.
  // Если не передан — берётся 30 (обратная совместимость).
  monthDivisor?: number,
  // Выручка по товарам мастера (для percent_goods). Источника продаж товаров в
  // пайплайне пока нет → обычно 0; плечо проброшено, чтобы percent_goods начислялся,
  // как только появится фид продаж.
  goodsTotal = 0,
): MasterSalaryResult {
  if (!scheme) return { rate: 0, pct_services: 0, pct_goods: 0, guaranteed: 0, total: 0 };

  let rate = 0;
  let pct_services = 0;
  let pct_goods = 0;

  if (scheme.scheme_type === 'rate' || scheme.scheme_type === 'rate_plus_percent') {
    let perDay = 0;
    if (scheme.rate_period === 'day') perDay = scheme.rate_amount;
    else if (scheme.rate_period === 'week') perDay = scheme.rate_amount / 7;
    else perDay = scheme.rate_amount / (monthDivisor && monthDivisor > 0 ? monthDivisor : 30);
    rate = Math.round(perDay * days);
  }

  if (scheme.scheme_type === 'percent_only' || scheme.scheme_type === 'rate_plus_percent') {
    pct_services = Math.round(salesTotal * (scheme.percent_services / 100));
    pct_goods = Math.round(goodsTotal * ((scheme.percent_goods || 0) / 100));
  }

  const earned = rate + pct_services + pct_goods;
  const total = Math.max(earned, scheme.guaranteed);

  return { rate, pct_services, pct_goods, guaranteed: scheme.guaranteed, total };
}

// ===== Функции, вынесенные из роута расчёта, чтобы их можно было проверить =====

/**
 * Делит сумму между участниками поровну методом наибольшего остатка.
 * Σ долей всегда равна исходной сумме — копейки не теряются и не задваиваются.
 * Порядок получателей «лишних» рублей стабилен (сортировка по id), иначе при
 * повторном расчёте одного периода суммы у людей прыгали бы.
 */
export function splitEqually(pool: number, memberIds: string[]): Map<string, number> {
  const out = new Map<string, number>();
  const n = memberIds.length;
  if (n === 0 || pool <= 0) return out;
  const amount = Math.round(pool);
  const base = Math.floor(amount / n);
  let remainder = amount - base * n;
  for (const id of [...memberIds].sort()) {
    let share = base;
    if (remainder > 0) { share += 1; remainder -= 1; }
    out.set(id, share);
  }
  return out;
}

/**
 * Доля скидки в стоимости записи. Скидка задаётся на запись целиком, а
 * комиссии считаются по услугам — поэтому её разносят пропорционально цене.
 */
export function discountRatio(servicesSum: number, discountAmount: number): number {
  if (!(servicesSum > 0)) return 0;
  return Math.min(1, Math.max(0, discountAmount) / servicesSum);
}

/** Выручка записи: то, что реально получила касса. Отрицательной не бывает. */
export function bookingRevenue(totalPrice: number, discountAmount = 0): number {
  return Math.max(0, Number(totalPrice) - Number(discountAmount || 0));
}

/**
 * Сколько дней оплачивать по ставке.
 * Пустой график означает «не заполняли» → платим за календарь, иначе
 * сотрудник без графика получил бы ноль. Заполненный график без рабочих
 * дней — честный ноль (отпуск, больничный).
 */
export function payableDays(
  scheduledDays: number | undefined,
  calendarDays: number,
): number {
  return scheduledDays === undefined ? calendarDays : scheduledDays;
}
