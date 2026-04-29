import { describe, it, expect } from 'vitest';

describe('inventory-service smoke', () => {
  it('config validates env, worker disabled in test', async () => {
    const mod = await import('../config');
    expect(mod.config.PORT).toBe(3005);
    expect(mod.config.CONSUME_WORKER_ENABLED).toBe(false);
  });

  it('jwt module imports', async () => {
    const mod = await import('../jwt');
    expect(typeof mod.verifyAccess).toBe('function');
  });
});
