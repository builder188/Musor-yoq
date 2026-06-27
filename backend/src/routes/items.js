// Kerakli buyumlar API: inventar, sotildi/tekinga berildi/o'chirildi.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireDeleteCode } from '../middleware/deleteCode.js';
import env from '../config/env.js';
import {
  listUsefulItems,
  getUsefulItemById,
  createUsefulItem,
  sellUsefulItem,
  giveAwayUsefulItem,
  discardUsefulItem,
} from '../services/usefulItemService.js';

const router = Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    res.json(await listUsefulItems({
      status: req.query.status || 'available',
      search: req.query.search || '',
      limit: req.query.limit || 200,
    }));
  })
);

router.get(
  '/audio/:fileId',
  asyncHandler(async (req, res) => {
    const fileRes = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/getFile?file_id=${encodeURIComponent(req.params.fileId)}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!fileRes.ok) return res.status(502).json({ error: 'Telegram fayl ma\'lumotini olishda xatolik' });
    const fileData = await fileRes.json();
    const filePath = fileData.result?.file_path;
    if (!filePath) return res.status(404).json({ error: 'Ovoz topilmadi' });

    const audioRes = await fetch(`https://api.telegram.org/file/bot${env.BOT_TOKEN}/${filePath}`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!audioRes.ok) return res.status(502).json({ error: 'Telegram ovozni olishda xatolik' });
    res.setHeader('Content-Type', audioRes.headers.get('content-type') || 'audio/ogg');
    const buffer = Buffer.from(await audioRes.arrayBuffer());
    res.send(buffer);
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = await getUsefulItemById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Buyum topilmadi' });
    res.json(item);
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    res.status(201).json(await createUsefulItem({ ...req.body, sourceType: 'miniapp' }));
  })
);

router.patch(
  '/:id/sold',
  asyncHandler(async (req, res) => {
    const item = await getUsefulItemById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Buyum topilmadi' });
    res.json(await sellUsefulItem({ ...req.body, itemName: item.name }, { confirmedItemId: req.params.id }));
  })
);

router.patch(
  '/:id/give-away',
  asyncHandler(async (req, res) => {
    const item = await getUsefulItemById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Buyum topilmadi' });
    res.json(await giveAwayUsefulItem({ ...req.body, itemName: item.name }, { confirmedItemId: req.params.id }));
  })
);

router.delete(
  '/:id',
  requireDeleteCode,
  asyncHandler(async (req, res) => {
    res.json({ ok: true, item: await discardUsefulItem(req.params.id) });
  })
);

export default router;
