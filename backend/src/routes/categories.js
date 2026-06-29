// Kategoriyalar API: material kategoriyalari + "Kerakli buyumlar" ko'rinishi, yozuvlar,
// va qo'lda yangi kategoriya yaratish (yaratilganda bot egaga xabar beradi).
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getCategoryOverview,
  getMaterialCategoryRecords,
  createMaterialCategory,
} from '../services/categoryService.js';

const router = Router();

// GET /api/categories — barcha material kategoriyalari (statistika bilan) + Kerakli buyumlar.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await getCategoryOverview());
  })
);

// POST /api/categories  body: { name } — qo'lda yangi material kategoriyasi (bot xabar beradi).
router.post(
  '/',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createMaterialCategory(req.body?.name));
  })
);

// GET /api/categories/material/:name/records — bitta material kategoriyasining sotuv yozuvlari.
router.get(
  '/material/:name/records',
  asyncHandler(async (req, res) => {
    res.json(await getMaterialCategoryRecords(req.params.name));
  })
);

export default router;
