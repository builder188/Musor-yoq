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

const reminderSchema = new mongoose.Schema(
  {
    minutesBefore: { type: Number, required: true },
    scheduledAt: { type: Date, required: true },
    sent: { type: Boolean, default: false },
    sentAt: { type: Date, default: null },
  },
  { _id: false }
);

const imageSchema = new mongoose.Schema(
  {
    url: { type: String },
    type: { type: String },
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
      coordinates: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
    },

    serviceDateTime: { type: Date, required: true, index: true },
    isHistorical: { type: Boolean, default: false },

    price: { type: Number, required: true },
    paymentMethod: { type: String, enum: PAYMENT_METHODS },
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
    completedAt: { type: Date, default: null },

    notes: { type: String },
    images: { type: [imageSchema], default: [] },
    reminders: { type: [reminderSchema], default: [] },

    incomeTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indekslar: clientId, status, serviceDateTime (yuqorida), isDeleted.
serviceSchema.index({ isDeleted: 1 });

export default mongoose.model('Service', serviceSchema);
