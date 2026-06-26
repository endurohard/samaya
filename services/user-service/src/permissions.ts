// RBAC: каталог прав, дефолты по ролям и вычисление эффективных прав.
// Право — строка вида "module.action" (например "clients.edit").
// Эффективные права = дефолты роли, перекрытые персональными overrides из users.permissions.

export interface PermAction { key: string; label: string }
export interface PermModule { key: string; label: string; actions: PermAction[] }

export const PERMISSION_MODULES: PermModule[] = [
  { key: 'clients', label: 'Клиенты', actions: [
    { key: 'view', label: 'Просмотр' },
    { key: 'add', label: 'Добавление' },
    { key: 'edit', label: 'Редактирование' },
    { key: 'delete', label: 'Удаление' },
    { key: 'view_finance', label: 'Видеть финансы клиента' },
    { key: 'view_phones', label: 'Видеть телефоны' },
  ] },
  { key: 'bookings', label: 'Записи', actions: [
    { key: 'view', label: 'Просмотр' },
    { key: 'add', label: 'Создание' },
    { key: 'edit', label: 'Редактирование' },
    { key: 'cancel', label: 'Отмена' },
    { key: 'delete', label: 'Удаление' },
  ] },
  { key: 'schedule', label: 'График', actions: [
    { key: 'view', label: 'Просмотр' },
    { key: 'edit', label: 'Редактирование графика' },
  ] },
  { key: 'services', label: 'Услуги', actions: [
    { key: 'view', label: 'Просмотр' },
    { key: 'manage', label: 'Управление' },
  ] },
  { key: 'inventory', label: 'Склад', actions: [
    { key: 'view', label: 'Просмотр' },
    { key: 'manage', label: 'Управление' },
  ] },
  { key: 'finance', label: 'Финансы', actions: [
    { key: 'view', label: 'Просмотр' },
    { key: 'manage', label: 'Операции' },
  ] },
  { key: 'salary', label: 'Зарплата', actions: [
    { key: 'view', label: 'Просмотр' },
    { key: 'manage', label: 'Начисления и выплаты' },
  ] },
  { key: 'analytics', label: 'Аналитика', actions: [
    { key: 'view', label: 'Просмотр' },
  ] },
  { key: 'settings', label: 'Настройки', actions: [
    { key: 'manage', label: 'Изменение настроек' },
    { key: 'access', label: 'Управление доступом' },
  ] },
];

export type Permissions = Record<string, boolean>;

export function allPermissionKeys(): string[] {
  return PERMISSION_MODULES.flatMap((m) => m.actions.map((a) => `${m.key}.${a.key}`));
}

function fullSet(value: boolean): Permissions {
  const out: Permissions = {};
  for (const k of allPermissionKeys()) out[k] = value;
  return out;
}

// Дефолты по ролям. owner — всё; admin — всё, кроме управления доступом;
// master — ограниченный набор; client — ничего (только клиентский портал).
export function roleDefaults(role: string): Permissions {
  if (role === 'owner') return fullSet(true);
  if (role === 'admin') return { ...fullSet(true), 'settings.access': false };
  if (role === 'master') {
    return {
      ...fullSet(false),
      'clients.view': true,
      'clients.view_phones': true,
      'bookings.view': true,
      'bookings.add': true,
      'bookings.edit': true,
      'schedule.view': true,
      'services.view': true,
    };
  }
  return fullSet(false);
}

export function effectivePermissions(role: string, overrides?: unknown): Permissions {
  const base = roleDefaults(role);
  if (overrides && typeof overrides === 'object' && !Array.isArray(overrides)) {
    const valid = new Set(allPermissionKeys());
    for (const [k, v] of Object.entries(overrides as Record<string, unknown>)) {
      if (valid.has(k)) base[k] = Boolean(v);
    }
  }
  // owner всегда обладает всеми правами, overrides не могут урезать
  if (role === 'owner') return fullSet(true);
  return base;
}

export function hasPermission(perms: Permissions | undefined, key: string): boolean {
  if (!perms) return false;
  return perms[key] === true;
}
