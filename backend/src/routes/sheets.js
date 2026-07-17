// Ko'p-jadval (sheets) API: jadvallar ro'yxati, yangi jadval, nomlash.
// Arxivlash avtomatik (30 qator) — alohida endpoint kerak emas; arxiv jadval ham
// to'liq tahrirlanadi (qator endpointlari sheet holatiga qaramaydi).
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { listSheets, createSheet, renameSheet, SHEET_SCOPES } from '../services/sheetService.js';

const router = Router();

// GET /api/sheets?scope=services|income|expense|categories
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.query.scope;
    if (!SHEET_SCOPES.includes(scope)) {
      return res.status(400).json({ error: "scope noto'g'ri (services|income|expense|categories)" });
    }
    res.json({ sheets: await listSheets(scope) });
  })
);

// POST /api/sheets  body: { scope, name } — yangi jadval (faol bo'ladi, eskisi arxivga).
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const scope = req.body?.scope;
    if (!SHEET_SCOPES.includes(scope)) {
      return res.status(400).json({ error: "scope noto'g'ri (services|income|expense|categories)" });
    }
    res.status(201).json(await createSheet(scope, req.body?.name || ''));
  })
);

// PATCH /api/sheets/:id  body: { name } — jadval nomini o'zgartirish.
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await renameSheet(req.params.id, req.body?.name));
  })
);

export default router;
