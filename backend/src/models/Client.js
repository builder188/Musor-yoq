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
    // Hamkor (shartnomaviy) mijozlar telefon RAQAMSIZ ham bo'lishi mumkin ('' saqlanadi) —
    // unique index faqat bo'sh bo'lmagan telefonlarga qo'llanadi.
    phone: { type: String, default: '' },
    // Mijozning bir nechta manzillari (xizmatlardan avtomatik to'planadi).
    locations: { type: [locationSchema], default: [] },

    // ── Hamkorlik (shartnomaviy mijoz) ─────────────────────────────────────
    // isPartner=true: doimiy hamkor. "X ga bordim/boraman" deganda standart narx
    // va manzil avtomatik ishlatiladi; tashrifda farqli qiymat aytilsa standart yangilanadi.
    isPartner: { type: Boolean, default: false },
    partnerPrice: { type: Number, default: 0, min: 0 }, // standart narx (so'mda), 0 = aytilmagan
    partnerLocation: { type: locationSchema, default: null }, // standart manzil
    partnerSince: { type: Date, default: null },

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
//  - Telefon BO'SH ('') mijozlar (hamkorlar) noyoblikka kirmaydi — $gt:'' filtri
//    bo'sh telefonli bir nechta mijozga ruxsat beradi (aks holda 2-hamkor duplicate key olardi).
//    connect.js dagi Client.syncIndexes() eski indeksni yangi variant bilan almashtiradi.
//  - isDeleted tez filtrlash uchun.
clientSchema.index(
  { telegramUserId: 1, phone: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, phone: { $exists: true, $gt: '' } } }
);
clientSchema.index({ isDeleted: 1 });

export default mongoose.model('Client', clientSchema);
