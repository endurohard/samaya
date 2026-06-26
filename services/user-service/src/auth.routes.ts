import { Router } from 'express';
import { z } from 'zod';
import * as authService from './auth.service';
import { AuthError } from './auth.service';
import { config } from './config';
import { verifyAccess, type AccessPayload } from './jwt';
import { pool } from './db';
import { PERMISSION_MODULES, effectivePermissions, allPermissionKeys, roleDefaults } from './permissions';

const router = Router();

// ===== RBAC: управление доступом сотрудников =====
async function getAuth(req: { headers: { authorization?: string } }): Promise<AccessPayload> {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw new AuthError(401, 'missing bearer token', 'NO_TOKEN');
  try {
    return await verifyAccess(h.slice(7));
  } catch {
    throw new AuthError(401, 'invalid token', 'INVALID_TOKEN');
  }
}
async function requireAccessAdmin(req: { headers: { authorization?: string } }): Promise<AccessPayload> {
  const p = await getAuth(req);
  if (!['owner', 'admin'].includes(p.role)) throw new AuthError(403, 'forbidden', 'FORBIDDEN');
  return p;
}

// Каталог прав (для UI) — любому авторизованному
router.get('/permissions-catalog', async (req, res, next) => {
  try {
    await getAuth(req);
    return res.json({
      modules: PERMISSION_MODULES,
      role_defaults: {
        owner: roleDefaults('owner'),
        admin: roleDefaults('admin'),
        master: roleDefaults('master'),
      },
    });
  } catch (e) { return next(e); }
});

// Список сотрудников с ролью и эффективными правами
router.get('/users', async (req, res, next) => {
  try {
    const me = await requireAccessAdmin(req);
    const { rows } = await pool.query(
      `SELECT id, email, phone, full_name, role, is_active, permissions
       FROM users.users
       WHERE company_id = $1 AND role IN ('owner','admin','master')
       ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, full_name NULLS LAST`,
      [me.company_id],
    );
    const items = rows.map((u) => ({
      id: u.id, email: u.email, phone: u.phone, full_name: u.full_name,
      role: u.role, is_active: u.is_active,
      permissions: effectivePermissions(u.role, u.permissions),
      overrides: u.permissions || {},
    }));
    return res.json({ items });
  } catch (e) { return next(e); }
});

const patchUserSchema = z.object({
  role: z.enum(['owner', 'admin', 'master']).optional(),
  permissions: z.record(z.boolean()).optional(),
  is_active: z.boolean().optional(),
});
// Изменение роли / прав / активности сотрудника
router.patch('/users/:id', async (req, res, next) => {
  try {
    const me = await requireAccessAdmin(req);
    const input = patchUserSchema.parse(req.body);
    const target = await pool.query(
      `SELECT id, role FROM users.users WHERE company_id = $1 AND id = $2`,
      [me.company_id, req.params.id],
    );
    if (!target.rows[0]) throw new AuthError(404, 'user not found', 'NOT_FOUND');
    // admin не может управлять owner'ами и выдавать роль owner
    if (me.role === 'admin' && (target.rows[0].role === 'owner' || input.role === 'owner')) {
      throw new AuthError(403, 'only owner can manage owners', 'FORBIDDEN');
    }
    const fields: string[] = [];
    const vals: unknown[] = [me.company_id, req.params.id];
    if (input.role !== undefined) { vals.push(input.role); fields.push(`role = $${vals.length}`); }
    if (input.permissions !== undefined) {
      const valid = new Set(allPermissionKeys());
      const clean: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(input.permissions)) if (valid.has(k)) clean[k] = Boolean(v);
      vals.push(JSON.stringify(clean)); fields.push(`permissions = $${vals.length}::jsonb`);
    }
    if (input.is_active !== undefined) { vals.push(input.is_active); fields.push(`is_active = $${vals.length}`); }
    if (!fields.length) return res.status(400).json({ error: 'no fields to update' });
    const { rows } = await pool.query(
      `UPDATE users.users SET ${fields.join(', ')}, updated_at = NOW()
       WHERE company_id = $1 AND id = $2 RETURNING id, role, permissions`,
      vals,
    );
    return res.json({
      id: rows[0].id,
      role: rows[0].role,
      permissions: effectivePermissions(rows[0].role, rows[0].permissions),
    });
  } catch (e) { return next(e); }
});

const registerSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(5).optional(),
    password: z.string().min(8),
    full_name: z.string().optional(),
    role: z.enum(['owner', 'admin', 'master', 'client']).optional(),
    company_id: z.string().uuid().optional(),
  })
  .refine((d) => d.email || d.phone, { message: 'email or phone required' });

router.post('/register', async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    const company_id = input.company_id ?? config.DEFAULT_COMPANY_ID;
    if (!company_id) {
      return res.status(400).json({ error: 'company_id required (no default configured)' });
    }
    // Публичная регистрация — только client. Роли персонала (owner/admin/master)
    // может выдать лишь авторизованный owner/admin этой же компании.
    let role: typeof input.role = 'client';
    if (input.role && input.role !== 'client') {
      const h = req.headers.authorization;
      let allowed = false;
      if (h?.startsWith('Bearer ')) {
        try {
          const p = await verifyAccess(h.slice(7));
          allowed = ['owner', 'admin'].includes(p.role) && p.company_id === company_id;
        } catch {
          // невалидный токен → forbidden ниже
        }
      }
      if (!allowed) {
        return res.status(403).json({ error: 'staff registration requires admin token', code: 'STAFF_REGISTER_FORBIDDEN' });
      }
      role = input.role;
    }
    const result = await authService.register(
      { ...input, role, company_id },
      { ip: req.ip, ua: req.headers['user-agent'] as string | undefined },
    );
    return res.status(201).json(result);
  } catch (e) {
    return next(e);
  }
});

const loginSchema = z
  .object({
    email: z.string().email().optional(),
    phone: z.string().min(5).optional(),
    password: z.string().min(1),
    company_id: z.string().uuid().optional(),
  })
  .refine((d) => d.email || d.phone, { message: 'email or phone required' });

router.post('/login', async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const company_id = input.company_id ?? config.DEFAULT_COMPANY_ID;
    if (!company_id) {
      return res.status(400).json({ error: 'company_id required (no default configured)' });
    }
    const result = await authService.login(
      { ...input, company_id },
      { ip: req.ip, ua: req.headers['user-agent'] as string | undefined },
    );
    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

const refreshSchema = z.object({ refresh_token: z.string().min(1) });

router.post('/refresh', async (req, res, next) => {
  try {
    const { refresh_token } = refreshSchema.parse(req.body);
    const result = await authService.refresh(refresh_token, {
      ip: req.ip,
      ua: req.headers['user-agent'] as string | undefined,
    });
    return res.json(result);
  } catch (e) {
    return next(e);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    const { refresh_token } = refreshSchema.parse(req.body);
    await authService.logout(refresh_token);
    return res.status(204).end();
  } catch (e) {
    return next(e);
  }
});

export default router;
