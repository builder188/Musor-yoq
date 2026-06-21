import { InlineKeyboard } from 'grammy';
import env from '../../config/env.js';
import Conversation from '../../models/Conversation.js';
import { pdfFilterKeyboard } from '../ui.js';

const START_TEXT = 'Salom! 👋 Ovoz, matn, rasm yoki joylashuv yuboring.';

const HELP_TEXT = `Assalomu alaykum!

Men "Musir Yo'q" yordamchingizman. Xizmat, xarajat, to'lov va qidiruvni Telegram orqali boshqarasiz.

Misollar:
• "Sardor aka 998901234567 Chilonzor ertaga 10:00 400 ming naqd"
• "Kecha benzinga 80 ming ketdi"
• "Akmalning xizmati bajarildi"
• "Dilshod 150 ming qarzini berdi"
• "Bu oy qancha topdim?"

Ovoz, matn, daftar rasmi yoki lokatsiya yuborishingiz mumkin.

/pdf - hisobotni PDF qilib olish
/cancel - joriy amalni bekor qilish
/help - yordam`;

export function registerCommands(bot) {
  bot.command('start', async (ctx) => {
    await ctx.reply(START_TEXT, { reply_markup: buildAppKeyboard() });
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(HELP_TEXT, { reply_markup: buildAppKeyboard() });
  });

  bot.command('cancel', async (ctx) => {
    await clearState(ctx);
    await ctx.reply('Bekor qilindi ✅');
  });

  bot.command('pdf', async (ctx) => {
    await ctx.reply('Qaysi hisobotni PDF qilay?', { reply_markup: pdfFilterKeyboard() });
  });

  bot.command('app', async (ctx) => {
    await ctx.reply('Boshqaruv paneli:', { reply_markup: buildAppKeyboard() });
  });

  bot.command('bekor', async (ctx) => {
    await clearState(ctx);
    await ctx.reply('Bekor qilindi ✅');
  });

  bot.command('yordam', async (ctx) => {
    await ctx.reply(HELP_TEXT, { reply_markup: buildAppKeyboard() });
  });
}

async function clearState(ctx) {
  if (ctx.session) {
    ctx.session.intent = null;
    ctx.session.collectedData = {};
    ctx.session.pendingField = null;
    ctx.session.awaitingConfirmation = false;
    ctx.session.lastServiceId = null;
    ctx.session.awaitingReschedule = null;
    ctx.session.awaitingReminderConfig = null;
    ctx.session.ocrQueue = [];
    ctx.session.currentOcrIndex = 0;
  }
  const conv = await Conversation.findOne({ telegramId: ctx.from.id });
  if (conv) await conv.reset();
}

function buildAppKeyboard() {
  if (env.MINIAPP_URL) {
    return new InlineKeyboard().webApp('Panelni ochish', env.MINIAPP_URL);
  }
  return undefined;
}
