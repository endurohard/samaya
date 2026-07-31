// Диапазоны дат для периодных фильтров (аналитика, продажи, зарплата, финансы).
//
// Раньше каждый раздел считал их сам — четыре почти одинаковых функции. В двух
// из них дата собиралась через `new Date(iso).toISOString()`, а это переводит
// локальную полночь в UTC: в Москве (+3) «2026-07-31T00:00» превращается в
// «2026-07-30», и весь диапазон уезжал на сутки назад («вчера» показывало
// позавчера, «неделя» брала 8 дней). Здесь дата собирается только локальными
// геттерами — см. dateToISO/addDaysISO в utils.

import { todayLocalISO, addDaysISO } from './utils.js';

// Скользящие периоды, заканчивающиеся сегодняшним днём:
// аналитика, продажи, зарплата.
export function rollingRange(period) {
  const today = todayLocalISO();
  switch (period) {
    case 'yesterday': {
      const y = addDaysISO(today, -1);
      return { from: y, to: y };
    }
    case 'week':  return { from: addDaysISO(today, -6), to: today };
    case 'month': return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'year':  return { from: `${today.slice(0, 4)}-01-01`, to: today };
    default:      return { from: today, to: today };
  }
}

// Полные календарные периоды — финансы: неделя Пн–Вс целиком, месяц и год
// до последнего дня, даже если он ещё не наступил (так считается касса).
export function calendarRange(period) {
  const today = todayLocalISO();
  const [y, m] = today.split('-').map(Number);
  switch (period) {
    case 'yesterday': {
      const d = addDaysISO(today, -1);
      return { from: d, to: d, label: 'вчера' };
    }
    case 'week': {
      const dow = new Date(y, m - 1, Number(today.slice(8))).getDay(); // 0 = вс
      const from = addDaysISO(today, dow === 0 ? -6 : 1 - dow);
      return { from, to: addDaysISO(from, 6), label: 'эта неделя' };
    }
    case 'month': {
      const last = new Date(y, m, 0).getDate();
      return {
        from: `${today.slice(0, 7)}-01`,
        to: `${today.slice(0, 7)}-${String(last).padStart(2, '0')}`,
        label: 'этот месяц',
      };
    }
    case 'year':
      return { from: `${y}-01-01`, to: `${y}-12-31`, label: 'этот год' };
    default:
      return { from: today, to: today, label: 'сегодня' };
  }
}

// Число дней в диапазоне включительно — база для дневных ставок в ЗП.
export function daysInRange(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const ms = new Date(ty, tm - 1, td) - new Date(fy, fm - 1, fd);
  return Math.round(ms / 86_400_000) + 1;
}

// Границы месяца по якорю «YYYY-MM» — сетка графика работы.
export function monthRange(monthAnchor) {
  const [y, m] = monthAnchor.split('-').map(Number);
  const mm = String(m).padStart(2, '0');
  const days = new Date(y, m, 0).getDate();
  return {
    from: `${y}-${mm}-01`,
    to: `${y}-${mm}-${String(days).padStart(2, '0')}`,
    y, m, days,
  };
}
