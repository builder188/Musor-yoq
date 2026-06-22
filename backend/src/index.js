// Musir Yo'q backend entrypoint.
// Express starts first so deploy health checks can report configuration issues.
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import { webhookCallback } from 'grammy';

import env, { getEnvIssues } from './config/env.js';
import { connectDB } from './db/connect.js';
import apiRouter from './routes/index.js';
import { attachReportBot } from './routes/reports.js';
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
  return {
    ok: runtime.ready,
    service: 'musir-yoq',
    mode: runtime.mode,
    db: runtime.db,
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

  const { bot } = await import('./bot/bot.js');
  attachReportBot(bot);

  if (env.BOT_MODE === 'webhook') {
    app.use(WEBHOOK_PATH, webhookCallback(bot, 'express'));
    const url = `https://${env.RAILWAY_STATIC_URL}${WEBHOOK_PATH}`;
    await bot.api.setWebhook(url, { drop_pending_updates: true });
    console.log(`Bot webhook rejimida: ${url}`);
  } else {
    await bot.api.deleteWebhook({ drop_pending_updates: true }).catch(() => {});
    bot.start({
      onStart: (info) => console.log(`Bot polling rejimida: @${info.username}`),
    }).catch((err) => {
      const description = err?.description || err?.error?.description || err?.message || 'Polling xatosi';
      runtime.bot = false;
      runtime.warnings.push(`Bot polling to'xtadi: ${description}`);
      console.error('Bot polling xatosi:', description);
    });
  }

  startReminderCron(bot);
  startCleanupCron();
  runtime.bot = true;
  runtime.ready = true;
  console.log('Backend tayyor');
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

process.on('SIGINT', () => {
  console.log('\nTo\'xtatilmoqda...');
  process.exit(0);
});
process.on('SIGTERM', () => process.exit(0));

main().catch((err) => {
  console.error('Ishga tushirishda xato:', err);
  process.exit(1);
});
