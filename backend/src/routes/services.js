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
  rescheduleService,
  listUpcomingServices,
} from '../services/serviceService.js';
import { softDeleteOne } from '../services/deleteService.js';
import { requireDeleteCode } from '../middleware/deleteCode.js';
import { notifyMiniAppCreated, notifyMiniAppUpdated, notifyMiniAppDeleted } from '../services/miniAppNotifyService.js';
import env from '../config/env.js';
import Service from '../models/Service.js';

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
      page: req.query.page || null,
      limit: req.query.limit || 500,
    });
    res.json(services);
  })
);

router.get(
  '/upcoming',
  asyncHandler(async (req, res) => {
    res.json(await listUpcomingServices(7));
  })
);

router.get(
  '/images/:fileId',
  asyncHandler(async (req, res) => {
    const fileRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(req.params.fileId)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!fileRes.ok) return res.status(502).json({ error: 'Telegram fayl ma\'lumotini olishda xatolik' });
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) return res.status(404).json({ error: 'Rasm topilmadi' });

    const imgRes = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!imgRes.ok) return res.status(502).json({ error: 'Telegram rasmni olishda xatolik' });
    res.setHeader('Content-Type', imgRes.headers.get('content-type') || 'application/octet-stream');
    const buffer = Buffer.from(await imgRes.arrayBuffer());
    res.send(buffer);
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
    notifyMiniAppCreated('service', service, { input: req.body });
    res.status(201).json(service);
  })
);

// PUT /api/services/:id — tahrir (narx o'zgarsa moliya qayta hisoblanadi).
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const before = await Service.findOne({ _id: req.params.id }).lean();
    const service = await editService(req.params.id, req.body);
    notifyMiniAppUpdated('service', before, service);
    res.json(service);
  })
);

// PATCH /api/services/:id/complete — bajarildi (daromad yoziladi).
// body: { newPrice?, markPaid? }
router.patch(
  '/:id/complete',
  asyncHandler(async (req, res) => {
    const before = await Service.findOne({ _id: req.params.id }).lean();
    const result = await completeService(req.params.id, {
      newPrice: req.body?.newPrice ?? null,
      markPaid: req.body?.markPaid !== false, // standart: to'langan
      includeTransaction: true,
    });
    notifyMiniAppUpdated('service', before, result?.service);
    res.json(result);
  })
);

// PATCH /api/services/:id/cancel
router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const before = await Service.findOne({ _id: req.params.id }).lean();
    const service = await cancelService(req.params.id, req.body?.reason || req.body?.cancellationReason || null);
    notifyMiniAppUpdated('service', before, service);
    res.json(service);
  })
);

router.patch(
  '/:id/reschedule',
  asyncHandler(async (req, res) => {
    const before = await Service.findOne({ _id: req.params.id }).lean();
    const service = await rescheduleService(req.params.id, req.body?.newDateTime);
    notifyMiniAppUpdated('service', before, service);
    res.json(service);
  })
);


router.delete(
  '/:id',
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    const code = req.body?.code ?? req.body?.confirmationCode ?? req.query.code;
    const service = await softDeleteOne('service', req.params.id, code);
    notifyMiniAppDeleted('service', service);
    res.json({ ok: true, service });
  })
);

export default router;
