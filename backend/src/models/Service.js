// Xizmat (musor olib ketish ishi) modeli.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';

export const SERVICE_STATUS = {
  PENDING: 'kutilmoqda',
  DONE: 'bajarildi',
  CANCELLED: 'bekor_qilindi',
};

export const PAYMENT_METHODS = ['naqd', 'karta', 'otkazma'];

export const PAYMENT_STATUS = {
  UNPAID: 'tolanmagan',
  PAID: 'tolangan',
  PARTIAL: 'qisman',
};

const imageSchema = new mongoose.Schema(
  {
    telegramFileId: { type: String },
  },
  { _id: false }
);

const serviceSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    // Tezkorlik uchun nusxa (denormalizatsiya).
    clientName: { type: String },
    clientPhone: { type: String },

    location: {
      address: { type: String, required: true },
      mapUrl: { type: String, default: null },
    },

    serviceDateTime: { type: Date, required: true, index: true },
    isHistorical: { type: Boolean, default: false },

    price: { type: Number, required: true, min: 0 }, // YAKUNIY summa — DOIM so'mda (balans/hisobot shu).
    // Asl valyuta (dollarda kelishilган bo'lsa) — faqat eslab qolish uchun; balansda ishlatilmaydi.
    originalAmount: { type: Number, default: null }, // mas. 100
    originalCurrency: { type: String, default: null }, // mas. 'USD'
    exchangeRateUsed: { type: Number, default: null }, // mas. 12052 (1$ = ... so'm)
    // To'lov usuli endi bot oqimida so'ralmaydi (egasi uchun ahamiyatsiz). Default 'naqd';
    // Mini App'dan istalgan vaqtda o'zgartirilishi mumkin.
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'naqd' },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.UNPAID,
    },
    paidAmount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: Object.values(SERVICE_STATUS),
      default: SERVICE_STATUS.PENDING,
      index: true,
    },
    cancellationReason: { type: String, default: null },
    completedAt: { type: Date, default: null },

    // Xizmat vaqtiga nisbatan eslatma/tasdiqlash jadvali (cron shu yerga qaraydi).
    //  - reminderAt: serviceDateTime - reminderHoursBefore (oldindan eslatma).
    //  - startReminderSent: xizmat VAQTIDA ("hozir borish vaqti") eslatma yuborilganmi.
    //    Vaqti serviceDateTime ga teng, shuning uchun alohida sana saqlanmaydi.
    //  - confirmAt:  serviceDateTime + confirmHoursAfter (tugmali tasdiq).
    // *Sent bayroqlari atomar belgilanadi — bir xabar ikki marta yuborilmaydi.
    reminderAt: { type: Date, default: null, index: true },
    reminderSent: { type: Boolean, default: false },
    startReminderSent: { type: Boolean, default: false },
    confirmAt: { type: Date, default: null, index: true },
    confirmSent: { type: Boolean, default: false },

    notes: { type: String },
    images: { type: [imageSchema], default: [] },

    incomeTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    isDeletedByClientDeletion: { type: Boolean, default: false },
    clientDeletionNote: { type: String, default: '' },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indekslar: clientId, status, serviceDateTime (yuqorida), isDeleted.
serviceSchema.index({ isDeleted: 1 });
// Multi-tenant: telegramUserId maydoni + avtomatik scope (har bir query/aggregate/save).
serviceSchema.plugin(tenantScopePlugin);
// Eng ko'p ishlatiladigan filtrlar telegramUserId bilan birga keladi.
serviceSchema.index({ telegramUserId: 1, serviceDateTime: -1 });
serviceSchema.index({ telegramUserId: 1, status: 1 });

export default mongoose.model('Service', serviceSchema);
