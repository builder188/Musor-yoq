// Sozlamalar API.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import Settings from '../models/Settings.js';

const router = Router();

router.put(
  '/change-code',
  asyncHandler(async (req, res) => {
    const settings = await Settings.getSingleton();
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
    res.json(await Settings.getSingleton());
  })
);

// PUT /api/settings
router.put(
  '/',
  asyncHandler(async (req, res) => {
    const settings = await Settings.getSingleton();
    const { language, theme, defaultReminders, currentDeleteCode, newDeleteCode } = req.body;
    if (language !== undefined) settings.language = language;
    if (theme !== undefined) settings.theme = theme;
    if (Array.isArray(defaultReminders)) {
      // [{minutesBefore}] yoki oddiy sonlar massivini qabul qilamiz.
      const minutes = defaultReminders
        .map((r) => Math.max(0, parseInt(r?.minutesBefore ?? r, 10) || 0))
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .sort((a, b) => b - a);
      settings.defaultReminders = minutes.map((m) => ({ minutesBefore: m }));
    }
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

export default router;
