// Eslatma/tasdiqlash jadvali — xizmat vaqtiga NISBATAN.
//   reminderAt = serviceDateTime - reminderHoursBefore soat  (oddiy eslatma, tugmasiz)
//   confirmAt  = serviceDateTime + confirmHoursAfter  soat    (tugmali tasdiqlash)
// Soatlar Settings'dan olinadi (default 3/3). Cron shu maydonlarga qarab xabar yuboradi.
import Settings from '../models/Settings.js';

function clampHours(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, 168); // 7 kungacha
}

// Sozlamalardagi soatlar asosida reminderAt/confirmAt ni hisoblaydi.
export async function computeServiceSchedule(serviceDateTime) {
  const settings = await Settings.getSingleton();
  const before = clampHours(settings.reminderHoursBefore, 3);
  const after = clampHours(settings.confirmHoursAfter, 3);
  const target = new Date(serviceDateTime).getTime();
  return {
    reminderAt: new Date(target - before * 3600000),
    confirmAt: new Date(target + after * 3600000),
  };
}

// Xizmat hujjatiga jadvalni qo'llaydi (saqlamaydi — chaqiruvchi save qiladi).
// Tarixiy xizmatda eslatma/tasdiq yo'q. Reschedule paytida eski *Sent bayroqlari
// nollanadi: eskisi bekor bo'lib, yangi jadval qayta ishlaydi. Vaqti allaqachon
// o'tgan oldindan-eslatma qayta yuborilmaydi; confirm esa xizmat hal qilinishi uchun qoladi.
export async function applyServiceSchedule(service, { now = new Date() } = {}) {
  if (service.isHistorical) {
    service.reminderAt = null;
    service.confirmAt = null;
    service.reminderSent = true;
    service.confirmSent = true;
    return service;
  }

  const { reminderAt, confirmAt } = await computeServiceSchedule(service.serviceDateTime);
  const nowMs = now.getTime();
  service.reminderAt = reminderAt;
  service.confirmAt = confirmAt;
  // Oldindan eslatma faqat vaqti hali kelmagan bo'lsa yuboriladi (kech eslatma — bekor).
  service.reminderSent = reminderAt.getTime() <= nowMs;
  // Tasdiqlash har doim yuborilishi kerak (kech bo'lsa ham — xizmat hal qilinishi shart).
  service.confirmSent = false;
  return service;
}
