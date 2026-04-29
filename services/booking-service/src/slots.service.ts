export interface TimeRange {
  starts_at: string; // ISO string
  ends_at: string;   // ISO string
}

/**
 * Generates available time slots within a working day, skipping intervals
 * that overlap with existing bookings.
 *
 * @param dayStart    - Start of working day (Date)
 * @param dayEnd      - End of working day (Date)
 * @param durationMs  - Duration of the requested service combo in milliseconds
 * @param stepMs      - Slot step in milliseconds (e.g., 15 min)
 * @param bookings    - Existing bookings to avoid (as TimeRange[])
 */
export function generateSlots(
  dayStart: Date,
  dayEnd: Date,
  durationMs: number,
  stepMs: number,
  bookings: TimeRange[],
): TimeRange[] {
  const slots: TimeRange[] = [];
  const booked = bookings.map((b) => ({
    start: new Date(b.starts_at).getTime(),
    end: new Date(b.ends_at).getTime(),
  }));

  for (let t = dayStart.getTime(); t + durationMs <= dayEnd.getTime(); t += stepMs) {
    const slotEnd = t + durationMs;
    const overlaps = booked.some((b) => t < b.end && slotEnd > b.start);
    if (!overlaps) {
      slots.push({
        starts_at: new Date(t).toISOString(),
        ends_at: new Date(slotEnd).toISOString(),
      });
    }
  }

  return slots;
}
