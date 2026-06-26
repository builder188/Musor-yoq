// Valyuta kursi API (debug/Mini App uchun): joriy keshdagi USD->UZS kurs + meta.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getRateInfo } from '../services/exchangeRateService.js';

const router = Router();

// GET /api/exchange-rate (va /api/v1/exchange-rate)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await getRateInfo());
  })
);

export default router;
