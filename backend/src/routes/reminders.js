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
    res.status(201).json(await createDebtReminder({ ...req.body, source: 'miniapp' }));
  })
);

router.patch(
  '/:id/done',
  asyncHandler(async (req, res) => {
    res.json(await markReminderDone(req.params.id));
  })
);

router.patch(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    res.json(await cancelReminder(req.params.id));
  })
);

router.patch(
  '/:id/snooze',
  asyncHandler(async (req, res) => {
    res.json(await snoozeReminder(req.params.id, req.body?.days || 1));
  })
);

router.delete(
  '/:id',
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, ...(await deleteReminder(req.params.id)) });
  })
);

export default router;
