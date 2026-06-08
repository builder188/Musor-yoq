// Bot suhbat holati — yetishmayotgan maydonlarni bittalab so'rash uchun.
// Har bir foydalanuvchi (egasi) uchun bitta yozuv.
import mongoose from 'mongoose';

const conversationSchema = new mongoose.Schema(
  {
    telegramId: { type: Number, required: true, unique: true, index: true },

    // Hozir to'planayotgan niyat: SERVICE_ENTRY, EXPENSE_ENTRY, ...
    pendingIntent: { type: String, default: null },

    // To'plangan maydonlar (intentga qarab).
    collected: { type: mongoose.Schema.Types.Mixed, default: {} },

    // Hali yetishmayotgan majburiy maydonlar (tartib bo'yicha).
    missingFields: { type: [String], default: [] },

    // Hozir qaysi maydon so'ralayotgani (foydalanuvchi javobini shu maydonga bog'lash uchun).
    awaitingField: { type: String, default: null },

    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Suhbatni tozalash (intent yakunlanganda yoki bekor qilinganda).
conversationSchema.methods.reset = function reset() {
  this.pendingIntent = null;
  this.collected = {};
  this.missingFields = [];
  this.awaitingField = null;
  return this.save();
};

export default mongoose.model('Conversation', conversationSchema);
