// Musir Yo'q backend entrypoint.
// Express starts first so deploy health checks can report configuration issues.
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import mongoose from 'mongoose';
import { webhookCallback } from 'grammy';

import env, { getEnvIssues, miniAppUrl } from './config/env.js';
import { connectDB } from './db/connect.js';
import { migrateTenancy } from './db/migrateTenancy.js';
import apiRouter from './routes/index.js';
import { attachReportBot } from './routes/reports.js';
import { attachNotifierBot } from './bot/notify.js';
import { repairMissingServiceIncome } from './services/serviceService.js';
import { startReminderCron } from './cron/reminders.js';
import { startCleanupCron } from './cron/cleanup.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEBHOOK_PATH = '/telegram/webhook';

const runtime = {
  ready: false,
  db: false,
  bot: false,
  mode: env.BOT_MODE,
  errors: [],
  warnings: [],
  startedAt: new Date().toISOString(),
};

function healthPayload() {
  // DB holatini jonli o'qiymiz (readyState 1 = ulangan), shunda uzilish/qayta ulanish
  // health check'da darhol ko'rinadi — statik bayroq emas.
  const dbConnected = mongoose.connection?.readyState === 1;
  return {
    ok: runtime.ready,
    service: 'musir-yoq',
    mode: runtime.mode,
    db: dbConnected,
    bot: runtime.bot,
    errors: runtime.errors,
    warnings: runtime.warnings,
    startedAt: runtime.startedAt,
  };
}

function unavailable(req, res) {
  res.status(503).json({
    error: 'Server konfiguratsiyasi yoki MongoDB ulanishi tayyor emas',
    health: healthPayload(),
  });
}

async function startRuntime(app) {
  const envIssues = getEnvIssues();
  runtime.errors = envIssues.errors;
  runtime.warnings = envIssues.warnings;

  if (!envIssues.ok) {
    console.error('\nXATO: Konfiguratsiya tayyor emas, server diagnostika rejimida ishlayapti:');
    for (const error of envIssues.errors) console.error(`   - ${error}`);
    for (const warning of envIssues.warnings) console.warn(`   - ${warning}`);
    console.error('Railway Variables bo\'limida kerakli qiymatlarni kiriting.\n');
    return;
  }

  await connectDB();
  runtime.db = true;

  // Multi-tenant backfill: eski (telegramUserId'siz) yozuvlarni asosiy egasiga biriktiradi.
  // Idempotent — bot/API yozuvlardan OLDIN, bir marta (keyin no-op) ishlaydi.
  try {
    await migrateTenancy();
  } catch (err) {
    console.error('Tenant migratsiya xatosi:', err.message);
  }

  const { bot } = await import('./bot/bot.js');
  attachReportBot(bot);
  attachNotifierBot(bot);
  await setupMenuButton(bot);

  if (env.BOT_MODE === 'webhook') {
    // MUHIM: timeout'da xato OTMAYMIZ. grammy default 'throw' bo'lsa, Express async
    // middleware ichidagi rejected promise "unhandled rejection" bo'lib butun process'ni
    // o'ldiradi (avval server shu sabab yiqilgan). 'return' => sekin handler'da Telegram'ga
    // 200 qaytaramiz, ish esa fonda davom etib javobni baribir yuboradi.
    // 10s default ovoz/rasm oqimiga (bir nechta Gemini chaqiruvi) juda kam — 25s qo'yamiz.
    app.use(
      WEBHOOK_PATH,
      webhookCallback(bot, 'express', { onTimeout: 'return', timeoutMilliseconds: 25_000 })
    );
    const url = `https://${env.RAILWAY_STATIC_URL}${WEBHOOK_PATH}`;
    await bot.api.setWebhook(url, { drop_pending_updates: true });
    runtime.bot = true;
    console.log(`Bot webhook rejimida: ${url}`);
  } else {
    // Polling promise'i bot to'xtaganda hal bo'ladi — uni kutmaymiz, aks holda
    // server tayyor bo'lmaydi. Konflikt qayta urinishlari fonda davom etadi.
    startPollingResilient(bot);
  }

  startReminderCron(bot);
  startCleanupCron();
  runtime.ready = true;
  console.log('Backend tayyor');

  // Bajarilgan, lekin balansga tushmay qolgan eski xizmatlarni fonda tiklaymiz
  // (deploy boshlanishini bloklamaydi).
  repairMissingServiceIncome().catch((err) => console.error('Daromad tiklash xatosi:', err.message));
}

