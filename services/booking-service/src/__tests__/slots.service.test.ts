import { describe, it, expect } from 'vitest';
import { generateSlots } from '../slots.service';
import type { TimeRange } from '../slots.service';

const MIN = 60_000;

function makeRange(dayStart: Date, offsetMin: number, durationMin: number): TimeRange {
  const s = new Date(dayStart.getTime() + offsetMin * MIN);
  const e = new Date(s.getTime() + durationMin * MIN);
  return { starts_at: s.toISOString(), ends_at: e.toISOString() };
}

// Working day 09:00–18:00 UTC for test simplicity
const DAY_START = new Date('2026-04-29T09:00:00Z');
const DAY_END   = new Date('2026-04-29T18:00:00Z');
const STEP_MS   = 15 * MIN; // 15-min step

describe('generateSlots', () => {
  it('returns slots covering the whole day when no bookings', () => {
    const slots = generateSlots(DAY_START, DAY_END, 60 * MIN, STEP_MS, []);
    // 09:00–17:00 window with 15-min step = (9h - 1h) / 15min + 1 = 33 slots
    expect(slots.length).toBe(33);
    expect(slots[0].starts_at).toBe('2026-04-29T09:00:00.000Z');
    expect(slots[0].ends_at).toBe('2026-04-29T10:00:00.000Z');
    expect(slots[slots.length - 1].starts_at).toBe('2026-04-29T17:00:00.000Z');
  });

  it('returns empty array when duration equals day length', () => {
    const slots = generateSlots(DAY_START, DAY_END, 9 * 60 * MIN, STEP_MS, []);
    expect(slots).toHaveLength(1);
    expect(slots[0].starts_at).toBe(DAY_START.toISOString());
  });

  it('returns empty array when duration exceeds day length', () => {
    const slots = generateSlots(DAY_START, DAY_END, 10 * 60 * MIN, STEP_MS, []);
    expect(slots).toHaveLength(0);
  });

  it('skips slot that exactly overlaps a booking', () => {
    const booking = makeRange(DAY_START, 0, 60); // 09:00–10:00 booked
    const slots = generateSlots(DAY_START, DAY_END, 60 * MIN, STEP_MS, [booking]);
    // 09:00–10:00 slot is taken; next slot at 09:15 also overlaps (09:15–10:15 overlaps 09:00–10:00)
    // All slots that would start before 10:00 overlap
    const first = new Date(slots[0].starts_at);
    expect(first.getTime()).toBe(new Date('2026-04-29T10:00:00Z').getTime());
  });

  it('skips slot that partially overlaps at the start', () => {
    // Booking 09:30–10:00. A 60-min slot at 09:00 (09:00–10:00) overlaps because 09:00 < 10:00 && 10:00 > 09:30
    const booking = makeRange(DAY_START, 30, 30); // 09:30–10:00
    const slots = generateSlots(DAY_START, DAY_END, 60 * MIN, STEP_MS, [booking]);
    const firstOk = new Date(slots[0].starts_at);
    expect(firstOk.getTime()).toBe(new Date('2026-04-29T10:00:00Z').getTime());
  });

  it('skips slot that partially overlaps at the end', () => {
    // Booking 09:45–10:30. A 60-min slot at 09:30 (09:30–10:30) overlaps.
    const booking = makeRange(DAY_START, 45, 45); // 09:45–10:30
    const slots = generateSlots(DAY_START, DAY_END, 60 * MIN, STEP_MS, [booking]);
    const starts = slots.map((s) => s.starts_at);
    expect(starts).not.toContain('2026-04-29T09:30:00.000Z');
    // Slot at 10:30 should be fine (ends 11:30, booking ended at 10:30 so t < be is 10:30 < 10:30 → false)
    expect(starts).toContain('2026-04-29T10:30:00.000Z');
  });

  it('slot abutting booking end is valid (no overlap)', () => {
    // Booking 09:00–10:00. Slot at 10:00–11:00 → t=10:00, slotEnd=11:00, b.end=10:00: t < b.end is false
    const booking = makeRange(DAY_START, 0, 60);
    const slots = generateSlots(DAY_START, DAY_END, 60 * MIN, STEP_MS, [booking]);
    const starts = slots.map((s) => s.starts_at);
    expect(starts).toContain('2026-04-29T10:00:00.000Z');
  });

  it('slot abutting booking start is valid (slot ends exactly when booking starts)', () => {
    // Booking 11:00–12:00. Slot at 10:00–11:00 → slotEnd=11:00, b.start=11:00: slotEnd > b.start is false
    const booking = makeRange(DAY_START, 120, 60); // 11:00–12:00
    const slots = generateSlots(DAY_START, DAY_END, 60 * MIN, STEP_MS, [booking]);
    const starts = slots.map((s) => s.starts_at);
    expect(starts).toContain('2026-04-29T10:00:00.000Z');
  });

  it('handles multiple non-overlapping bookings', () => {
    const bookings = [
      makeRange(DAY_START, 0, 60),   // 09:00–10:00
      makeRange(DAY_START, 180, 60), // 12:00–13:00
    ];
    const slots = generateSlots(DAY_START, DAY_END, 60 * MIN, STEP_MS, bookings);
    const starts = slots.map((s) => s.starts_at);
    // Should be blocked around 09:xx and 12:xx
    expect(starts).not.toContain('2026-04-29T09:00:00.000Z');
    expect(starts).not.toContain('2026-04-29T11:15:00.000Z'); // 11:15–12:15 overlaps 12:00–13:00
    expect(starts).toContain('2026-04-29T10:00:00.000Z');
    expect(starts).toContain('2026-04-29T13:00:00.000Z');
  });

  it('returns empty when a single booking covers the whole day', () => {
    const booking = makeRange(DAY_START, 0, 9 * 60); // 09:00–18:00
    const slots = generateSlots(DAY_START, DAY_END, 60 * MIN, STEP_MS, [booking]);
    expect(slots).toHaveLength(0);
  });

  it('uses step correctly — adjacent slots differ by stepMs', () => {
    const slots = generateSlots(DAY_START, DAY_END, 30 * MIN, STEP_MS, []);
    for (let i = 1; i < slots.length; i++) {
      const diff = new Date(slots[i].starts_at).getTime() - new Date(slots[i - 1].starts_at).getTime();
      expect(diff).toBe(STEP_MS);
    }
  });
});
