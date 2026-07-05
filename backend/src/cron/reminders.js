// Eslatma/tasdiqlash cron — har daqiqada bir marta ishlaydi.
//   1) reminderAt kelganda: oldindan eslatma (tugmasiz), xizmat hali kelajakda bo'lsa.
//   2) serviceDateTime kelganda: xizmat VAQTIDAGI eslatma (tugmasiz, "hozir vaqti").
//   3) confirmAt  kelganda: "bajarildimi?" tasdiq so'rovi (tugmali).
//
// MULTI-TENANT: cron BARCHA foydalanuvchilarning xizmatlarini birga tekshiradi (runGlobal),
// lekin har bir eslatma FAQAT o'sha yozuvning egasiga (service.telegramUserId) yuboriladi —
// boshqa foydalanuvchilarga emas.
//
// DUBLIKAT BO'LMASLIGI (eng muhim kafolat): har bir xabar yuborishdan OLDIN atomar "claim"
// qilinadi (findOneAndUpdate sent:false -> true). Claim qilingach bayroq HECH QACHON
// qaytarilmaydi — Telegram xatosi/timeout bo'lsa ham. Sababi: xato xabar AKTUAL yetib
// borgandan KEYIN ham kelishi mumkin; bayroqni qaytarsak keyingi tik QAYTA yuboradi
// (dublikat). Shuning uchun "ko'pi bilan bir marta": dublikatdan ko'ra (juda kamdan-kam)
// yo'qotish afzal. Foydalanuvchi botni bloklagan bo'lsa (403) — at-most-once tufayli
// xabar bir marta uriniladi va qaytmaydi (cheksiz qayta-yuborish/spam bo'lmaydi).
import cron from 'node-cron';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import Conversation from '../models/Conversation.js';
import Reminder, { REMINDER_STATUS, REMINDER_TYPE } from '../models/Reminder.js';
import { runGlobal } from '../db/tenantScope.js';
import {
  serviceReminderText,
  serviceStartReminderText,
  serviceConfirmText,
  confirmServiceKeyboard,
  debtReminderDueText,
  debtReminderKeyboard,
  fineReminderDueText,
  fineReminderKeyboard,
} from '../bot/ui.js';

// Xizmat vaqtidagi eslatma juda kech qolsa ("hozir vaqti" demaslik uchun) — masalan bot
// bir necha soat o'chiq bo'lsa yoki eski/o'tib ketgan yozuv bo'lsa — jimgina belgilab o'tamiz.
const START_REMINDER_GRACE_MS = 2 * 60 * 60 * 1000;

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

// Eslatmani FAQAT o'sha yozuvning egasiga yuboradi. Yetkazilsa 1, aks holda 0.
// 403 (botni bloklagan) / 400 (chat topilmadi) — DOIMIY xatolar: at-most-once tufayli
// qayta urinilmaydi, faqat aniq loglanadi (cheksiz qayta-yuborish/spam bo'lmaydi).
async function sendToOwner(bot, telegramUserId, text, extra) {
  const id = String(telegramUserId || '').trim();
  if (!id) {
    console.error('Eslatma yuborilmadi: yozuvda telegramUserId yo\'q');
    return 0;
  }
  try {
    await bot.api.sendMessage(id, text, extra);
    return 1;
  } catch (err) {
    const desc = err?.description || err?.error?.description || err?.message || err;
    console.error(`Eslatma ${id} ga yetmadi (qayta yuborilmaydi): ${desc}`);
    return 0;
  }
}

// "Bajarildimi?" so'rovi yuborilgan xizmatni FAQAT o'sha egasining suhbatida eslab qoladi —
// egasi tugma bosmasdan matn/ovoz bilan ("ha bajardim", "yo'q") javob bersa shu xizmatga bog'lanadi.
async function markConfirmContext(serviceId, telegramUserId) {
  const id = Number(telegramUserId);
  if (!Number.isFinite(id)) return;
  await Conversation.updateOne(
    { telegramId: id },
    { $set: { lastConfirmServiceId: String(serviceId), lastConfirmAt: new Date() } },
    { upsert: true }
  ).catch(() => null);
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

    // Claim bajarildi — bayroqni QAYTARMAYMIZ (yuqoridagi izoh: dublikatdan saqlanish).
    const delivered = await sendToOwner(bot, claimed.telegramUserId, serviceReminderText(claimed));
    if (delivered === 0) console.error(`Oldindan eslatma yetmadi (xizmat ${claimed._id}, ega ${claimed.telegramUserId}).`);
  }
}

