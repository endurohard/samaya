import { describe, it, expect } from 'vitest';
import { daysBetween, computeMasterSalary } from '../calculate.service';
import type { SalaryScheme } from '../calculate.service';

// ===== daysBetween =====

describe('daysBetween', () => {
  it('same day returns 1', () => {
    expect(daysBetween('2026-04-01', '2026-04-01')).toBe(1);
  });

  it('counts inclusive range (1 week = 7 days)', () => {
    expect(daysBetween('2026-04-01', '2026-04-07')).toBe(7);
  });

  it('full month April has 30 days', () => {
    expect(daysBetween('2026-04-01', '2026-04-30')).toBe(30);
  });

  it('cross-month boundary', () => {
    expect(daysBetween('2026-03-30', '2026-04-02')).toBe(4);
  });

  it('returns at least 1 even for reversed dates', () => {
    expect(daysBetween('2026-04-10', '2026-04-01')).toBe(1);
  });
});

// ===== computeMasterSalary =====

function makeScheme(overrides: Partial<SalaryScheme>): SalaryScheme {
  return {
    id: 'scheme-1',
    scheme_type: 'rate',
    rate_amount: 0,
    rate_period: 'month',
    percent_services: 0,
    guaranteed: 0,
    ...overrides,
  };
}

describe('computeMasterSalary', () => {
  it('no scheme → all zeros', () => {
    expect(computeMasterSalary(null, 10000, 30)).toEqual({
      rate: 0,
      pct_services: 0,
      guaranteed: 0,
      total: 0,
    });
  });

  describe('rate scheme (daily)', () => {
    it('daily rate × days', () => {
      const scheme = makeScheme({ scheme_type: 'rate', rate_amount: 500, rate_period: 'day' });
      const { rate, total } = computeMasterSalary(scheme, 0, 10);
      expect(rate).toBe(5000);
      expect(total).toBe(5000);
    });
  });

  describe('rate scheme (weekly)', () => {
    it('weekly rate prorated to days', () => {
      const scheme = makeScheme({ scheme_type: 'rate', rate_amount: 7000, rate_period: 'week' });
      // perDay = 7000/7 = 1000, × 7 days = 7000
      const { rate } = computeMasterSalary(scheme, 0, 7);
      expect(rate).toBe(7000);
    });

    it('partial week rounds correctly', () => {
      const scheme = makeScheme({ scheme_type: 'rate', rate_amount: 7000, rate_period: 'week' });
      // perDay = 1000, × 3 = 3000
      const { rate } = computeMasterSalary(scheme, 0, 3);
      expect(rate).toBe(3000);
    });
  });

  describe('rate scheme (monthly)', () => {
    it('monthly rate prorated to 30 days', () => {
      const scheme = makeScheme({ scheme_type: 'rate', rate_amount: 30000, rate_period: 'month' });
      const { rate } = computeMasterSalary(scheme, 0, 30);
      expect(rate).toBe(30000);
    });

    it('monthly rate for partial month', () => {
      const scheme = makeScheme({ scheme_type: 'rate', rate_amount: 30000, rate_period: 'month' });
      // perDay = 1000, × 15 = 15000
      const { rate } = computeMasterSalary(scheme, 0, 15);
      expect(rate).toBe(15000);
    });
  });

  describe('percent_only scheme', () => {
    it('computes percent of sales', () => {
      const scheme = makeScheme({ scheme_type: 'percent_only', percent_services: 40 });
      const { rate, pct_services, total } = computeMasterSalary(scheme, 10000, 30);
      expect(rate).toBe(0);
      expect(pct_services).toBe(4000);
      expect(total).toBe(4000);
    });

    it('rounds pct_services', () => {
      const scheme = makeScheme({ scheme_type: 'percent_only', percent_services: 33 });
      // 10000 * 0.33 = 3300
      const { pct_services } = computeMasterSalary(scheme, 10000, 30);
      expect(pct_services).toBe(3300);
    });

    it('zero sales → zero pct', () => {
      const scheme = makeScheme({ scheme_type: 'percent_only', percent_services: 40 });
      const { pct_services } = computeMasterSalary(scheme, 0, 30);
      expect(pct_services).toBe(0);
    });
  });

  describe('rate_plus_percent scheme', () => {
    it('sums rate and percent', () => {
      const scheme = makeScheme({
        scheme_type: 'rate_plus_percent',
        rate_amount: 30000,
        rate_period: 'month',
        percent_services: 20,
      });
      const { rate, pct_services, total } = computeMasterSalary(scheme, 50000, 30);
      expect(rate).toBe(30000);
      expect(pct_services).toBe(10000);
      expect(total).toBe(40000);
    });
  });

  describe('guaranteed minimum', () => {
    it('total = guaranteed when earned is less', () => {
      const scheme = makeScheme({
        scheme_type: 'percent_only',
        percent_services: 5,
        guaranteed: 20000,
      });
      const { total } = computeMasterSalary(scheme, 10000, 30); // earned = 500
      expect(total).toBe(20000);
    });

    it('total = earned when earned exceeds guaranteed', () => {
      const scheme = makeScheme({
        scheme_type: 'rate',
        rate_amount: 1000,
        rate_period: 'day',
        guaranteed: 5000,
      });
      const { total } = computeMasterSalary(scheme, 0, 10); // earned = 10000
      expect(total).toBe(10000);
    });

    it('total = guaranteed when earned exactly equals it', () => {
      const scheme = makeScheme({
        scheme_type: 'rate',
        rate_amount: 30000,
        rate_period: 'month',
        guaranteed: 30000,
      });
      const { total } = computeMasterSalary(scheme, 0, 30);
      expect(total).toBe(30000);
    });
  });
});
