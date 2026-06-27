// Moliya API: hisobot, diagramma, tranzaksiyalar.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getSummary,
  getMonthlyChart,
  listTransactions,
  createTransaction,
  updateTransaction,
} from '../services/financeService.js';
import { softDeleteOne } from '../services/deleteService.js';
import { requireDeleteCode } from '../middleware/deleteCode.js';
import { getMaterialStats, listKnownMaterials } from '../services/materialService.js';

const router = Router();

// GET /api/finance/materials?period= — material sotuvi bo'yicha kategoriya statistikasi.
router.get(
  '/materials',
  asyncHandler(async (req, res) => {
    res.json(await getMaterialStats(req.query.period || 'all'));
  })
);

// GET /api/finance/materials/categories — tanilgan kategoriyalar (10 asosiy + yaratilganlar).
router.get(
  '/materials/categories',
  asyncHandler(async (req, res) => {
    res.json(await listKnownMaterials());
  })
);

// GET /api/finance/summary?period=today|month|last_month|year|all
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    res.json(await getSummary(req.query.period || 'all'));
  })
);

// GET /api/finance/chart?year=
router.get(
  '/chart',
  asyncHandler(async (req, res) => {
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    res.json(await getMonthlyChart(year));
  })
);

// GET /api/finance/transactions?period=&type=
router.get(
  '/transactions',
  asyncHandler(async (req, res) => {
    res.json(
      await listTransactions({
        period: req.query.period || 'all',
        type: req.query.type || null,
        category: req.query.category || null,
        dateFrom: req.query.dateFrom || null,
        dateTo: req.query.dateTo || null,
        page: req.query.page || null,
        limit: req.query.limit || 200,
      })
    );
  })
);

router.get(
  '/balance',
  asyncHandler(async (req, res) => {
    const summary = await getSummary(req.query.period || 'all');
    res.json({
      totalIncome: summary.totalIncome,
      totalExpense: summary.totalExpense,
      balance: summary.balance,
      period: summary.period,
      from: summary.from,
      to: summary.to,
    });
  })
);

// POST /api/finance/transactions
router.post(
  '/transactions',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createTransaction(req.body));
  })
);

router.put(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    res.json(await updateTransaction(req.params.id, req.body));
  })
);
// DELETE /api/finance/transactions/:id - tasdiqlash kodi kerak.
router.delete(
  '/transactions/:id',
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    const code = req.body?.code ?? req.body?.confirmationCode ?? req.query.code;
    const tx = await softDeleteOne('transaction', req.params.id, code);
    res.json({ ok: true, transaction: tx });
  })
);

export default router;
