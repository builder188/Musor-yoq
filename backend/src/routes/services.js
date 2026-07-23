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
  setServiceStatus,
  rescheduleService,
  listUpcomingServices,
} from '../services/serviceService.js';
import { softDeleteOne } from '../services/deleteService.js';
import { requireDeleteCode } from '../middleware/deleteCode.js';
import { notifyMiniAppCreated, notifyMiniAppUpdated, notifyMiniAppDeleted } from '../services/miniAppNotifyService.js';
import { extractServiceEntry, transcribeAudio } from '../ai/gemini.js';
import { correctServiceDateTime } from '../utils/dates.js';
import { getUsdToUzsRate } from '../services/exchangeRateService.js';
import { convertUsdToUzs } from '../utils/money.js';
import env from '../config/env.js';
import Service from '../models/Service.js';

const router = Router();

// GET /api/services?status=&dateFrom=&dateTo=&search=
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const services = await listServices({
      status: req.query.status || null,
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

// POST /api/services/ai — CHEKLANGAN AI: ovoz/matndan FAQAT bitta YANGI xizmat qatori qo'shadi.
// XAVFSIZLIK: bu endpoint faqat createService chaqiradi — mavjud yozuvni tahrirlash, holatini
// o'zgartirish yoki o'chirish imkoni umuman YO'Q (avval olib tashlangan "yozuvchi" AI chatdan
// farqli). AI faqat maydonlarni ajratadi; noto'g'ri tushunsa ham eng yomon holat — noto'g'ri
// yangi qator (tahrir/o'chirish emas). body: { text } yoki { audio(base64), mimeType }.
router.post(
  '/ai',
  asyncHandler(async (req, res) => {
    let text = String(req.body?.text || '').trim();
    let transcription = null;
    // Ovoz (Mini App'da yozilgan) — avval o'zbekchaga transkripsiya qilamiz.
    if (!text && req.body?.audio) {
      try {
        const buffer = Buffer.from(String(req.body.audio), 'base64');
        if (buffer.length > 0) {
          text = String(await transcribeAudio(buffer, req.body.mimeType || 'audio/ogg') || '').trim();
          transcription = text;
        }
      } catch (err) {
        return res.status(422).json({ ok: false, error: "Ovozni o'qib bo'lmadi, qaytadan urinib ko'ring." });
      }
    }
    if (!text) return res.status(400).json({ ok: false, error: "Xabar bo'sh — nima yozishimni ayting oka." });

    const fields = await extractServiceEntry(text);

    // Sana/vaqt mintaqa xatosini to'g'irlash ("soat 11" -> 16:00 emas, 11:00).
    if (fields.serviceDateTime) {
      fields.serviceDateTime = correctServiceDateTime(fields.serviceDateTime, text);
    }
    // Dollarda aytilgan narxni bugungi kurs bo'yicha so'mga aylantiramiz (asl qiymatni saqlab).
    if (fields.currency === 'USD' && typeof fields.price === 'number' && fields.price > 0) {
      const rate = await getUsdToUzsRate();
      if (rate) {
        const uzs = convertUsdToUzs(fields.price, rate);
        if (uzs) {
          fields.originalAmount = fields.price;
          fields.originalCurrency = 'USD';
          fields.exchangeRateUsed = rate;
          fields.price = uzs;
        }
      }
    }
    delete fields.currency; // createService valyutani kutmaydi

    // Identifikatsiya (ism YOKI to'g'ri telefon) shart — aks holda nima saqlanishi noaniq.
    const validPhone = fields.clientPhone && /^\+998\d{9}$/.test(fields.clientPhone);
    if (!fields.clientName && !validPhone) {
      return res.json({
        ok: false,
        needIdentity: true,
        transcription,
        message: "Yangi qator qo'shish uchun kamida mijoz ismi yoki telefon raqami kerak oka.",
      });
    }

    const service = await createService(fields);
    notifyMiniAppCreated('service', service, { input: fields });
    res.status(201).json({ ok: true, service, transcription });
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

// PATCH /api/services/:id/status — 4 holatning istalgan biriga o'tkazish (dropdown).
// body: { status: kutilmoqda|bajarildi|bajarilmadi|bekor_qilindi, reason? }
// Daromad yozish/qaytarish backend mantiqda: bajarildi → income; qolganlari → income yo'q.
router.patch(
  '/:id/status',
  asyncHandler(async (req, res) => {
    const before = await Service.findOne({ _id: req.params.id }).lean();
    const result = await setServiceStatus(req.params.id, req.body?.status, {
      reason: req.body?.reason || null,
    });
    const service = result?.service || result;
    notifyMiniAppUpdated('service', before, service);
    res.json(service);
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
