// Eslatma cron: har daqiqada vaqti kelgan, yuborilmagan eslatmalarni jo'natadi.
import cron from 'node-cron';
import { InlineKeyboard } from 'grammy';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import { notDeleted } from '../models/softDelete.js';
import { ownerId } from '../config/env.js';
import { formatMoney } from '../utils/money.js';
import { formatDateTime } from '../utils/dates.js';
import { formatPhone } from '../utils/phone.js';

function reminderKeyboard(serviceId) {
  return new InlineKeyboard()
    .text('✅ Bajarildi', `svc:done:${serviceId}`)
    .text('❌ Bekor qilindi', `svc:cancel:${serviceId}`)
    .row()
    .text('⏳ 30 daqiqaga kechiktir', `svc:snooze:${serviceId}`);
}

async function fireDueReminders(bot) {
  const nowDate = new Date();
  const services = await Service.find({
    ...notDeleted,
    status: SERVICE_STATUS.PENDING,
    reminders: { $elemMatch: { sent: false, scheduledAt: { $lte: nowDate } } },
  });

  for (const service of services) {
    let changed = false;
    for (const reminder of service.reminders) {
      if (reminder.sent || reminder.scheduledAt > nowDate) continue;

      const text = [
        '🔔 Eslatma!',
        `👤 ${service.clientName}`,
        `📞 ${formatPhone(service.clientPhone)}`,
        `📍 ${service.location?.address || '—'}`,
        `🗓 ${formatDateTime(service.serviceDateTime)}`,
        `💵 ${formatMoney(service.price)}`,
      ].join('\n');

      try {
        await bot.api.sendMessage(ownerId(), text, {
          reply_markup: reminderKeyboard(service._id.toString()),
        });
        reminder.sent = true;
        reminder.sentAt = new Date();
        changed = true;
      } catch (err) {
        console.error('Eslatma yuborishda xato:', err.message);
      }
    }
    if (changed) await service.save();
  }
}

export function startReminderCron(bot) {
  // Har daqiqada.
  cron.schedule('* * * * *', () => {
    fireDueReminders(bot).catch((err) => console.error('Reminder cron xatosi:', err.message));
  });
  console.log('⏰ Eslatma cron ishga tushdi (har daqiqada)');
}
