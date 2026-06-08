// Mijoz modeli. Telefon raqami bo'yicha noyob aniqlanadi.
import mongoose from 'mongoose';
import { softDeleteFields } from './softDelete.js';

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    // Normalizatsiya qilingan +998XXXXXXXXX ko'rinishida saqlanadi.
    phone: { type: String, required: true, trim: true, index: true },
    location: { type: String, default: '' },
    // Mijozning umumiy qarzi (so'mda).
    totalDebt: { type: Number, default: 0 },
    // Mijoz umrida to'lagan/xizmat qiymati jami (bajarilgan xizmatlar bo'yicha).
    totalSpent: { type: Number, default: 0 },
    notes: { type: String, default: '' },
    ...softDeleteFields,
  },
  { timestamps: true }
);

clientSchema.index({ name: 'text', phone: 'text', location: 'text' });

export default mongoose.model('Client', clientSchema);
