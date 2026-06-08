// Bot buyruqlari: /start, /app, /bekor.
import { InlineKeyboard } from 'grammy';
import env from '../../config/env.js';
import Conversation from '../../models/Conversation.js';

const WELCOME = `Assalomu alaykum! 👋

Men "Musir Yo'q" yordamchingizman. Menga shunchaki yozing yoki ayting:

🎤 Ovozli xabar (o'zbekcha)
📝 Matn
🖼 Rasm (daftardagi yozuv)
📍 Lokatsiya

Misollar:
• "Sardor aka, +998901234567, Chilonzor, ertaga soat 10da, 400 ming, naqd"
• "Bugun yoqilg'iga 50 ming sarfladim"
• "Sardorning xizmati bajarildi"
• "Bu oyda qancha topdim?"

Pastdagi tugma orqali boshqaruv panelini oching 👇`;

export function registerCommands(bot) {
  bot.command('start', async (ctx) => {
    const keyboard = buildAppKeyboard();
    await ctx.reply(WELCOME, { reply_markup: keyboard });
  });

  bot.command('app', async (ctx) => {
    await ctx.reply('📊 Boshqaruv paneli:', { reply_markup: buildAppKeyboard() });
  });

  bot.command('bekor', async (ctx) => {
    const conv = await Conversation.findOne({ telegramId: ctx.from.id });
    if (conv) await conv.reset();
    await ctx.reply('❌ Joriy amal bekor qilindi.');
  });

  bot.command('yordam', async (ctx) => {
    await ctx.reply(WELCOME, { reply_markup: buildAppKeyboard() });
  });
}

function buildAppKeyboard() {
  if (env.MINIAPP_URL) {
    return new InlineKeyboard().webApp('📊 Panelni ochish', env.MINIAPP_URL);
  }
  // MINIAPP_URL hali sozlanmagan bo'lsa — tugmasiz.
  return undefined;
}
