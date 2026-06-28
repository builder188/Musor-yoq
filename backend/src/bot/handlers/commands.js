import { InlineKeyboard } from 'grammy';
import env, { miniAppUrl } from '../../config/env.js';
import Conversation from '../../models/Conversation.js';
import Settings from '../../models/Settings.js';
import { pdfFilterKeyboard } from '../ui.js';

const START_TEXT = 'Assalomu aleykum, oka! 👋 Nima gap? Ovoz, matn, rasm yoki joylashuv yuboravering — hammasini o\'zim yozib boraman.';

const HELP_TEXT = `Assalomu aleykum, oka! 🤝

Men "Musir Yo'q" yordamchingizman. Mijoz, xizmat, xarajat, to'lov, material va buyum sotuvi, hamda qidiruvni shu yerda hal qilamiz — siz shunchaki gapiring, qolganini o'zim yozib boraman.

Mana shunaqa yozsangiz bo'ladi:
• "Sardor aka 998901234567 Chilonzor ertaga 10:00 400 ming naqd"
• "Kecha benzinga 80 ming ketdi"
• "30 kg paxtani 300 mingga sotdim"
• "Menda yangi muzlatgich bor"
• "Televizorni Sardorga 1 mln ga sotdim"
• "Akmalning xizmati bajarildi"
• "Dilshod 150 ming to'lab ketdi"
• "Bu oy qancha topdim?"

Ovoz, matn, daftar rasmi yoki lokatsiya — bemalol yuboravering, oka.

/pdf - hisobotni PDF qilib olish
/cancel - joriy amalni bekor qilish
/kod - o'chirish kodini tiklash (unutib qolsangiz)
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
    await ctx.reply('Boldi oka, bekor qildim ✅');
  });

  bot.command('pdf', async (ctx) => {
    await ctx.reply('Qaysi hisobotni PDF qilib beray, oka?', { reply_markup: pdfFilterKeyboard() });
  });

  bot.command('app', async (ctx) => {
    await ctx.reply('Mana boshqaruv paneli, oka 👇', { reply_markup: buildAppKeyboard() });
  });

  bot.command('bekor', async (ctx) => {
    await clearState(ctx);
    await ctx.reply('Boldi oka, bekor qildim ✅');
  });

  bot.command('yordam', async (ctx) => {
    await ctx.reply(HELP_TEXT, { reply_markup: buildAppKeyboard() });
  });

  // O'chirish kodini tiklash. Bot owner-only guard ortida — egasi Telegram orqali
  // o'zini tasdiqlagan, shuning uchun eski kodsiz tiklashga ruxsat (forgot-code recovery).
  // "/kod" -> standart kodga (1990) tiklaydi; "/kod 4567" -> yangi kod o'rnatadi.
  bot.command(['kod', 'kodni_tiklash', 'resetcode'], async (ctx) => {
    const arg = String(ctx.match || '').trim();
    const settings = await Settings.getSingleton(ctx.from.id);
    if (arg) {
      if (!/^\d{4}$/.test(arg)) {
        await ctx.reply("Yangi kod 4 ta raqamdan iborat bo'lishi kerak. Masalan: /kod 4567");
        return;
      }
      settings.deleteCode = arg;
      await settings.save();
      await ctx.reply(`✅ O'chirish tasdiqlash kodi yangilandi: ${arg}`);
      return;
    }
    const fallback = env.CONFIRM_DELETE_CODE || '1990';
    settings.deleteCode = fallback;
    await settings.save();
    await ctx.reply(`🔑 O'chirish kodi standart holatga tiklandi: ${fallback}\nYangi kod o'rnatish uchun: /kod 4567`);
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

    ctx.session.ocrQueue = [];
    ctx.session.currentOcrIndex = 0;
  }
  const conv = await Conversation.findOne({ telegramId: ctx.from.id });
  if (conv) await conv.reset();
}

function buildAppKeyboard() {
  const url = miniAppUrl();
  if (url) {
    return new InlineKeyboard().webApp('Panelni ochish', url);
  }
  return undefined;
}
