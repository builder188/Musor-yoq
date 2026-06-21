import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { createTransaction, getSummary, listTransactions, updateTransaction } from '../services/financeService.js';
import { softDeleteOne } from '../services/deleteService.js';
import { requireDeleteCode } from '../middleware/deleteCode.js';

const router = Router();

router.get(
  '/',
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

router.post(
  '/',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createTransaction(req.body));
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    res.json(await updateTransaction(req.params.id, req.body));
  })
);

router.delete(
  '/:id',
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    const code = req.body?.code ?? req.body?.confirmationCode ?? req.query.code;
    const tx = await softDeleteOne('transaction', req.params.id, code);
    res.json({ ok: true, transaction: tx });
  })
);

export default router;
