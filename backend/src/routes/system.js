// Tizim / xavfli zona API: ko'plab o'chirish, qayta tiklash, to'liq reset.
// Barchasi tasdiqlash kodini (1990) talab qiladi.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireDeleteCode } from '../middleware/deleteCode.js';
import { bulkDelete, listDeleted, restore, restoreByIds } from '../services/deleteService.js';
import { notifyMiniAppBulkDelete } from '../services/miniAppNotifyService.js';

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
    if (Array.isArray(req.body?.ids)) {
      return res.json({ ok: true, result: await restoreByIds(req.body.ids) });
    }
    const doc = await restore(req.body.type, req.body.id);
    return res.json({ ok: true, doc });
  })
);

// POST /api/system/bulk-delete  body: { target, confirmationCode }
// target: services | finance | all
router.post(
  '/bulk-delete',
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    const { target } = req.body;
    const result = await bulkDelete(target, req.body?.code ?? req.body?.confirmationCode);
    notifyMiniAppBulkDelete(target, result);
    res.json({ ok: true, result });
  })
);

// POST /api/system/reset  body: { confirmationCode } — hammasini o'chirish.
router.post(
  '/reset',
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    const result = await bulkDelete('all', req.body?.code ?? req.body?.confirmationCode);
    notifyMiniAppBulkDelete('all', result);
    res.json({ ok: true, result });
  })
);

export default router;
