import { Router } from 'express';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { getMonthlyChart, getSummary } from '../services/financeService.js';
import { endOfDay, endOfMonth, startOfDay, startOfMonth } from '../utils/dates.js';

const router = Router();
const notDeleted = { isDeleted: { $ne: true } };

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const todayFrom = startOfDay();
    const todayTo = endOfDay();
    const upcomingTo = new Date();
    upcomingTo.setDate(upcomingTo.getDate() + 7);
    upcomingTo.setHours(23, 59, 59, 999);

    const [
      allSummary,
      monthSummary,
      todayServices,
      upcomingServices,
    ] = await Promise.all([
      getSummary('all'),
      getSummary('month'),
      Service.find({
        ...notDeleted,
        serviceDateTime: { $gte: todayFrom, $lte: todayTo },
      })
        .sort({ serviceDateTime: 1 })
        .lean(),
      Service.find({
        ...notDeleted,
        status: SERVICE_STATUS.PENDING,
        serviceDateTime: { $gte: new Date(), $lte: upcomingTo },
      })
        .sort({ serviceDateTime: 1 })
        .lean(),
    ]);

    res.json({
      balance: allSummary.balance,
      totalIncome: allSummary.totalIncome,
      totalExpense: allSummary.totalExpense,
      todayServices,
      upcomingServicesCount: upcomingServices.length,
      upcomingExpectedIncome: upcomingServices.reduce((sum, service) => sum + (service.price || 0), 0),
      thisMonthIncome: monthSummary.totalIncome,
      thisMonthExpense: monthSummary.totalExpense,
    });
  })
);

router.get(
  '/monthly',
  asyncHandler(async (req, res) => {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    res.json(await getMonthlyChart(year));
  })
);

// Eng ko'p pul to'lagan / eng ko'p chaqirgan mijozlar — endi alohida Client yozuvisiz:
// xizmat daromadlari TELEFON (bo'lmasa ism) bo'yicha guruhlanadi.
router.get(
  '/clients',
  asyncHandler(async (req, res) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100);
    const monthFrom = req.query.month ? startOfMonth(new Date(`${req.query.month}-01`)) : null;
    const monthTo = monthFrom ? endOfMonth(monthFrom) : null;
    const match = {
      ...notDeleted,
      type: TX_TYPES.INCOME,
      serviceId: { $ne: null },
    };
    if (monthFrom && monthTo) match.date = { $gte: monthFrom, $lte: monthTo };

    const rows = await Transaction.aggregate([
      { $match: match },
      {
        $lookup: {
          from: 'services',
          localField: 'serviceId',
          foreignField: '_id',
          as: 'service',
        },
      },
      { $unwind: '$service' },
      {
        $group: {
          _id: {
            $cond: [
              { $gt: [{ $strLenCP: { $ifNull: ['$service.clientPhone', ''] } }, 0] },
              { $concat: ['tel:', '$service.clientPhone'] },
              { $concat: ['nom:', { $toLower: { $trim: { input: { $ifNull: ['$service.clientName', ''] } } } }] },
            ],
          },
          totalIncome: { $sum: '$amount' },
          servicesCount: { $sum: 1 },
          clientName: { $last: '$service.clientName' },
          clientPhone: { $last: '$service.clientPhone' },
        },
      },
      { $sort: { totalIncome: -1 } },
      { $limit: limit },
    ]);

    res.json(
      rows.map((row) => ({
        clientKey: row._id,
        clientName: row.clientName || '',
        clientPhone: row.clientPhone || '',
        totalIncome: row.totalIncome,
        servicesCount: row.servicesCount,
      }))
    );
  })
);

export default router;
