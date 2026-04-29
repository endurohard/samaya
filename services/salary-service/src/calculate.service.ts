export type SchemeType = 'rate' | 'rate_plus_percent' | 'percent_only';
export type RatePeriod = 'day' | 'week' | 'month';

export interface SalaryScheme {
  id: string;
  scheme_type: SchemeType;
  rate_amount: number;
  rate_period: RatePeriod;
  percent_services: number;
  guaranteed: number;
}

export interface MasterSalaryResult {
  rate: number;
  pct_services: number;
  guaranteed: number;
  total: number;
}

export function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00Z').getTime();
  const b = new Date(to + 'T00:00:00Z').getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

export function computeMasterSalary(
  scheme: SalaryScheme | null,
  salesTotal: number,
  days: number,
): MasterSalaryResult {
  if (!scheme) return { rate: 0, pct_services: 0, guaranteed: 0, total: 0 };

  let rate = 0;
  let pct_services = 0;

  if (scheme.scheme_type === 'rate' || scheme.scheme_type === 'rate_plus_percent') {
    let perDay = 0;
    if (scheme.rate_period === 'day') perDay = scheme.rate_amount;
    else if (scheme.rate_period === 'week') perDay = scheme.rate_amount / 7;
    else perDay = scheme.rate_amount / 30;
    rate = Math.round(perDay * days);
  }

  if (scheme.scheme_type === 'percent_only' || scheme.scheme_type === 'rate_plus_percent') {
    pct_services = Math.round(salesTotal * (scheme.percent_services / 100));
  }

  const earned = rate + pct_services;
  const total = Math.max(earned, scheme.guaranteed);

  return { rate, pct_services, guaranteed: scheme.guaranteed, total };
}
