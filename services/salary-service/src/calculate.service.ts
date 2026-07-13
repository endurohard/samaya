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
