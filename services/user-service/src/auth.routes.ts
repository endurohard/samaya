import { Router } from 'express';
import { z } from 'zod';
import * as authService from './auth.service';
import { config } from './config';

const router = Router();

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
    const result = await authService.register(
      { ...input, company_id },
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
