// Eslatma cron: belgilangan vaqti kelgan eslatmalarni yuboradi.
// Asosiy cron har daqiqada, retry cron har 5 daqiqada ishlaydi.
import cron from 'node-cron';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import { notDeleted } from '../models/softDelete.js';
import { ownerIds } from '../config/env.js';
import { reminderText, serviceActionKeyboard, reminderSnoozeKeyboard } from '../bot/ui.js';

// Urinishlar orasidagi kechikishlar (daqiqada) va maksimal urinishlar soni.
const RETRY_DELAYS_MIN = [5, 15, 60];
const MAX_RETRIES = 3;

// Asosiy va retry cron BITTA umumiy lock ishlatadi: ular bir-biri bilan yoki o'zi
// bilan parallel ishlamaydi (aks holda bir eslatma ikki marta yuborilishi mumkin).
let reminderJobRunning = false;

async function withReminderLock(fn) {
  if (reminderJobRunning) return; // oldingi ishlov tugamadi — bu tikni o'tkazamiz
  reminderJobRunning = true;
  try {
    await fn();
  } finally {
    reminderJobRunning = false;
  }
}

function reminderKeyboard(serviceId, reminder) {
  return reminder.minutesBefore === 0
    ? serviceActionKeyboard(serviceId)
    : reminderSnoozeKeyboard(serviceId);
}

// Bitta eslatmani yuborishga urinadi va sent/retry hisoblagichlarini yangilaydi.
// Asosiy va retry cron ham shu yagona mantiqdan foydalanadi.
async function processReminder(bot, service, reminder, now) {
  const serviceId = service._id.toString();
  try {
    const recipients = ownerIds();
    if (recipients.length === 0) throw new Error('OWNER_TELEGRAM_ID topilmadi');
    await Promise.all(
      recipients.map((telegramId) => bot.api.sendMessage(telegramId, reminderText(service, reminder), {
        reply_markup: reminderKeyboard(serviceId, reminder),
      }))
    );
    reminder.sent = true;
    reminder.sentAt = now;
    reminder.failed = false;
    reminder.nextRetryAt = null;
    if (reminder.minutesBefore === 0) service.completionPromptSent = true;
  } catch (err) {
    console.error('Eslatma yuborishda xato:', err.message);
    reminder.retryCount = (reminder.retryCount || 0) + 1;
    if (reminder.retryCount >= MAX_RETRIES) {
      // 3 urinishdan keyin butunlay muvaffaqiyatsiz deb belgilanadi.
      reminder.failed = true;
      reminder.nextRetryAt = null;
    } else {
      const delayMin = RETRY_DELAYS_MIN[reminder.retryCount - 1] || 60;
      reminder.nextRetryAt = new Date(now.getTime() + delayMin * 60 * 1000);
    }
  }
}

// ASOSIY (har daqiqada): vaqti kelgan, hali yuborilmagan eslatmalar.
// Retry kutayotgan (nextRetryAt kelajakda) eslatmalarni o'tkazib yuboradi — ularni retry cron hal qiladi.
async function fireDueReminders(bot) {
  const now = new Date();
  const services = await Service.find({
    ...notDeleted,
    status: SERVICE_STATUS.PENDING,
    reminders: { $elemMatch: { sent: false, failed: false, scheduledAt: { $lte: now } } },
  });

  for (const service of services) {
    let changed = false;
    for (const reminder of service.reminders) {
      if (reminder.sent || reminder.failed) continue;
      if (reminder.scheduledAt > now) continue;
      if (reminder.retryCount > 0 && reminder.nextRetryAt && reminder.nextRetryAt > now) continue;
      await processReminder(bot, service, reminder, now);
      changed = true;
    }
    if (changed) await service.save();
  }
}

// RETRY (har 5 daqiqada): muvaffaqiyatsiz urinishdan keyin nextRetryAt kelgan eslatmalar.
async function retryFailedReminders(bot) {
  const now = new Date();
  const services = await Service.find({
    ...notDeleted,
    reminders: {
      $elemMatch: { sent: false, failed: false, retryCount: { $gt: 0 }, nextRetryAt: { $lte: now } },
    },
  });

  for (const service of services) {
    let changed = false;
    for (const reminder of service.reminders) {
      if (reminder.sent || reminder.failed) continue;
      if (!reminder.retryCount || !reminder.nextRetryAt || reminder.nextRetryAt > now) continue;
      await processReminder(bot, service, reminder, now);
      changed = true;
    }
    if (changed) await service.save();
  }
}

export function startReminderCron(bot) {
  cron.schedule('* * * * *', () => {
    withReminderLock(() => fireDueReminders(bot)).catch((err) => console.error('Reminder cron xatosi:', err.message));
  });
  cron.schedule('*/5 * * * *', () => {
    withReminderLock(() => retryFailedReminders(bot)).catch((err) => console.error('Retry cron xatosi:', err.message));
  });
  console.log('Eslatma cron ishga tushdi (asosiy: har daqiqada, retry: har 5 daqiqada)');
}
