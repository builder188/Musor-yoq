// Grammy bot setup: owner-only guard, MongoDB session, commands, callbacks, messages.
import { Bot, session, InlineKeyboard } from 'grammy';
import { MongoDBAdapter } from '@grammyjs/storage-mongodb';
import mongoose from 'mongoose';
import env, { isOwnerTelegramId } from '../config/env.js';
import { runWithUser } from '../db/tenantScope.js';

// Mongoose ulanishining native DB handle'i; ulanishdan oldin ham xavfsiz (amallar bufferlanadi).
const db = mongoose.connection;
import { registerCommands } from './handlers/commands.js';
import { registerMessageHandler } from './handlers/message.js';
import { registerCallbacks } from './handlers/callbacks.js';
import Conversation from '../models/Conversation.js';

export const bot = new Bot(env.BOT_TOKEN || 'missing:token');

// Botning HAR bir chiqar xabarini (sendMessage/editMessageText) suhbat tarixiga yozadi.
// Shu orqali egasi keyin matn/ovoz bilan qisqa javob berganda, Gemini botning oldingi
// savolini kontekst sifatida ko'radi. Tugmali savollar ham shu yerda qayd etiladi.
bot.api.config.use(async (prev, method, payload, signal) => {
  const result = await prev(method, payload, signal);
  if ((method === 'sendMessage' || method === 'editMessageText') && typeof payload?.text === 'string') {
    const chatId = Number(payload.chat_id);
    if (Number.isFinite(chatId) && isOwnerTelegramId(chatId)) {
      // Atomar $push/$slice; xatosi suhbatni to'xtatmaydi (fire-and-forget).
      Conversation.pushHistory(chatId, 'bot', payload.text);
    }
  }
  return result;
});

// Owner-only guard + tenant konteksti. Ruxsat berilgan foydalanuvchining BUTUN keyingi
// oqimi (session, handlerlar, AI agent, DB so'rovlari) runWithUser ichida bajariladi —
// shu sabab har bir DB so'rovi avtomatik shu foydalanuvchiga scope qilinadi (boshqalarning
// ma'lumoti ko'rinmaydi). Ruxsatsiz foydalanuvchi — e'tiborsiz qoldiriladi (kontekst yo'q).
bot.use(async (ctx, next) => {
  if (!isOwnerTelegramId(ctx.from?.id)) {
    if (ctx.message?.text?.startsWith('/start')) {
      console.warn(`Unauthorized /start from Telegram ID ${ctx.from?.id || 'unknown'}`);
      await ctx.reply("Bu bot faqat ruxsat berilgan foydalanuvchilar uchun. Railway'da ALLOWED_TELEGRAM_IDS ni tekshiring.");
    }
    return;
  }
  await runWithUser(ctx.from.id, next);
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
