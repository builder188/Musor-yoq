// PDF hisobotlar API.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createReportDoc } from '../utils/pdf.js';
import { getSummary, listTransactions } from '../services/financeService.js';
import { listServices } from '../services/serviceService.js';
import { periodRange } from '../utils/dates.js';

const router = Router();

const PERIOD_LABELS = {
  today: 'Bugun',
  month: 'Bu oy',
  last_month: 'O\'tgan oy',
  year: 'Bu yil',
  all: 'Hammasi',
};

// POST /api/reports/pdf  body: { period, includeServices, includeTransactions, lastN }
router.post(
  '/pdf',
  asyncHandler(async (req, res) => {
    const period = req.body?.period || 'month';
    const includeServices = req.body?.includeServices !== false;
    const includeTransactions = req.body?.includeTransactions !== false;

    const summary = await getSummary(period);
    const { from, to } = periodRange(period);

    const transactions = includeTransactions ? await listTransactions({ period }) : [];
    const services = includeServices
      ? await listServices({ dateFrom: from, dateTo: to })
      : [];

    const doc = createReportDoc({
      title: 'Musir Yo\'q — Moliyaviy hisobot',
      periodLabel: PERIOD_LABELS[period] || period,
      summary,
      transactions,
      services,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="hisobot-${period}.pdf"`);
    doc.pipe(res);
    doc.end();
  })
);

export default router;
