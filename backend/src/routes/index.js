// Barcha API marshrutlarini yig'ish va auth bilan himoyalash.
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { runWithUser } from '../db/tenantScope.js';
import statsRouter from './stats.js';
import clientsRouter from './clients.js';
import servicesRouter from './services.js';
import financeRouter from './finance.js';
import settingsRouter from './settings.js';
import reportsRouter from './reports.js';
import systemRouter from './system.js';
import dataRouter from './data.js';
import transactionsRouter from './transactions.js';
import analyticsRouter from './analytics.js';
import exchangeRateRouter from './exchangeRate.js';
import itemsRouter from './items.js';
import categoriesRouter from './categories.js';
import remindersRouter from './reminders.js';

const router = Router();

// Sog'liqni tekshirish (auth shart emas).
router.get('/health', (req, res) => res.json({ ok: true, service: 'musir-yoq' }));

// Quyidagilarning hammasi avtorizatsiya talab qiladi.
router.use(authMiddleware);

// Tenant konteksti: shu so'rovning butun ishlov berishi (route handler, service qatlam,
// AI agent, DB so'rovlari) joriy foydalanuvchiga scope qilinadi. authMiddleware allaqachon
// req.telegramUser.id ni allowlist bo'yicha tasdiqlagan.
router.use((req, res, next) => {
  const id = req.telegramUser?.id;
  if (!id) return res.status(401).json({ error: 'Avtorizatsiya xatosi' });
  runWithUser(id, () => next());
});

router.use('/stats', statsRouter);
router.use('/clients', clientsRouter);
router.use('/services', servicesRouter);
router.use('/finance', financeRouter);
router.use('/transactions', transactionsRouter);
router.use('/analytics', analyticsRouter);
router.use('/exchange-rate', exchangeRateRouter);
router.use('/items', itemsRouter);
router.use('/categories', categoriesRouter);
router.use('/reminders', remindersRouter);
router.use('/settings', settingsRouter);
// Eslatma: /ai chat/search endpointi OLIB TASHLANDI — Mini App'dagi AI panel yozuv
// amallarini (STATUS_UPDATE/PAYMENT_UPDATE) tasdiqsiz bajara olardi. Tabiiy-til
// muloqot faqat botda (u yerda tasdiqlash/tahrirlash oqimi bor).
router.use('/reports', reportsRouter);
router.use('/system', systemRouter);
router.use('/data', dataRouter);

export default router;
