// Xabarlarni yo'naltirish: matn / ovoz / rasm / lokatsiya -> NLU -> agent.
import Conversation from '../../models/Conversation.js';
import { understandText, understandAudio, understandImage } from '../../ai/gemini.js';
import { runAgent } from '../../ai/agent.js';
import { nextMissing } from '../flow.js';
import { downloadFile } from '../bot.js';

async function getConversation(telegramId) {
  let conv = await Conversation.findOne({ telegramId });
  if (!conv) conv = await Conversation.create({ telegramId });
  return conv;
}

export function registerMessageHandler(bot) {
  // Lokatsiya — alohida (NLU shart emas).
  bot.on('message:location', async (ctx) => {
    const conv = await getConversation(ctx.from.id);
    const { latitude, longitude } = ctx.message.location;

    if (conv.pendingIntent && conv.awaitingField === 'location') {
      conv.collected = {
        ...conv.collected,
        location: { address: 'Lokatsiya (xaritada)', coordinates: { lat: latitude, lng: longitude } },
      };
      conv.markModified('collected');
      // Keyingi maydonni so'rash yoki yakunlash uchun agent orqali davom etamiz.
      const understanding = { intent: conv.pendingIntent, fields: {}, reply: '' };
      // location to'ldirildi, awaitingField ni yangilaymiz:
      const missing = nextMissing(conv.pendingIntent, conv.collected);
      conv.awaitingField = missing;
      await conv.save();
      const res = await runAgent({ understanding, rawText: '', conversation: conv });
      return ctx.reply(res.text);
    }

    await ctx.reply(
      '📍 Lokatsiya qabul qilindi. Endi mijoz, narx kabi ma\'lumotlarni yuboring yoki yangi xizmat boshlang.'
    );
  });

  // Ovozli xabar.
  bot.on('message:voice', async (ctx) => {
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      const buffer = await downloadFile(ctx.message.voice.file_id);
      const understanding = await understandAudio(buffer, ctx.message.voice.mime_type || 'audio/ogg');
      await routeUnderstanding(ctx, understanding, '');
    } catch (err) {
      console.error('Ovozni qayta ishlash xatosi:', err.message);
      await ctx.reply('🎤 Ovozni tushunolmadim. Iltimos, qayta urinib ko\'ring yoki matn yozing.');
    }
  });

  // Audio fayl.
  bot.on('message:audio', async (ctx) => {
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      const buffer = await downloadFile(ctx.message.audio.file_id);
      const understanding = await understandAudio(buffer, ctx.message.audio.mime_type || 'audio/mpeg');
      await routeUnderstanding(ctx, understanding, '');
    } catch (err) {
      console.error('Audio xatosi:', err.message);
      await ctx.reply('🎵 Audioni tushunolmadim. Matn ko\'rinishida yuboring.');
    }
  });

  // Rasm.
  bot.on('message:photo', async (ctx) => {
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1]; // eng katta o'lcham
      const buffer = await downloadFile(photo.file_id);
      const understanding = await understandImage(buffer, 'image/jpeg', ctx.message.caption || '');
      await routeUnderstanding(ctx, understanding, ctx.message.caption || '');
    } catch (err) {
      console.error('Rasm xatosi:', err.message);
      await ctx.reply('🖼 Rasmni o\'qiy olmadim. Aniqroq surat yuboring yoki matn yozing.');
    }
  });

  // Matn.
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      const understanding = await understandText(text);
      await routeUnderstanding(ctx, understanding, text);
    } catch (err) {
      console.error('Matn NLU xatosi:', err.message);
      await ctx.reply('⚠️ AI bilan bog\'lanishda xatolik. Birozdan keyin urinib ko\'ring.');
    }
  });
}

// NLU natijasini agentga uzatib, javob yuborish.
async function routeUnderstanding(ctx, understanding, rawText) {
  const conv = await getConversation(ctx.from.id);
  const res = await runAgent({ understanding, rawText, conversation: conv });
  await ctx.reply(res.text, res.keyboard ? { reply_markup: res.keyboard } : undefined);
}
