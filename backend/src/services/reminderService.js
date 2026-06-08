// Eslatmalarni hisoblash va boshqarish.
import Settings from '../models/Settings.js';

// Xizmat vaqtidan oldingi ofsetlar asosida eslatma vaqtlarini hisoblaydi.
// Faqat kelajakdagi (hozirdan keyingi) eslatmalar qaytariladi.
export async function computeReminders(serviceDateTime, customOffsets = null) {
  const settings = await Settings.getSingleton();
  const offsets = customOffsets || settings.reminderOffsetsMinutes || [1440, 60, 0];

  const target = new Date(serviceDateTime).getTime();
  const nowMs = Date.now();

  const reminders = [];
  for (const offsetMinutes of offsets) {
    const at = new Date(target - offsetMinutes * 60 * 1000);
    if (at.getTime() > nowMs) {
      reminders.push({ at, sent: false, offsetMinutes });
    }
  }
  // Vaqt bo'yicha tartiblash.
  reminders.sort((a, b) => a.at - b.at);
  return reminders;
}

// 30 daqiqaga kechiktirish — yangi bitta eslatma qo'shadi.
export function snoozeReminder(minutes = 30) {
  return { at: new Date(Date.now() + minutes * 60 * 1000), sent: false, offsetMinutes: -minutes };
}
