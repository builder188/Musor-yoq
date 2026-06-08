// Grammy bot sozlamasi + faqat egasi uchun himoya (owner guard).
import { Bot } from 'grammy';
import env, { ownerId } from '../config/env.js';
import { registerCommands } from './handlers/commands.js';
import { registerMessageHandler } from './handlers/message.js';
import { registerCallbacks } from './handlers/callbacks.js';

// Token bo'lmasa ham konstruktor xato bermasligi uchun vaqtinchalik qiymat beramiz —
// haqiqiy tekshiruvni validateEnv() amalga oshiradi va aniq xabar bilan to'xtatadi.
export const bot = new Bot(env.BOT_TOKEN || 'missing:token');

// Faqat egasi (OWNER_TELEGRAM_ID) tizimdan foydalana oladi.
bot.use(async (ctx, next) => {
  const fromId = ctx.from?.id;
  if (fromId !== ownerId()) {
    if (ctx.chat?.type === 'private') {
      await ctx.reply('⛔️ Bu shaxsiy tizim. Sizda ruxsat yo\'q.').catch(() => {});
    }
    return; // next() chaqirilmaydi — boshqa hech narsa ishlamaydi.
  }
  return next();
});

registerCommands(bot);
registerCallbacks(bot);
registerMessageHandler(bot);

// Xatolarni ushlash.
bot.catch((err) => {
  console.error('Bot xatosi:', err.error?.message || err.message || err);
});

// Telegram faylini buffer sifatida yuklab olish (ovoz, rasm uchun).
export async function downloadFile(fileId) {
  const file = await bot.api.getFile(fileId);
  const url = `https://api.telegram.org/file/bot${env.BOT_TOKEN}/${file.file_path}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Faylni yuklab bo\'lmadi');
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export default bot;
