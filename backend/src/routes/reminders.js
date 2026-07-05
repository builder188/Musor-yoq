// Eslatmalar (qarz) API — Mini App "Eslatmalar" bo'limi uchun.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireDeleteCode } from '../middleware/deleteCode.js';
import {
  createDebtReminder,
  listReminders,
  getReminderById,
  markReminderDone,
  cancelReminder,
  snoozeReminder,
  deleteReminder,
} from '../services/reminderEntryService.js';
import { notifyMiniAppCreated, notifyMiniAppUpdated, notifyMiniAppDeleted } from '../services/miniAppNotifyService.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listReminders({
      status: req.query.status || 'pending',
      limit: req.query.limit || 200,
    }));
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const reminder = await getReminderById(req.params.id);
    if (!reminder) return res.status(404).json({ error: 'Eslatma topilmadi' });
    res.json(reminder);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await createDebtReminder({ ...req.body, source: 'miniapp' });
    notifyMiniAppCreated('reminder', result?.reminder, { input: req.body });
    res.status(201).json(result);
  })
);

router.patch(
  '/:id/done',
  asyncHandler(async (req, res) => {
    const before = await getReminderById(req.params.id);
    const result = await markReminderDone(req.params.id);
    notifyMiniAppUpdated('reminder', before, result?.reminder);
    res.json(result);
  })
);

router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const before = await getReminderById(req.params.id);
    const result = await cancelReminder(req.params.id);
    notifyMiniAppUpdated('reminder', before, result?.reminder);
    res.json(result);
  })
);

router.patch(
  '/:id/snooze',
  asyncHandler(async (req, res) => {
    const before = await getReminderById(req.params.id);
    const result = await snoozeReminder(req.params.id, req.body?.days || 1);
    notifyMiniAppUpdated('reminder', before, result?.reminder);
    res.json(result);
  })
);

router.delete(
  '/:id',
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    const result = await deleteReminder(req.params.id);
    notifyMiniAppDeleted('reminder', result?.reminder);
    res.json({ ok: true, ...result });
  })
);

export default router;
