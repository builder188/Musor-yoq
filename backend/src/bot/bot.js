// Grammy bot setup: owner-only guard, MongoDB session, commands, callbacks, messages.
import { Bot, session, InlineKeyboard } from 'grammy';
import { MongoDBAdapter } from '@grammyjs/storage-mongodb';
import mongoose from 'mongoose';
import env, { ownerId } from '../config/env.js';

// Mongoose ulanishining native DB handle'i; ulanishdan oldin ham xavfsiz (amallar bufferlanadi).
const db = mongoose.connection;
import { registerCommands } from './handlers/commands.js';
import { registerMessageHandler } from './handlers/message.js';
import { registerCallbacks } from './handlers/callbacks.js';

export const bot = new Bot(env.BOT_TOKEN || 'missing:token');

bot.use(async (ctx, next) => {
  if (ctx.from?.id?.toString() !== String(ownerId())) {
    if (ctx.message?.text?.startsWith('/start')) {
      console.warn(`Unauthorized /start from Telegram ID ${ctx.from?.id || 'unknown'}`);
      await ctx.reply("Bu bot faqat egasi uchun. Railway'da OWNER_TELEGRAM_ID ni tekshiring.");
    }
    return;
  }
  await next();
});

// Sessiya MongoDB'da saqlanadi — bot restart bo'lsa ham suhbat davom etadi.
// mongoose.connection.collection() ulanishdan oldin ham xavfsiz: amallar bufferlanadi.
bot.use(
  session({
    initial: () => ({
      intent: null,
      collectedData: {},
      pendingField: null,
      awaitingConfirmation: false,
      lastServiceId: null,
      awaitingReschedule: null, // qayta rejalashtirilayotgan serviceId
      awaitingReminderConfig: null, // maxsus eslatma kutilayotgan serviceId
      pendingLocation: null,
      pendingLocationRename: false,
      pendingLocationCoords: null,
      ocrQueue: [], // rasm OCR'dan topilgan bir nechta yozuv
      currentOcrIndex: 0,
    }),
    storage: new MongoDBAdapter({
      collection: db.collection('bot_sessions'),
    }),
  })
);

registerCommands(bot);
registerCallbacks(bot);
registerMessageHandler(bot);

bot.catch((err) => {
  console.error('Bot xatosi:', err.error?.message || err.message || err);
});

export async function downloadFile(fileId, api = bot.api) {
  const file = await api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error('Faylni yuklab bo\'lmadi');
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export default bot;
