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

    // 3 urinishdan keyin ham yuborilmagan (failed) eslatmalar — qo'lda hal qilish uchun.
    const failedReminders = await collectFailedReminders();

    res.json({
      todayCount: todayServices.length,
      pendingCount: pending.length,
      expectedIncome,
      todayServices,
      monthSummary: summary,
      failedReminders,
    });
  })
);

// Yuborib bo'lmagan (failed) eslatmalarni xizmatlardan yig'ib, tekis ro'yxat qiladi.
// Mini App buni ogohlantirish sifatida ko'rsatadi (qayta urinish / o'chirish).
async function collectFailedReminders() {
  const services = await Service.find({
    ...notDeleted,
    status: SERVICE_STATUS.PENDING,
    'reminders.failed': true,
  })
    .sort({ serviceDateTime: 1 })
    .lean();

  const out = [];
  for (const service of services) {
    (service.reminders || []).forEach((reminder, index) => {
      if (!reminder.failed) return;
      out.push({
        serviceId: service._id,
        reminderIndex: index,
        clientName: service.clientName,
        clientPhone: service.clientPhone,
        location: service.location,
        serviceDateTime: service.serviceDateTime,
        minutesBefore: reminder.minutesBefore,
        scheduledAt: reminder.scheduledAt,
        retryCount: reminder.retryCount,
      });
    });
  }
  return out;
}

export default router;
