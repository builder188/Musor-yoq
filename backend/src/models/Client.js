// Mijoz modeli. Telefon raqami bo'yicha noyob (unique) — HAR EGA ICHIDA.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';

const locationSchema = new mongoose.Schema(
  {
    address: { type: String, required: true },
    mapUrl: { type: String, default: null },
    coordinates: {
      lat: { type: Number, default: null },
      lng: { type: Number, default: null },
    },
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

// Multi-tenant: telegramUserId maydoni + avtomatik scope.
clientSchema.plugin(tenantScopePlugin);

// Indekslar:
//  - phone HAR BIR EGA ICHIDA aktiv (isDeleted:false) mijozlar orasida noyob
//    (compound partial unique). 2 xil egada bir xil raqamli mijoz bo'lishi MUMKIN —
//    ular bog'liq emas. Soft-delete qilingan raqam qayta ishlatilishi mumkin.
//  - isDeleted tez filtrlash uchun.
clientSchema.index(
  { telegramUserId: 1, phone: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);
clientSchema.index({ isDeleted: 1 });

export default mongoose.model('Client', clientSchema);
