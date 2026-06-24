// Sozlamalar API.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import Settings from '../models/Settings.js';

const router = Router();

router.put(
  '/change-code',
  asyncHandler(async (req, res) => {
    const settings = await Settings.getSingleton(req.telegramUser?.id);
    const { currentCode, newCode } = req.body;
    if (String(currentCode) !== String(settings.deleteCode)) {
      return res.status(403).json({ error: 'Joriy kod noto\'g\'ri' });
    }
    if (!/^\d{4}$/.test(String(newCode || ''))) {
      return res.status(400).json({ error: 'Yangi kod 4 ta raqamdan iborat bo\'lishi kerak' });
    }
    settings.deleteCode = String(newCode);
    await settings.save();
    res.json(settings);
  })
);

// GET /api/settings
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await Settings.getSingleton(req.telegramUser?.id));
  })
);

// PUT /api/settings
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await Settings.getSingleton(req.telegramUser?.id);
    const {
      language,
      theme,
      reminderHoursBefore,
      confirmHoursAfter,
      currentDeleteCode,
      newDeleteCode,
    } = req.body;
    if (language !== undefined) settings.language = language;
    if (theme !== undefined) settings.theme = theme;
    const beforeHours = parseReminderHours(reminderHoursBefore);
    if (beforeHours !== null) settings.reminderHoursBefore = beforeHours;
    const afterHours = parseReminderHours(confirmHoursAfter);
    if (afterHours !== null) settings.confirmHoursAfter = afterHours;
    if (newDeleteCode !== undefined) {
      if (String(currentDeleteCode) !== String(settings.deleteCode)) {
        return res.status(403).json({ error: 'Joriy kod noto\'g\'ri' });
      }
      if (!/^\d{4}$/.test(String(newDeleteCode))) {
        return res.status(400).json({ error: 'Yangi kod 4 ta raqamdan iborat bo\'lishi kerak' });
      }
      settings.deleteCode = String(newDeleteCode);
    }
    await settings.save();
    res.json(settings);
  })
);

function parseReminderHours(value) {
  if (value === undefined) return null;
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
    const error = new Error("Eslatma soati 1 dan 168 gacha bo'lishi kerak");
    error.status = 400;
    throw error;
  }
  return Math.round(hours);
}

export default router;
