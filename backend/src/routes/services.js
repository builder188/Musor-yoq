// Xizmatlar API (Kanban / List, bajarish, tahrir, o'chirish).
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  listServices,
  getServiceById,
  createService,
  editService,
  completeService,
  cancelService,
} from '../services/serviceService.js';
import { softDeleteOne } from '../services/deleteService.js';

const router = Router();

// GET /api/services?status=&clientId=&dateFrom=&dateTo=&search=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const services = await listServices({
      status: req.query.status || null,
      clientId: req.query.clientId || null,
      dateFrom: req.query.dateFrom || null,
      dateTo: req.query.dateTo || null,
      search: req.query.search || '',
    });
    res.json(services);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = await getServiceById(req.params.id);
    if (!service) return res.status(404).json({ error: 'Xizmat topilmadi' });
    res.json(service);
  })
);

// POST /api/services
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const service = await createService(req.body);
    res.status(201).json(service);
  })
);

// PUT /api/services/:id — tahrir (narx o'zgarsa moliya qayta hisoblanadi).
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const service = await editService(req.params.id, req.body);
    res.json(service);
  })
);

// PATCH /api/services/:id/complete — bajarildi (daromad yoziladi).
// body: { newPrice?, markPaid? }
router.patch(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const service = await completeService(req.params.id, {
      newPrice: req.body?.newPrice ?? null,
      markPaid: req.body?.markPaid !== false, // standart: to'langan
    });
    res.json(service);
  })
);

// PATCH /api/services/:id/cancel
router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const service = await cancelService(req.params.id);
    res.json(service);
  })
);

// DELETE /api/services/:id — tasdiqlash kodi kerak.
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const code = req.body?.confirmationCode || req.query.code;
    const service = await softDeleteOne('service', req.params.id, code);
    res.json({ ok: true, service });
  })
);

export default router;
