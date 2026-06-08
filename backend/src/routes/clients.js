// Mijozlar API.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listClients,
  getClientDetail,
  updateClient,
  findOrCreateClient,
} from '../services/clientService.js';
import { softDeleteOne } from '../services/deleteService.js';

const router = Router();

// GET /api/clients?search=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clients = await listClients({ search: req.query.search || '' });
    res.json(clients);
  })
);

// GET /api/clients/:id — tafsilot + xizmatlar tarixi.
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const detail = await getClientDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Mijoz topilmadi' });
    res.json(detail);
  })
);

// POST /api/clients — yangi mijoz.
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const client = await findOrCreateClient(req.body);
    res.status(201).json(client);
  })
);

// PUT /api/clients/:id
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const client = await updateClient(req.params.id, req.body);
    if (!client) return res.status(404).json({ error: 'Mijoz topilmadi' });
    res.json(client);
  })
);

// DELETE /api/clients/:id — tasdiqlash kodi kerak.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const code = req.body?.confirmationCode || req.query.code;
    const client = await softDeleteOne('client', req.params.id, code);
    res.json({ ok: true, client });
  })
);

export default router;
