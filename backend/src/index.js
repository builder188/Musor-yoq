// Musir Yo'q — backend kirish nuqtasi.
// Tartib: env tekshiruvi -> MongoDB -> Express API -> Telegram bot -> cron.
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { webhookCallback } from 'grammy';

import env, { validateEnv, isProd } from './config/env.js';
import { connectDB } from './db/connect.js';
import apiRouter from './routes/index.js';
import { attachReportBot } from './routes/reports.js';
import { bot } from './bot/bot.js';
import { startReminderCron } from './cron/reminders.js';
import { startCleanupCron } from './cron/cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBHOOK_PATH = '/telegram/webhook';

async function main() {
  validateEnv();
  await connectDB();
  attachReportBot(bot);

  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Oddiy CORS (Mini App boshqa domendan chaqirishi mumkin).
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // --- Telegram bot ---
  if (env.BOT_MODE === 'webhook') {
    app.use(WEBHOOK_PATH, webhookCallback(bot, 'express'));
  }

  // --- API ---
  app.use('/api', apiRouter);
  app.use('/api/v1', apiRouter);

  // --- Mini App statik fayllari (production) ---
  const miniappDist = path.resolve(__dirname, '../../miniapp/dist');
  app.use(express.static(miniappDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith(WEBHOOK_PATH)) return next();
    res.sendFile(path.join(miniappDist, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'Mini App hali build qilinmagan' });
    });
  });

  // Xatolarni qayta ishlash.
  app.use((err, req, res, next) => {
    console.error('API xatosi:', err.message);
    res.status(err.status || 500).json({ error: err.message || 'Server xatosi' });
  });

  app.listen(env.PORT, () => {
    console.log(`🚀 Server ishlayapti: http://localhost:${env.PORT}`);
  });

  // Botni ishga tushirish.
  if (env.BOT_MODE === 'webhook') {
    const url = `https://${env.RAILWAY_STATIC_URL}${WEBHOOK_PATH}`;
    await bot.api.setWebhook(url, { drop_pending_updates: true });
    console.log(`🤖 Bot webhook rejimida: ${url}`);
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    bot.start({
      onStart: (info) => console.log(`🤖 Bot polling rejimida: @${info.username}`),
    });
  }

  // Cron joblar.
  startReminderCron(bot);
  startCleanupCron();
}

// Toza yopilish.
process.on('SIGINT', () => {
  console.log('\nTo\'xtatilmoqda...');
  process.exit(0);
});
process.on('SIGTERM', () => process.exit(0));

main().catch((err) => {
  console.error('❌ Ishga tushirishda xato:', err);
  process.exit(1);
});
