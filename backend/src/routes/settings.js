// Sozlamalar API.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import Settings from '../models/Settings.js';

const router = Router();

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
    const { language, theme, reminderOffsetsMinutes, timezone } = req.body;
    if (language !== undefined) settings.language = language;
    if (theme !== undefined) settings.theme = theme;
    if (Array.isArray(reminderOffsetsMinutes)) {
      settings.reminderOffsetsMinutes = reminderOffsetsMinutes
        .map((n) => Math.max(0, parseInt(n, 10) || 0))
        .filter((n, i, arr) => arr.indexOf(n) === i)
        .sort((a, b) => b - a);
    }
    if (timezone !== undefined) settings.timezone = timezone;
    await settings.save();
    res.json(settings);
  })
);

export default router;