// Xizmat vaqti kelgan (serviceDateTime <= now) xizmatlar uchun "hozir vaqti" eslatmasi.
async function fireStartReminders(bot) {
  const now = new Date();
  const due = await Service.find({
    isDeleted: { $ne: true },
    status: SERVICE_STATUS.PENDING,
    isHistorical: { $ne: true },
    startReminderSent: false,
    serviceDateTime: { $lte: now },
  })
    .sort({ serviceDateTime: 1 })
    .limit(50);

  for (const service of due) {
    const claimed = await Service.findOneAndUpdate(
      {
        _id: service._id,
        startReminderSent: false,
        status: SERVICE_STATUS.PENDING,
        isDeleted: { $ne: true },
      },
      { $set: { startReminderSent: true } },
      { new: true }
    );
    if (!claimed) continue; // boshqa tik ulgurdi yoki holat o'zgardi

    // Juda kech qolgan eslatma — "hozir vaqti" demaymiz, faqat belgilab o'tamiz (tasdiq baribir keladi).
    if (now.getTime() - new Date(claimed.serviceDateTime).getTime() > START_REMINDER_GRACE_MS) continue;

    // Claim bajarildi — bayroqni QAYTARMAYMIZ (dublikatdan saqlanish).
    const delivered = await sendToOwner(bot, claimed.telegramUserId, serviceStartReminderText(claimed));
    if (delivered === 0) console.error(`Vaqt eslatmasi yetmadi (xizmat ${claimed._id}, ega ${claimed.telegramUserId}).`);
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

    // Claim bajarildi — bayroqni QAYTARMAYMIZ (dublikatdan saqlanish).
    // Har xizmatga ALOHIDA xabar (o'z serviceId, o'z tugmalari) — birlashtirilmaydi.
    const delivered = await sendToOwner(bot, claimed.telegramUserId, serviceConfirmText(claimed), {
      reply_markup: confirmServiceKeyboard(claimed._id.toString()),
    });
    if (delivered > 0) {
      // Tugmasiz (matn/ovoz) javob shu xizmatga tegishli bo'lishi uchun eslab qo'yamiz.
      await markConfirmContext(claimed._id, claimed.telegramUserId);
    } else {
      console.error(`Tasdiq so'rovi yetmadi (xizmat ${claimed._id}, ega ${claimed.telegramUserId}).`);
    }
  }
}

// Qarz eslatmalari (Reminder): remindAt kelganda egaga tugmali xabar yuboriladi.
// Xizmat eslatmalari bilan bir xil at-most-once kafolati: atomar claim, bayroq qaytarilmaydi.
async function fireDebtReminders(bot) {
  const now = new Date();
  const due = await Reminder.find({
    isDeleted: { $ne: true },
    status: REMINDER_STATUS.PENDING,
    remindSent: false,
    remindAt: { $lte: now },
  })
    .sort({ remindAt: 1 })
    .limit(50);

  for (const reminder of due) {
    const claimed = await Reminder.findOneAndUpdate(
      {
        _id: reminder._id,
        remindSent: false,
        status: REMINDER_STATUS.PENDING,
        isDeleted: { $ne: true },
      },
      { $set: { remindSent: true } },
      { new: true }
    );
    if (!claimed) continue; // boshqa tik ulgurdi yoki holat o'zgardi

    // Jarima eslatmasi — o'z matni (summa bilan/siz) va [✅ To'ladim] tugmasi.
    const isFine = claimed.type === REMINDER_TYPE.FINE;
    const text = isFine ? fineReminderDueText(claimed) : debtReminderDueText(claimed);
    const keyboard = isFine ? fineReminderKeyboard(claimed._id.toString()) : debtReminderKeyboard(claimed._id.toString());
    const delivered = await sendToOwner(bot, claimed.telegramUserId, text, {
      reply_markup: keyboard,
    });
    if (delivered === 0) console.error(`${isFine ? 'Jarima' : 'Qarz'} eslatmasi yetmadi (eslatma ${claimed._id}, ega ${claimed.telegramUserId}).`);
  }
}

export function startReminderCron(bot) {
  cron.schedule('* * * * *', () => {
    // runGlobal: cron barcha foydalanuvchilar yozuvlarini ko'radi (ataylab — har biri
    // o'z egasiga yuboriladi). Tenant-scope plugin global rejimda filtr qo'shmaydi.
    runGlobal(() =>
      withLock(async () => {
        await fireReminders(bot);
        await fireStartReminders(bot);
        await fireConfirms(bot);
        await fireDebtReminders(bot);
      })
    ).catch((err) => console.error('Reminder cron xatosi:', err.message));
  });
  console.log('Eslatma cron ishga tushdi (har daqiqada: oldindan + xizmat vaqtida eslatma + tasdiq so\'rovi + qarz eslatmasi)');
}
