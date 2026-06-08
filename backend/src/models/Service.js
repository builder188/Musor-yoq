// Xizmat (musor olib ketish ishi) modeli.
import mongoose from 'mongoose';
import { softDeleteFields } from './softDelete.js';

export const SERVICE_STATUS = {
  PENDING: 'kutilmoqda',
  DONE: 'bajarildi',
  CANCELLED: 'bekor_qilindi',
};

export const PAYMENT_METHODS = ['naqd', 'karta', "o'tkazma"];

const reminderSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    sent: { type: Boolean, default: false },
    // Qaysi ofset (daqiqada) — log/diagnostika uchun.
    offsetMinutes: { type: Number, default: 0 },
  },
  { _id: false }
);

const serviceSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', index: true },
    // Tezkor ko'rsatish uchun mijoz ma'lumotlari nusxasi.
    clientName: { type: String, required: true, trim: true },
    clientPhone: { type: String, required: true, trim: true },

    location: {
      text: { type: String, default: '' },
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },

    serviceDateTime: { type: Date, required: true, index: true },
    price: { type: Number, required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },

    status: {
      type: String,
      enum: Object.values(SERVICE_STATUS),
      default: SERVICE_STATUS.PENDING,
      index: true,
    },

    notes: { type: String, default: '' },
    // Xabarda o'tgan zamon ishlatilgan bo'lsa true (tarixiy yozuv).
    isHistorical: { type: Boolean, default: false },
    // Mijoz shu xizmat uchun to'lagan summa (qisman to'lovlar uchun).
    paidAmount: { type: Number, default: 0 },

    reminders: { type: [reminderSchema], default: [] },

    // Xizmat "bajarildi" bo'lganda yaratilgan daromad tranzaksiyasi.
    incomeTransactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Transaction',
      default: null,
    },

    ...softDeleteFields,
  },
  { timestamps: true }
);

export default mongoose.model('Service', serviceSchema);
