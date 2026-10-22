import { describe, it, expect } from 'vitest';
import {
  PERMISSION_MODULES,
  allPermissionKeys,
  roleDefaults,
  effectivePermissions,
  hasPermission,
} from '../permissions';

describe('каталог прав', () => {
  it('ключи уникальны — иначе галочка в настройках управляет не тем', () => {
    const keys = allPermissionKeys();
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('модуль AI-ассистента есть в каталоге', () => {
    // Без него раздел нельзя выдать никому, кроме owner/admin: галочки
    // просто не существует в интерфейсе управления доступом.
    const ai = PERMISSION_MODULES.find((m) => m.key === 'ai');
    expect(ai).toBeDefined();
    expect(ai!.actions.map((a) => a.key).sort()).toEqual(['manage', 'view', 'view_log']);
  });
});

describe('дефолты ролей', () => {
  it('owner получает все права', () => {
    const p = roleDefaults('owner');
    for (const k of allPermissionKeys()) expect(p[k]).toBe(true);
  });

  it('admin получает всё, кроме управления доступом', () => {
    const p = roleDefaults('admin');
    expect(p['settings.access']).toBe(false);
    expect(p['ai.manage']).toBe(true);
  });

  it('master по умолчанию не управляет ассистентом', () => {
    const p = roleDefaults('master');
    expect(p['ai.manage']).toBe(false);
    expect(p['ai.view']).toBe(false);
  });
});

describe('персональные права поверх роли', () => {
  it('маркетологу с ролью master можно выдать шаблоны ответов', () => {
    // Ровно случай, ради которого право и заведено: сотрудник ведёт
    // тексты, но не должен получать роль администратора.
    const p = effectivePermissions('master', { 'ai.view': true, 'ai.manage': true });
    expect(hasPermission(p, 'ai.manage')).toBe(true);
    // Остальное роль не расширяет.
    expect(hasPermission(p, 'finance.view')).toBe(false);
    expect(hasPermission(p, 'settings.access')).toBe(false);
  });

  it('журнал решений выдаётся отдельно от шаблонов', () => {
    const p = effectivePermissions('master', { 'ai.manage': true });
    expect(hasPermission(p, 'ai.view_log')).toBe(false);
  });

  it('несуществующие ключи игнорируются', () => {
    const p = effectivePermissions('master', { 'ai.everything': true });
    expect(p['ai.everything']).toBeUndefined();
  });

  it('у owner права нельзя урезать overrides', () => {
    const p = effectivePermissions('owner', { 'ai.manage': false });
    expect(hasPermission(p, 'ai.manage')).toBe(true);
  });
});
