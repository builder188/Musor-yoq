// Bosh sahifa statistikasi.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import Reminder, { REMINDER_TYPE, REMINDER_STATUS } from '../models/Reminder.js';
import { notDeleted } from '../models/softDelete.js';
import { getSummary } from '../services/financeService.js';
import { getNextClient } from '../services/serviceService.js';
import { startOfDay, endOfDay } from '../utils/dates.js';

const router = Router();

// GET /api/stats/home — dashboard uchun hamma narsa bitta so'rovda:
// bugungi xizmatlar, "hozir kimga borish kerak" (eng yaqin mijoz), umumiy (barcha vaqt)
// balans, shu oy kirim/chiqim va to'lanmagan jarima ogohlantirishi. Yangi hisob-kitob
// ixtiro qilinmagan — mavjud servis funksiyalari birlashtirilgan.
router.get(
  '/home',
  asyncHandler(async (req, res) => {
    const from = startOfDay();
    const to = endOfDay();

    const [todayServices, monthSummary, allSummary, nextClient, unpaidFineDocs] = await Promise.all([
      Service.find({
        ...notDeleted,
        serviceDateTime: { $gte: from, $lte: to },
      })
        .sort({ serviceDateTime: 1 })
        .lean(),
      getSummary('month'),
      getSummary('all'),
      // Mavjud "eng yaqin mijoz" mantig'i: bugungi kutilayotgan xizmatlardan vaqtga eng yaqini.
      getNextClient(),
      // To'lanmagan jarima: to'lov tranzaksiyasiga bog'lanmagan, bekor qilinmagan fine yozuvlari
      // (fineService.getFineStats unpaidCount bilan bir xil mezon).
      Reminder.find({
        ...notDeleted,
        type: REMINDER_TYPE.FINE,
        status: { $ne: REMINDER_STATUS.CANCELLED },
        transactionId: null,
      })
        .select('amount')
        .lean(),
    ]);

    const pending = todayServices.filter((s) => s.status === SERVICE_STATUS.PENDING);
    const expectedIncome = pending.reduce((sum, s) => sum + (s.price || 0), 0);

    res.json({
      todayCount: todayServices.length,
      pendingCount: pending.length,
      expectedIncome,
      todayServices,
      monthSummary,
      // Umumiy (barcha vaqt) balans — bosh sahifadagi katta raqam.
      balance: allSummary.balance,
      nextClient,
      unpaidFines: {
        count: unpaidFineDocs.length,
        total: unpaidFineDocs.reduce((sum, f) => sum + (f.amount || 0), 0),
      },
    });
  })
);

export default router;
