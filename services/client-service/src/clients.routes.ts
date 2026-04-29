import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from './middleware';
import {
  listClients, segmentCounts, createClient, updateClient,
  softDelete, restore, getClient, type Segment,
} from './clients.service';

const router = Router();

const SEGMENTS: Segment[] = ['all', 'regular', 'sleeping', 'missing', 'never', 'new', 'blocked', 'deleted'];

router.use(authenticate);

router.get('/', async (req, res, next) => {
  try {
    const segment = (req.query.segment as Segment) || 'all';
    if (!SEGMENTS.includes(segment)) {
      return res.status(400).json({ error: 'invalid segment' });
    }
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
    const offset = parseInt(String(req.query.offset ?? '0'), 10) || 0;

    const data = await listClients({
      companyId: req.auth!.company_id, segment, search, limit, offset,
    });
    return res.json(data);
  } catch (err) { return next(err); }
});

router.get('/segments', async (req, res, next) => {
  try {
    const counts = await segmentCounts(req.auth!.company_id);
    return res.json(counts);
  } catch (err) { return next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const client = await getClient(req.auth!.company_id, req.params.id);
    return res.json(client);
  } catch (err) { return next(err); }
});

const createSchema = z.object({
  phone: z.string().min(5),
  full_name: z.string().min(1),
  birthday: z.string().optional().nullable(),
  gender: z.enum(['male', 'female']).optional().nullable(),
  email: z.string().email().optional().nullable().or(z.literal('').transform(() => null)),
  comment: z.string().optional().nullable(),
  source: z.enum(['admin', 'public_widget', 'import', 'master']).optional(),
});

router.post('/', requireRole('admin', 'master'), async (req, res, next) => {
  try {
    const input = createSchema.parse(req.body);
    const id = await createClient({ company_id: req.auth!.company_id, ...input });
    return res.status(201).json({ id });
  } catch (err) { return next(err); }
});

const updateSchema = createSchema.partial().extend({
  is_blocked: z.boolean().optional(),
  bonus_balance: z.number().optional(),
});

router.put('/:id', requireRole('admin', 'master'), async (req, res, next) => {
  try {
    const patch = updateSchema.parse(req.body);
    await updateClient(req.auth!.company_id, req.params.id, patch);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

router.delete('/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await softDelete(req.auth!.company_id, req.params.id);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

router.post('/:id/restore', requireRole('admin'), async (req, res, next) => {
  try {
    await restore(req.auth!.company_id, req.params.id);
    return res.json({ ok: true });
  } catch (err) { return next(err); }
});

export default router;
