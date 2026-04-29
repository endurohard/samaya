import { describe, it, expect } from 'vitest';

describe('booking-service smoke', () => {
  it('config validates env and provides defaults', async () => {
    const mod = await import('../config');
    expect(mod.config.PORT).toBe(3003);
    expect(mod.config.COMPANY_TZ_OFFSET).toBe('+03:00');
    expect(mod.config.SLOT_STEP_MINUTES).toBe(15);
  });

  it('toCompanyTime parses date+time with offset', async () => {
    const { toCompanyTime } = await import('../services');
    const d = toCompanyTime('2026-04-25', '10:00');
    // 10:00 Moscow (+03:00) = 07:00 UTC
    expect(d.toISOString()).toBe('2026-04-25T07:00:00.000Z');
  });

  it('jwt verifyAccess is exported', async () => {
    const mod = await import('../jwt');
    expect(typeof mod.verifyAccess).toBe('function');
  });
});