// Telegram "MENU" tugmasini Mini App'ga ulaydi. Tugma bosilganda Mini App ochiladi,
// ichkarida esa telegram.js requestFullscreen() bilan butun ekranga o'tadi.
async function setupMenuButton(bot) {
  const url = miniAppUrl();
  if (!url) {
    console.warn("Menu tugmasi o'rnatilmadi: MINIAPP_URL/RAILWAY_STATIC_URL yo'q.");
    return;
  }
  try {
    await bot.api.setChatMenuButton({
      menu_button: { type: 'web_app', text: 'Panel', web_app: { url } },
    });
    console.log(`Menu tugmasi Mini App'ga ulandi: ${url}`);
  } catch (err) {
    console.warn("Menu tugmasini sozlab bo'lmadi:", err.message);
  }
}

function isConflictError(err) {
  const code = err?.error_code ?? err?.error?.error_code;
  const description = err?.description || err?.error?.description || err?.message || '';
  return code === 409 || /conflict/i.test(description);
}

// Telegram bitta token uchun faqat bitta getUpdates poller'ga ruxsat beradi. Railway
// redeploy paytida eski konteyner bir necha soniya hali poll qilib turishi mumkin, shuning
// uchun 409 konflikt botni butunlay o'ldirmaydi — eski instance chiqib ketguncha qayta uriniladi.
async function startPollingResilient(bot) {
  const maxConflictRetries = 30;
  let conflictRetries = 0;

  for (;;) {
    try {
      await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
      await bot.start({
        onStart: (info) => {
          conflictRetries = 0;
          runtime.bot = true;
          console.log(`Bot polling rejimida: @${info.username}`);
        },
      });
      // bot.start() faqat bot.stop() chaqirilganda hal bo'ladi — normal to'xtash.
      runtime.bot = false;
      return;
    } catch (err) {
      const description = err?.description || err?.error?.description || err?.message || 'Polling xatosi';
      runtime.bot = false;
      if (isConflictError(err) && conflictRetries < maxConflictRetries) {
        conflictRetries += 1;
        console.error(`Bot polling konflikti (${conflictRetries}/${maxConflictRetries}): ${description}. 5s dan keyin qayta urinish...`);
        await new Promise((resolve) => setTimeout(resolve, 5000));
        continue;
      }
      runtime.warnings.push(`Bot polling to'xtadi: ${description}`);
      console.error('Bot polling xatosi:', description);
      return;
    }
  }
}

async function main() {
  const app = express();
  app.use(express.json({ limit: '5mb' }));

  // Simple CORS for Telegram Mini App and browser checks.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, X-Telegram-Init-Data');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.get(['/health', '/api/health', '/api/v1/health'], (req, res) => {
    res.json(healthPayload());
  });

  // API calls get clear diagnostics until DB/bot startup is complete.
  app.use('/api/v1', (req, res, next) => (runtime.ready ? apiRouter(req, res, next) : unavailable(req, res)));
  app.use('/api', (req, res, next) => (runtime.ready ? apiRouter(req, res, next) : unavailable(req, res)));

  const miniappDist = path.resolve(__dirname, '../../miniapp/dist');
  app.use(express.static(miniappDist));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith(WEBHOOK_PATH)) return next();
    res.sendFile(path.join(miniappDist, 'index.html'), (err) => {
      if (err) res.status(404).json({ error: 'Mini App hali build qilinmagan' });
    });
  });

  app.use((err, req, res, next) => {
    let status = err.status || 500;
    let message = err.message || 'Server xatosi';
    if (err.name === 'CastError') {
      status = 400;
      message = "ID yoki qiymat formati noto'g'ri";
    } else if (err.name === 'ValidationError') {
      status = 400;
      message = Object.values(err.errors || {})[0]?.message || "Ma'lumotlar noto'g'ri";
    } else if (err.code === 11000) {
      status = 409;
      message = 'Bu ma\'lumot allaqachon mavjud';
    }
    console.error('API xatosi:', message);
    res.status(status).json({ error: message });
  });

  app.listen(env.PORT, () => {
    console.log(`Server ishlayapti: http://localhost:${env.PORT}`);
  });

  startRuntime(app).catch((err) => {
    runtime.ready = false;
    runtime.errors = [err.message || 'Runtime start xatosi'];
    console.error('Runtime start xatosi:', err);
  });
}

// So'nggi himoya chizig'i: bitta xato (masalan bironta handler'dagi kutilmagan
// rejection) butun botni o'ldirmasligi kerak. Loglaymiz, lekin process'ni tirik
// qoldiramiz — Railway qayta ishga tushishini kutib turish o'rniga bot ishlayveradi.
process.on('unhandledRejection', (reason) => {
  console.error('Ushlanmagan promise rejection:', reason?.stack || reason?.message || reason);
});
process.on('uncaughtException', (err) => {
  console.error('Ushlanmagan istisno (process tirik qoldirildi):', err?.stack || err?.message || err);
});

process.on('SIGINT', () => {
  console.log('\nTo\'xtatilmoqda...');
  process.exit(0);
});
process.on('SIGTERM', () => process.exit(0));

main().catch((err) => {
  console.error('Ishga tushirishda xato:', err);
  process.exit(1);
});
