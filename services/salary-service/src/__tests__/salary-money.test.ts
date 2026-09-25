import { describe, it, expect } from 'vitest';
import {
  splitEqually,
  discountRatio,
  bookingRevenue,
  payableDays,
  companyDateOf,
  computeMasterSalary,
} from '../calculate.service';
import type { SalaryScheme } from '../calculate.service';

// Здесь проверяется всё, что двигает деньги: делёж пула, учёт скидки и
// оплата ставки по сменам. Ошибка в любой из этих функций — это реальная
// переплата или недоплата сотруднику, а не косметика.

describe('splitEqually — делёж пула между сотрудниками', () => {
  it('делит поровну, когда сумма делится нацело', () => {
    const shares = splitEqually(3000, ['a', 'b', 'c']);
    expect([...shares.values()]).toEqual([1000, 1000, 1000]);
  });

  it('не теряет копейки: сумма долей равна пулу', () => {
    const shares = splitEqually(1000, ['a', 'b', 'c']);
    const sum = [...shares.values()].reduce((x, y) => x + y, 0);
    expect(sum).toBe(1000);
    expect([...shares.values()].sort()).toEqual([333, 333, 334]);
  });

  it('сценарий владельца: 2% с услуги 100 000 на троих менеджеров', () => {
    const pool = 100_000 * 0.02; // 2000 на всю группу, а не каждому
    const shares = splitEqually(pool, ['m1', 'm2', 'm3']);
    const sum = [...shares.values()].reduce((x, y) => x + y, 0);
    expect(sum).toBe(2000);
    expect([...shares.values()].sort()).toEqual([666, 667, 667]);
  });

  it('стабилен между пересчётами одного периода', () => {
    const first = splitEqually(1000, ['b', 'a', 'c']);
    const second = splitEqually(1000, ['c', 'b', 'a']);
    expect([...first.entries()].sort()).toEqual([...second.entries()].sort());
  });

  it('пустая группа не получает ничего и не роняет расчёт', () => {
    expect(splitEqually(5000, []).size).toBe(0);
  });

  it('нулевой и отрицательный пул не начисляются', () => {
    expect(splitEqually(0, ['a']).size).toBe(0);
    expect(splitEqually(-100, ['a']).size).toBe(0);
  });

  it('пул меньше числа участников — остаток раздаётся по рублю', () => {
    const shares = splitEqually(2, ['a', 'b', 'c']);
    expect([...shares.values()].reduce((x, y) => x + y, 0)).toBe(2);
    expect(shares.get('a')).toBe(1);
    expect(shares.get('c')).toBe(0);
  });
});

describe('bookingRevenue — база для процента мастера', () => {
  it('вычитает скидку: касса получила меньше — и процент меньше', () => {
    expect(bookingRevenue(60_000, 23_400)).toBe(36_600);
  });

  it('без скидки равна стоимости', () => {
    expect(bookingRevenue(31_000)).toBe(31_000);
  });

  it('скидка больше суммы не уводит выручку в минус', () => {
    expect(bookingRevenue(1000, 5000)).toBe(0);
  });
});

describe('discountRatio — разнос скидки записи по услугам', () => {
  it('39% скидки дают долю 0.39 для каждой услуги', () => {
    expect(discountRatio(60_000, 23_400)).toBeCloseTo(0.39, 5);
  });

  it('без скидки доля нулевая', () => {
    expect(discountRatio(10_000, 0)).toBe(0);
  });

  it('скидка не может превысить 100% стоимости', () => {
    expect(discountRatio(1000, 5000)).toBe(1);
  });

  it('нулевая стоимость не приводит к делению на ноль', () => {
    expect(discountRatio(0, 500)).toBe(0);
  });
});

describe('payableDays — за что платится ставка', () => {
  it('ни графика, ни записей — платим за календарь, а не ноль', () => {
    expect(payableDays(undefined, [], 31)).toBe(31);
  });

  it('отработано 15 смен из 31 дня — платим за 15', () => {
    const d = Array.from({ length: 15 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    expect(payableDays(d, [], 31)).toBe(15);
  });

  it('весь месяц в отпуске — ставка не начисляется', () => {
    expect(payableDays([], [], 31)).toBe(0);
  });

  it('графика нет, но есть дни с записями — платим за эти дни', () => {
    expect(payableDays(undefined, ['2026-09-10', '2026-09-11'], 30)).toBe(2);
  });

  it('день есть и в графике, и в записях — считается один раз', () => {
    expect(payableDays(['2026-09-10'], ['2026-09-10'], 30)).toBe(1);
  });

  it('запись в день, помеченный выходным, всё равно оплачивается', () => {
    expect(payableDays(['2026-09-10'], ['2026-09-12'], 30)).toBe(2);
  });
});

describe('companyDateOf — смена по местному календарю', () => {
  it('закрытие в 21:30 UTC — это уже следующий день по МСК', () => {
    expect(companyDateOf('2026-09-10T21:30:00.000Z')).toBe('2026-09-11');
  });

  it('закрытие в 09:00 UTC остаётся тем же днём', () => {
    expect(companyDateOf('2026-09-10T09:00:00.000Z')).toBe('2026-09-10');
  });

  it('мусорная дата не роняет расчёт', () => {
    expect(companyDateOf('not-a-date')).toBe('');
  });
});

// ===== Полный расчёт по схемам =====

function scheme(over: Partial<SalaryScheme>): SalaryScheme {
  return {
    id: 's1',
    scheme_type: 'percent_only',
    rate_amount: 0,
    rate_period: 'month',
    percent_services: 0,
    percent_goods: 0,
    guaranteed: 0,
    ...over,
  };
}

describe('computeMasterSalary со скидкой', () => {
  it('30% с выручки после скидки, а не с прайса', () => {
    const sales = bookingRevenue(60_000, 23_400); // 36 600
    const r = computeMasterSalary(scheme({ percent_services: 30 }), sales, 30, 30);
    expect(r.pct_services).toBe(10_980);
    // До исправления начислялось бы 18 000 — переплата 7 020.
    expect(r.pct_services).toBeLessThan(18_000);
  });

  it('ставка за месяц делится на реальное число дней месяца', () => {
    const r = computeMasterSalary(
      scheme({ scheme_type: 'rate', rate_amount: 31_000, rate_period: 'month' }),
      0, 31, 31,
    );
    expect(r.rate).toBe(31_000);
  });

  it('половина смен — половина ставки', () => {
    const r = computeMasterSalary(
      scheme({ scheme_type: 'rate', rate_amount: 30_000, rate_period: 'month' }),
      0, 15, 30,
    );
    expect(r.rate).toBe(15_000);
  });

  it('гарантированный минимум подтягивает итог', () => {
    const r = computeMasterSalary(
      scheme({ percent_services: 10, guaranteed: 20_000 }), 50_000, 30, 30,
    );
    expect(r.pct_services).toBe(5000);
    expect(r.total).toBe(20_000);
  });

  it('без схемы начислений нет', () => {
    expect(computeMasterSalary(null, 100_000, 30, 30).total).toBe(0);
  });
});
