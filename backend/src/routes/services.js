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
      includeTransaction: true,
    });
    res.json(service);
  })
);

// PATCH /api/services/:id/cancel
router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const service = await cancelService(req.params.id, req.body?.reason || req.body?.cancellationReason || null);
    res.json(service);
  })
);

router.patch(
  '/:id/reschedule',
  asyncHandler(async (req, res) => {
    const service = await rescheduleService(req.params.id, req.body?.newDateTime);
    res.json(service);
  })
);

// POST /api/services/:id/reminders/:index/retry — yuborilmagan (failed) eslatmani qayta navbatga qo'yadi.
// Hisoblagichlar nollanadi va vaqti hozirgi qilinadi, asosiy cron keyingi daqiqada qayta urinadi.
router.post(
  '/:id/reminders/:index/retry',
  asyncHandler(async (req, res) => {
    const service = await Service.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    const index = Number(req.params.index);
    if (!service || Number.isNaN(index) || index < 0 || index >= service.reminders.length) {
      return res.status(404).json({ error: 'Eslatma topilmadi' });
    }
    const reminder = service.reminders[index];
    reminder.failed = false;
    reminder.sent = false;
    reminder.sentAt = null;
    reminder.retryCount = 0;
    reminder.nextRetryAt = null;
    reminder.scheduledAt = new Date();
    service.markModified('reminders');
    await service.save();
    res.json({ ok: true, service });
  })
);

// DELETE /api/services/:id/reminders/:index — eslatmani o'chirish (failed bo'lsa qo'lda yopish).
router.delete(
  '/:id/reminders/:index',
  asyncHandler(async (req, res) => {
    const service = await Service.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    const index = Number(req.params.index);
    if (!service || Number.isNaN(index) || index < 0 || index >= service.reminders.length) {
      return res.status(404).json({ error: 'Eslatma topilmadi' });
    }
    service.reminders.splice(index, 1);
    await service.save();
    res.json({ ok: true, service });
  })
);

router.delete(
  '/:id',
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    const code = req.body?.code ?? req.body?.confirmationCode ?? req.query.code;
    const service = await softDeleteOne('service', req.params.id, code);
    res.json({ ok: true, service });
  })
);

export default router;
