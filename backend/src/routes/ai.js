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

router.post(
  '/search',
  asyncHandler(async (req, res) => {
    const message = (req.body?.message || req.body?.query || '').trim();
    if (!message) return res.status(400).json({ error: 'Xabar bo\'sh' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      sendSse(res, 'progress', { text: 'Qidirmoqda...' });
      const understanding = await understandText(message);

      sendSse(res, 'progress', { text: 'Tahlil qilmoqda...' });
      let results = [];
      if (understanding.intent === 'SEARCH_QUERY') {
        results = await searchServices({
          text: understanding.fields?.searchText || message,
          dateFrom: understanding.fields?.dateFrom || null,
          dateTo: understanding.fields?.dateTo || null,
          limit: 30,
        });
      }

      const agentRes = await runAgent({ understanding, rawText: message, mode: 'query' });
      sendSse(res, 'result', {
        reply: agentRes.text,
        intent: understanding.intent,
        results,
      });
    } catch (err) {
      sendSse(res, 'error', { error: err.message || 'AI qidiruv xatosi' });
    } finally {
      res.end();
    }
  })
);

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

export default router;
