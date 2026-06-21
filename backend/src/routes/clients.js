// Mijozlar API.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listClients,
  getClientDetail,
  updateClient,
  findOrCreateClient,
} from '../services/clientService.js';
import { softDeleteOne, restoreClientWithServices } from '../services/deleteService.js';
import { requireDeleteCode } from '../middleware/deleteCode.js';
import Client from '../models/Client.js';
import Service from '../models/Service.js';

const router = Router();

// GET /api/clients?search=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const clients = await listClients({
      search: req.query.search || '',
      page: req.query.page,
      limit: req.query.limit,
    });
    res.json(clients);
  })
);

router.get(
  '/deleted',
  asyncHandler(async (req, res) => {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const clients = await Client.find({
      isDeleted: true,
      deletedAt: { $gte: thirtyDaysAgo },
    })
      .sort({ deletedAt: -1 })
      .lean();
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
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    const code = req.body?.code ?? req.body?.confirmationCode ?? req.query.code;
    const client = await softDeleteOne('client', req.params.id, code);
    res.json({ ok: true, client });
  })
);

router.post(
  '/:id/restore',
  asyncHandler(async (req, res) => {
    const client = await Client.findOne({ _id: req.params.id, isDeleted: true }).lean();
    if (!client) return res.status(404).json({ error: 'Tiklanadigan mijoz topilmadi' });
    const services = await Service.find({
      clientId: req.params.id,
      $or: [{ isDeleted: true }, { isDeletedByClientDeletion: true }],
    })
      .sort({ serviceDateTime: -1 })
      .lean();
    res.json({ client, services });
  })
);

router.post(
  '/:id/restore/confirm',
  asyncHandler(async (req, res) => {
    const result = await restoreClientWithServices(req.params.id, req.body?.serviceIds || []);
    res.json({ ok: true, result });
  })
);

export default router;
