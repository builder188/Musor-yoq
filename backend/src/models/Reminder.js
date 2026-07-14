// Shaxsiy eslatma — asosan qarz uchun ("Sardorga 100 ming qarz berdim, 30 iyunda olaman").
// Egasi qarz berib/olib, belgilangan sanada eslatma oladi. Ixtiyoriy ravishda summa
// balansdan ayiriladi (qarz berdi => chiqim, qarz oldi => kirim) va qaytarilganda tiklanadi.
//
// MUHIM (balans mexanikasi): affectsBalance=true bo'lsa, alohida Transaction yaratiladi va
// uning _id transactionId'da saqlanadi. Eslatma "hal bo'ldi"/"bekor" qilinganda o'sha
// Transaction soft-delete qilinadi — balans avvalgi holatiga qaytadi. Bu Reminder yozuvi
// esa qarz tarixini saqlab qoladi (transaction o'chsa ham).
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';
import { softDeleteFields } from './softDelete.js';

export const REMINDER_STATUS = {
  PENDING: 'pending',
  DONE: 'done',
  CANCELLED: 'cancelled',
};

// 'debt' — qarz (summa + balans ta'siri bo'lishi mumkin). 'general' — oddiy eslatma (matn + sana).
// 'fine' — moshina jarimasi: yaratilganda balansga TEGMAYDI; "to'ladim" bo'lganda
// chiqim Transaction yaratiladi (transactionId) va shu payt balansdan ayiriladi.
export const REMINDER_TYPE = {
  DEBT: 'debt',
  GENERAL: 'general',
  FINE: 'fine',
};

// Qarz yo'nalishi: 'given' — men berdim (qaytishini kutaman, balansdan ayiriladi).
//                  'taken' — men oldim (qaytarishim kerak, balansga qo'shiladi).
export const REMINDER_DIRECTION = {
  GIVEN: 'given',
  TAKEN: 'taken',
};

const reminderSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(REMINDER_TYPE), default: REMINDER_TYPE.DEBT },
    direction: { type: String, enum: Object.values(REMINDER_DIRECTION), default: REMINDER_DIRECTION.GIVEN },

    // Kim bilan bog'liq (Sardor) — qarz uchun. Oddiy eslatmada bo'sh bo'lishi mumkin.
    person: { type: String, default: '', trim: true },
    // Eslatma matni (ko'rsatish uchun). Bo'sh bo'lsa person/summadan tuziladi.
    text: { type: String, default: '' },
    note: { type: String, default: '' },

    amount: { type: Number, default: 0, min: 0 }, // so'mda (USD oldindan aylantiriladi)
    originalAmount: { type: Number, default: null },
    originalCurrency: { type: String, default: null },
    exchangeRateUsed: { type: Number, default: null },

    // Balansga ta'sir qildimi? Qildi bo'lsa — bog'langan tranzaksiya.
    affectsBalance: { type: Boolean, default: false },
    // Egasi ANIQ "balansga tegma" degan (qarz uchun). affectsBalance=false ikki ma'noli
    // edi ("summa hali yo'q" ham false) — bu bayroq niyatni yozuvning o'zida saqlaydi,
    // shunda keyingi tahrirlar tranzaksiyani xato yaratib yubormaydi.
    skipBalance: { type: Boolean, default: false },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

    // Qarz qachon berilgan/olingan (voqea sanasi). Balans tranzaksiyasi shu sanaga yoziladi.
    eventDate: { type: Date, default: Date.now },
    // Egasi qachon eslatish kerakligini aytgan sana (30 iyun). Aytilmagan bo'lsa null —
    // eslatma yuborilmaydi (keyin tahrir/Mini App orqali kiritilishi mumkin).
    dueDate: { type: Date, default: null },
    // Cron aynan qachon xabar yuborishi (odatda dueDate). Snooze shuni suradi.
    // null bo'lsa cron bu yozuvni hech qachon olmaydi ($lte Date null'ga mos kelmaydi).
    remindAt: { type: Date, default: null, index: true },
    // At-most-once: yuborishdan oldin atomar true qilinadi, qaytarilmaydi (dublikatdan saqlanish).
    remindSent: { type: Boolean, default: false },

    status: { type: String, enum: Object.values(REMINDER_STATUS), default: REMINDER_STATUS.PENDING },
    doneAt: { type: Date, default: null },

    source: { type: String, enum: ['bot', 'miniapp'], default: 'bot' },

    ...softDeleteFields,
  },
  { timestamps: true }
);

// Multi-tenant: telegramUserId maydoni + avtomatik scope.
reminderSchema.plugin(tenantScopePlugin);

// Cron tez topishi uchun: ega + holat + yuborish vaqti. Va Mini App ro'yxati: ega + sana.
reminderSchema.index({ telegramUserId: 1, status: 1, remindSent: 1, remindAt: 1 });
reminderSchema.index({ telegramUserId: 1, dueDate: -1 });

export default mongoose.model('Reminder', reminderSchema);
