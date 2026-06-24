// Mijoz modeli. Telefon raqami bo'yicha noyob (unique).
import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema(
  {
    address: { type: String, required: true },
    mapUrl: { type: String, default: null },
  },
  { _id: false }
);

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Normalizatsiya qilingan +998XXXXXXXXX. Noyoblik faqat aktiv mijozlar uchun
    // (pastdagi partial unique index). Soft-delete qilingan raqam qayta ishlatilishi mumkin.
    phone: { type: String, required: true },
    // Mijozning bir nechta manzillari (xizmatlardan avtomatik to'planadi).
    locations: { type: [locationSchema], default: [] },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
    isDeletedByClientDeletion: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// Indekslar:
//  - phone faqat aktiv (isDeleted:false) mijozlar orasida noyob (partial unique).
//    Bu soft-delete qilingan raqamni qayta ishlatishga imkon beradi.
//  - isDeleted tez filtrlash uchun.
clientSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
clientSchema.index({ isDeleted: 1 });

export default mongoose.model('Client', clientSchema);
