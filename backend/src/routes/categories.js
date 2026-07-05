// Kategoriyalar API: material kategoriyalari + "Kerakli buyumlar" ko'rinishi, yozuvlar,
// va qo'lda yangi kategoriya yaratish (yaratilganda bot egaga xabar beradi).
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getCategoryOverview,
  getMaterialCategoryRecords,
  getIncomeCategoryRecords,
  getExpenseCategoryRecords,
  getOtherCategoryRecords,
  createMaterialCategory,
} from '../services/categoryService.js';
import { notifyMiniAppCreated } from '../services/miniAppNotifyService.js';

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
    const category = await createMaterialCategory(req.body?.name, { notify: false });
    notifyMiniAppCreated('materialCategory', category, { input: { name: req.body?.name } });
    res.status(201).json(category);
  })
);

// GET /api/categories/material/:name/records — bitta material kategoriyasining sotuv yozuvlari.
router.get(
  '/material/:name/records',
  asyncHandler(async (req, res) => {
    res.json(await getMaterialCategoryRecords(req.params.name));
  })
);

// GET /api/categories/income/:name/records — bitta kirim kategoriyasining yozuvlari.
router.get(
  '/income/:name/records',
  asyncHandler(async (req, res) => {
    res.json(await getIncomeCategoryRecords(req.params.name));
  })
);

// GET /api/categories/expense/:name/records — bitta xarajat kategoriyasining yozuvlari
// (ovoz + asl matn bilan — Mini App'da qayta eshitish uchun).
router.get(
  '/expense/:name/records',
  asyncHandler(async (req, res) => {
    res.json(await getExpenseCategoryRecords(req.params.name));
  })
);

// GET /api/categories/other/records — "Boshqa kirim-chiqimlar" (toifasiz kirim va chiqimlar).
router.get(
  '/other/records',
  asyncHandler(async (req, res) => {
    res.json(await getOtherCategoryRecords());
  })
);

export default router;
