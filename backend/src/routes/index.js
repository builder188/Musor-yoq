// Barcha API marshrutlarini yig'ish va auth bilan himoyalash.
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import statsRouter from './stats.js';
import clientsRouter from './clients.js';
import servicesRouter from './services.js';
import financeRouter from './finance.js';
import settingsRouter from './settings.js';
import aiRouter from './ai.js';
import reportsRouter from './reports.js';
import systemRouter from './system.js';
import dataRouter from './data.js';
import transactionsRouter from './transactions.js';
import analyticsRouter from './analytics.js';

const router = Router();

// Sog'liqni tekshirish (auth shart emas).
router.get('/health', (req, res) => res.json({ ok: true, service: 'musir-yoq' }));

// Quyidagilarning hammasi avtorizatsiya talab qiladi.
router.use(authMiddleware);

router.use('/stats', statsRouter);
router.use('/clients', clientsRouter);
router.use('/services', servicesRouter);
router.use('/finance', financeRouter);
router.use('/transactions', transactionsRouter);
router.use('/analytics', analyticsRouter);
router.use('/settings', settingsRouter);
router.use('/ai', aiRouter);
router.use('/reports', reportsRouter);
router.use('/system', systemRouter);
router.use('/data', dataRouter);

export default router;
