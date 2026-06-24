// Sozlamalar — har bir Telegram foydalanuvchi (egasi) uchun bitta hujjat.
import mongoose from 'mongoose';
import env, { ownerId } from '../config/env.js';

const settingsSchema = new mongoose.Schema(
  {
    telegramUserId: { type: String, unique: true, required: true },

    language: { type: String, enum: ['uz', 'ru'], default: 'uz' },
    theme: { type: String, enum: ['light', 'dark', 'auto'], default: 'auto' },
    deleteCode: { type: String, default: env.CONFIRM_DELETE_CODE || '1990' },

    // Eslatma/tasdiqlash xizmat vaqtiga NISBATAN:
    //  - reminderHoursBefore soat OLDIN — oddiy eslatma (tugmasiz).
    //  - confirmHoursAfter soat KEYIN — tasdiqlash so'rovi (tugmali).
    reminderHoursBefore: { type: Number, default: 3, min: 1, max: 168 },
    confirmHoursAfter: { type: Number, default: 3, min: 1, max: 168 },
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
