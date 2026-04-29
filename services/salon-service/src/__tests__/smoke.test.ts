import { describe, it, expect } from 'vitest';

describe('salon-service smoke', () => {
  it('config validates env without crash', async () => {
    const mod = await import('../config');
    expect(mod.config.PORT).toBe(3002);
    expect(mod.config.NODE_ENV).toBe('test');
  });

  it('jwt module imports', async () => {
    const mod = await import('../jwt');
    expect(typeof mod.verifyAccess).toBe('function');
  });
});
