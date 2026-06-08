// Inline tugma bosishlari: eslatma tugmalari (bajarildi/bekor/kechiktir).
import Service from '../../models/Service.js';
import { completeService, cancelService } from '../../services/serviceService.js';
import { snoozeReminder } from '../../services/reminderService.js';
import { formatMoney } from '../../utils/money.js';

export function registerCallbacks(bot) {
  // Bajarildi.
  bot.callbackQuery(/^svc:done:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await completeService(id, { markPaid: true });
      await ctx.answerCallbackQuery({ text: 'Bajarildi ✅' });
      await ctx.editMessageText(
        `🟢 "${service.clientName}" xizmati bajarildi.\n💰 Daromad: ${formatMoney(service.price)}`
      );
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  // Bekor qilindi.
  bot.callbackQuery(/^svc:cancel:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await cancelService(id);
      await ctx.answerCallbackQuery({ text: 'Bekor qilindi ❌' });
      await ctx.editMessageText(`🔴 "${service.clientName}" xizmati bekor qilindi.`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });

  // 30 daqiqaga kechiktirish.
  bot.callbackQuery(/^svc:snooze:(.+)$/, async (ctx) => {
    const id = ctx.match[1];
    try {
      const service = await Service.findById(id);
      if (!service) throw new Error('Xizmat topilmadi');
      service.reminders.push(snoozeReminder(30));
      await service.save();
      await ctx.answerCallbackQuery({ text: '30 daqiqaga kechiktirildi ⏳' });
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
      await ctx.reply(`⏳ "${service.clientName}" uchun eslatma 30 daqiqaga kechiktirildi.`);
    } catch (err) {
      await ctx.answerCallbackQuery({ text: 'Xatolik: ' + err.message, show_alert: true });
    }
  });
}
