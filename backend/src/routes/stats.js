// Bosh sahifa statistikasi.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import { notDeleted } from '../models/softDelete.js';
import { getSummary } from '../services/financeService.js';
import { startOfDay, endOfDay } from '../utils/dates.js';

const router = Router();

// GET /api/stats/home — bugungi ishlar va kutilayotgan daromad.
router.get(
  '/home',
  asyncHandler(async (req, res) => {
    const from = startOfDay();
    const to = endOfDay();

    const todayServices = await Service.find({
      ...notDeleted,
      serviceDateTime: { $gte: from, $lte: to },
    })
      .sort({ serviceDateTime: 1 })
      .lean();

    const pending = todayServices.filter((s) => s.status === SERVICE_STATUS.PENDING);
    const expectedIncome = pending.reduce((sum, s) => sum + (s.price || 0), 0);

    const summary = await getSummary('month');

    res.json({
      todayCount: todayServices.length,
      pendingCount: pending.length,
      expectedIncome,
      todayServices,
      monthSummary: summary,
    });
  })
);

export default router;
