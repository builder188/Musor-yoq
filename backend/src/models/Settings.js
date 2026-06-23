// Sozlamalar — har bir Telegram foydalanuvchi (egasi) uchun bitta hujjat.
import mongoose from 'mongoose';
import env, { ownerId } from '../config/env.js';

const settingsSchema = new mongoose.Schema(
  {
    telegramUserId: { type: String, unique: true, required: true },

    language: { type: String, enum: ['uz', 'ru'], default: 'uz' },
    theme: { type: String, enum: ['light', 'dark', 'auto'], default: 'auto' },
    deleteCode: { type: String, default: env.CONFIRM_DELETE_CODE || '1990' },

    // Standart eslatma vaqtlari (xizmatdan necha daqiqa oldin).
    // Standart: 1 kun (1440), 1 soat (60) va aniq vaqtida (0).
    defaultReminders: {
      type: [{ minutesBefore: Number }],
      default: [{ minutesBefore: 1440 }, { minutesBefore: 60 }, { minutesBefore: 0 }],
    },
  },
  { timestamps: true }
);

// Egasining sozlamalarini olish (bo'lmasa — yaratish).
settingsSchema.statics.getSingleton = async function getSingleton(telegramId = ownerId()) {
  const telegramUserId = String(telegramId || ownerId());
  let doc = await this.findOne({ telegramUserId });
  if (!doc) {
    doc = await this.create({ telegramUserId });
  }
  return doc;
};

settingsSchema.virtual('confirmDeleteCode')
  .get(function getConfirmDeleteCode() {
    return this.deleteCode;
  })
  .set(function setConfirmDeleteCode(value) {
    this.deleteCode = value;
  });

export default mongoose.model('Settings', settingsSchema);
