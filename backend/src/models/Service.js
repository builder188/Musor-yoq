// Xizmat (musor olib ketish ishi) modeli.
import mongoose from 'mongoose';

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

    price: { type: Number, required: true, min: 0 },
    paymentMethod: { type: String, enum: PAYMENT_METHODS, required: true },
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
    //  - reminderAt: serviceDateTime - reminderHoursBefore (oddiy eslatma).
    //  - confirmAt:  serviceDateTime + confirmHoursAfter (tugmali tasdiq).
    // *Sent bayroqlari atomar belgilanadi — bir xabar ikki marta yuborilmaydi.
    reminderAt: { type: Date, default: null, index: true },
    reminderSent: { type: Boolean, default: false },
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

export default mongoose.model('Service', serviceSchema);
