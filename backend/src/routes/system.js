// Tizim / xavfli zona API: ko'plab o'chirish, qayta tiklash, to'liq reset.
// Barchasi tasdiqlash kodini (1990) talab qiladi.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { bulkDelete, listDeleted, restore, checkCode } from '../services/deleteService.js';

const router = Router();

// GET /api/system/deleted — o'chirilgan yozuvlar (30 kun ichida tiklash mumkin).
router.get(
  '/deleted',
  asyncHandler(async (req, res) => {
    res.json(await listDeleted());
  })
);

// POST /api/system/restore  body: { type, id }
router.post(
  '/restore',
  asyncHandler(async (req, res) => {
    const { type, id } = req.body;
    const doc = await restore(type, id);
    res.json({ ok: true, doc });
  })
);

// POST /api/system/bulk-delete  body: { target, confirmationCode }
// target: clients | services | finance | all
router.post(
  '/bulk-delete',
  asyncHandler(async (req, res) => {
    const { target, confirmationCode } = req.body;
    if (!checkCode(confirmationCode)) {
      return res.status(403).json({ error: 'Tasdiqlash kodi noto\'g\'ri' });
    }
    const result = await bulkDelete(target, confirmationCode);
    res.json({ ok: true, result });
  })
);

// POST /api/system/reset  body: { confirmationCode } — hammasini o'chirish.
router.post(
  '/reset',
  asyncHandler(async (req, res) => {
    const { confirmationCode } = req.body;
    if (!checkCode(confirmationCode)) {
      return res.status(403).json({ error: 'Tasdiqlash kodi noto\'g\'ri' });
    }
    const result = await bulkDelete('all', confirmationCode);
    res.json({ ok: true, result });
  })
);

export default router;
