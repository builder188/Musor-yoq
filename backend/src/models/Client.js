// Mijoz modeli. Telefon raqami bo'yicha noyob (unique).
import mongoose from 'mongoose';

const locationSchema = new mongoose.Schema(
  {
    address: { type: String, default: '' },
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
    // Normalizatsiya qilingan +998XXXXXXXXX, noyob.
    phone: { type: String, required: true, unique: true },
    // Mijozning bir nechta manzillari (xizmatlardan avtomatik to'planadi).
    locations: { type: [locationSchema], default: [] },
    // Mijozning umumiy qarzi — doimo yangilanib turadi.
    totalDebt: { type: Number, default: 0 },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indekslar: phone (unique — yuqorida), isDeleted, totalDebt.
clientSchema.index({ isDeleted: 1 });
clientSchema.index({ totalDebt: -1 });

export default mongoose.model('Client', clientSchema);
