// Eslatma/tasdiqlash cron — har daqiqada bir marta ishlaydi.
//   1) reminderAt kelganda: oddiy eslatma (tugmasiz), xizmat hali kelajakda bo'lsa.
//   2) confirmAt  kelganda: "bajarildimi?" tasdiq so'rovi (tugmali).
// Ikki marta yubormaslik kafolati: har bir xabar ATOMAR claim qilinadi
// (findOneAndUpdate sent:false -> true). Yuborish xato bo'lsa, bayroq qaytariladi (keyingi tik qayta uradi).
import cron from 'node-cron';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import Conversation from '../models/Conversation.js';
import { ownerIds } from '../config/env.js';
import { serviceReminderText, serviceConfirmText, confirmServiceKeyboard } from '../bot/ui.js';

// Bitta tik tugamasdan ikkinchisi boshlanmasin (bitta instansda qo'shimcha himoya).
let running = false;
async function withLock(fn) {
  if (running) return;
  running = true;
  try {
    await fn();
  } finally {
    running = false;
  }
}

async function broadcast(bot, text, extra) {
  const recipients = ownerIds();
  if (recipients.length === 0) throw new Error('OWNER_TELEGRAM_ID topilmadi');
  await Promise.all(recipients.map((telegramId) => bot.api.sendMessage(telegramId, text, extra)));
}

// "Bajarildimi?" so'rovi yuborilgan xizmatni eslab qoladi — egasi tugma bosmasdan
// matn/ovoz bilan ("ha bajardim", "yo'q", "keyinroq") javob bersa shu xizmatga bog'lanadi.
async function markConfirmContext(serviceId) {
  const recipients = ownerIds();
  await Promise.all(
    recipients.map((telegramId) =>
      Conversation.updateOne(
        { telegramId },
        { $set: { lastConfirmServiceId: String(serviceId), lastConfirmAt: new Date() } },
        { upsert: true }
      ).catch(() => null)
    )
  );
}

// reminderAt kelgan kelajak xizmatlar uchun oddiy eslatma.
async function fireReminders(bot) {
  const now = new Date();
  const due = await Service.find({
    isDeleted: { $ne: true },
    status: SERVICE_STATUS.PENDING,
    isHistorical: { $ne: true },
    reminderSent: false,
    reminderAt: { $lte: now },
    serviceDateTime: { $gt: now }, // o'tib ketgan xizmatga oldindan eslatma yubormaymiz
  })
    .sort({ reminderAt: 1 })
    .limit(50);

  for (const service of due) {
    // ATOMAR claim: faqat bitta tik (yoki instans) muvaffaqiyatli belgilaydi.
    const claimed = await Service.findOneAndUpdate(
      {
        _id: service._id,
        reminderSent: false,
        reminderAt: service.reminderAt,
        status: SERVICE_STATUS.PENDING,
        isDeleted: { $ne: true },
        serviceDateTime: { $gt: now },
      },
      { $set: { reminderSent: true } },
      { new: true }
    );
    if (!claimed) continue; // boshqa tik ulgurdi yoki holat o'zgardi

    try {
      await broadcast(bot, serviceReminderText(claimed));
    } catch (err) {
      console.error('Eslatma yuborishda xato:', err.message);
      // Yuborilmadi — bayroqni qaytaramiz, keyingi tik qayta uradi.
      await Service.updateOne(
        { _id: claimed._id, reminderAt: claimed.reminderAt, status: SERVICE_STATUS.PENDING, isDeleted: { $ne: true } },
        { $set: { reminderSent: false } }
      );
    }
  }
}

// confirmAt kelgan xizmatlar uchun "bajarildimi?" tugmali so'rov.
async function fireConfirms(bot) {
  const now = new Date();
  const due = await Service.find({
    isDeleted: { $ne: true },
    status: SERVICE_STATUS.PENDING,
    isHistorical: { $ne: true },
    confirmSent: false,
    confirmAt: { $lte: now },
  })
    .sort({ confirmAt: 1 })
    .limit(50);

  for (const service of due) {
    const claimed = await Service.findOneAndUpdate(
      {
        _id: service._id,
        confirmSent: false,
        confirmAt: service.confirmAt,
        status: SERVICE_STATUS.PENDING,
        isDeleted: { $ne: true },
      },
      { $set: { confirmSent: true } },
      { new: true }
    );
    if (!claimed) continue;

    try {
      // Har xizmatga ALOHIDA xabar (o'z serviceId, o'z tugmalari) — birlashtirilmaydi.
      await broadcast(bot, serviceConfirmText(claimed), {
        reply_markup: confirmServiceKeyboard(claimed._id.toString()),
      });
      // Tugmasiz (matn/ovoz) javob shu xizmatga tegishli bo'lishi uchun eslab qo'yamiz.
      await markConfirmContext(claimed._id);
    } catch (err) {
      console.error('Tasdiq so\'rovida xato:', err.message);
      await Service.updateOne(
        { _id: claimed._id, confirmAt: claimed.confirmAt, status: SERVICE_STATUS.PENDING, isDeleted: { $ne: true } },
        { $set: { confirmSent: false } }
      );
    }
  }
}

export function startReminderCron(bot) {
  cron.schedule('* * * * *', () => {
    withLock(async () => {
      await fireReminders(bot);
      await fireConfirms(bot);
    }).catch((err) => console.error('Reminder cron xatosi:', err.message));
  });
  console.log('Eslatma cron ishga tushdi (har daqiqada: oldindan eslatma + tasdiq so\'rovi)');
}
