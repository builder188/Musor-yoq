import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireDeleteCode } from '../middleware/deleteCode.js';
import { bulkDelete, listDeleted, restore, restoreByIds, restoreClientWithServices } from '../services/deleteService.js';

const router = Router();

router.post(
  '/delete',
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    const target = req.body?.target || 'all';
    const result = await bulkDelete(target, req.body?.code ?? req.body?.confirmationCode);
    res.json({ ok: true, result });
  })
);

router.get(
  '/deleted',
  asyncHandler(async (req, res) => {
    res.json(await listDeleted());
  })
);

router.post(
  '/restore',
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const collection = req.body?.collection || req.body?.type || null;
    if (collection) {
      const result = [];
      for (const id of ids) {
        result.push(await restore(collection, id));
      }
      return res.json({ ok: true, result });
    }
    const result = await restoreByIds(ids);
    res.json({ ok: true, result });
  })
);

router.post(
  '/restore-client',
  asyncHandler(async (req, res) => {
    const result = await restoreClientWithServices(req.body?.clientId, req.body?.serviceIds || []);
    res.json({ ok: true, result });
  })
);

export default router;
