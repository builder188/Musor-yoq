// Mini App AI chat paneli — tabiiy til so'rovlari.
import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { understandText } from '../ai/gemini.js';
import { runAgent } from '../ai/agent.js';
import { searchServices } from '../services/searchService.js';

const router = Router();

// POST /api/ai/chat  body: { message }
// qaytaradi: { reply, intent, results }
router.post(
  '/chat',
  asyncHandler(async (req, res) => {
    const message = (req.body?.message || '').trim();
    if (!message) return res.status(400).json({ error: 'Xabar bo\'sh' });

    const understanding = await understandText(message);

    // Qidiruv natijalarini ham qaytaramiz (bosiladigan natijalar uchun).
    let results = [];
    if (understanding.intent === 'SEARCH_QUERY') {
      results = await searchServices({
        text: understanding.fields?.searchText || '',
        dateFrom: understanding.fields?.dateFrom || null,
        dateTo: understanding.fields?.dateTo || null,
        limit: 30,
      });
    }

    const agentRes = await runAgent({ understanding, rawText: message, mode: 'query' });

    res.json({
      reply: agentRes.text,
      intent: understanding.intent,
      results,
    });
  })
);

export default router;
