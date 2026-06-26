// Sozlamalar — har bir Telegram foydalanuvchi (egasi) uchun bitta hujjat.
// Diqqat: bu modelga tenantScopePlugin QO'YILMAYDI — u allaqachon telegramUserId
// kaliti bilan ishlaydi (har egada bitta hujjat), scope o'sha kalit orqali.
import mongoose from 'mongoose';
import env, { ownerId } from '../config/env.js';
import { currentUserId } from '../db/tenantScope.js';

const settingsSchema = new mongoose.Schema(
  {
    telegramUserId: { type: String, unique: true, required: true },

    language: { type: String, enum: ['uz', 'ru'], default: 'uz' },
    theme: { type: String, enum: ['light', 'dark', 'auto'], default: 'light' },
    deleteCode: { type: String, default: env.CONFIRM_DELETE_CODE || '1990' },

    // Eslatma/tasdiqlash xizmat vaqtiga NISBATAN:
    //  - reminderHoursBefore soat OLDIN — oddiy eslatma (tugmasiz).
    //  - confirmHoursAfter soat KEYIN — tasdiqlash so'rovi (tugmali).
    reminderHoursBefore: { type: Number, default: 3, min: 1, max: 168 },
    confirmHoursAfter: { type: Number, default: 3, min: 1, max: 168 },
  },
  { timestamps: true }
);

// Foydalanuvchi sozlamalarini olish (bo'lmasa — default bilan yaratish).
// telegramId berilmasa: joriy scoped foydalanuvchi (AsyncLocalStorage), u ham bo'lmasa
// asosiy egasi. Shu sabab reminderService/deleteService kabi no-arg chaqiruvlar ham
// avtomatik TO'G'RI egasining sozlamalarini oladi (multi-tenant).
settingsSchema.statics.getSingleton = async function getSingleton(telegramId) {
  const telegramUserId = String(telegramId || currentUserId() || ownerId());
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
