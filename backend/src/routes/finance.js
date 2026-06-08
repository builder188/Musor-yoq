// Moliya API: hisobot, diagramma, tranzaksiyalar, qarzlar, to'lov.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  getSummary,
  getMonthlyChart,
  listTransactions,
  createTransaction,
  updateTransaction,
  listDebts,
  recordPayment,
} from '../services/financeService.js';
import { softDeleteOne } from '../services/deleteService.js';

const router = Router();

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
      })
    );
  })
);

// POST /api/finance/transactions
router.post(
  '/transactions',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createTransaction(req.body));
  })
);

// PUT /api/finance/transactions/:id
router.put(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    res.json(await updateTransaction(req.params.id, req.body));
  })
);

// DELETE /api/finance/transactions/:id — tasdiqlash kodi kerak.
router.delete(
  '/transactions/:id',
  asyncHandler(async (req, res) => {
    const code = req.body?.confirmationCode || req.query.code;
    const tx = await softDeleteOne('transaction', req.params.id, code);
    res.json({ ok: true, transaction: tx });
  })
);

// GET /api/finance/debts
router.get(
  '/debts',
  asyncHandler(async (req, res) => {
    res.json(await listDebts());
  })
);

// POST /api/finance/debts/:clientId/payment  body: { amount, paymentMethod?, note? }
router.post(
  '/debts/:clientId/payment',
  asyncHandler(async (req, res) => {
    const result = await recordPayment({
      clientId: req.params.clientId,
      amount: req.body.amount,
      paymentMethod: req.body.paymentMethod,
      note: req.body.note,
    });
    res.json(result);
  })
);

export default router;
