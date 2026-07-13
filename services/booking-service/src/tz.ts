// Работа с таймзоной компании (IANA, напр. 'Europe/Moscow') без внешних библиотек.
// Через Intl вычисляем фактический offset зоны на конкретный момент — корректно
// и для зон с переходом на летнее время.

// Смещение зоны tz (в мс) на момент date: сколько прибавить к UTC, чтобы получить
// «настенное» время зоны.
function tzOffsetMs(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') map[p.type] = Number(p.value);
  // '24' на полуночи в некоторых движках → 0
  const hour = map.hour === 24 ? 0 : map.hour;
  const asIfUtc = Date.UTC(map.year, map.month - 1, map.day, hour, map.minute, map.second);
  return asIfUtc - date.getTime();
}

// Настенное время (dateStr YYYY-MM-DD + timeStr HH:MM[:SS]) в зоне tz → UTC-момент.
export function zonedWallTimeToUtc(dateStr: string, timeStr: string, tz: string): Date {
  const [y, mo, d] = dateStr.split('-').map(Number);
  const [h, mi, s] = timeStr.split(':').map(Number);
  const naiveUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  // Двойная аппроксимация покрывает переходы DST.
  let offset = tzOffsetMs(tz, new Date(naiveUtc));
  offset = tzOffsetMs(tz, new Date(naiveUtc - offset));
  return new Date(naiveUtc - offset);
}

// Локальная дата YYYY-MM-DD в зоне tz для UTC-момента.
export function zonedLocalDate(instant: Date, tz: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  });
  return dtf.format(instant); // en-CA даёт YYYY-MM-DD
}
