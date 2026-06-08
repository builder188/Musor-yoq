// Sozlamalar — yagona (singleton) hujjat.
import mongoose from 'mongoose';
import env, { ownerId } from '../config/env.js';

const settingsSchema = new mongoose.Schema(
  {
    // Singletonni belgilash uchun doimiy kalit.
    key: { type: String, default: 'global', unique: true },

    language: { type: String, enum: ['uz', 'ru'], default: 'uz' },
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },

    // Eslatma ofsetlari (daqiqada, xizmatdan oldin). Standart: 1 kun, 1 soat, aniq vaqt.
    reminderOffsetsMinutes: { type: [Number], default: [1440, 60, 0] },

    timezone: { type: String, default: env.TZ },
    ownerTelegramId: { type: Number, default: () => ownerId() },
  },
  { timestamps: true }
);

// Sozlamalarni olish (bo'lmasa — yaratish).
settingsSchema.statics.getSingleton = async function getSingleton() {
  let doc = await this.findOne({ key: 'global' });
  if (!doc) {
    doc = await this.create({ key: 'global' });
  }
  return doc;
};

export default mongoose.model('Settings', settingsSchema);
