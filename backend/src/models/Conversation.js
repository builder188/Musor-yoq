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

    // Oxirgi "bajarildimi?" tasdiq so'rovi yuborilgan xizmat (cron belgilaydi).
    // Matn/ovoz bilan javob berilganda (tugmasiz) shu xizmatga tegishli deb olinadi.
    lastConfirmServiceId: { type: String, default: null },
    lastConfirmAt: { type: Date, default: null },

    // Oxirgi ~10 xabar (foydalanuvchi + bot) — Gemini'ga kontekst sifatida yuboriladi.
    // Qisqa javoblar ("ha", "naqd", "200 ming") oldingi savolga bog'liq bo'ladi.
    history: {
      type: [
        {
          _id: false,
          role: { type: String, enum: ['user', 'bot'] },
          text: { type: String },
          at: { type: Date, default: Date.now },
        },
      ],
      default: [],
    },

    updatedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Suhbatni tozalash (intent yakunlanganda yoki bekor qilinganda).
// Eslatma: history va lastConfirm* tozalanmaydi — ular slot-filling'dan mustaqil.
conversationSchema.methods.reset = function reset() {
  this.pendingIntent = null;
  this.collected = {};
  this.missingFields = [];
  this.awaitingField = null;
  return this.save();
};

// Suhbat tarixiga bitta xabar qo'shadi (atomar; oxirgi 10 ta saqlanadi).
// Boshqa maydonlarni (pendingIntent va h.k.) buzmaydi — $push/$slice.
const HISTORY_LIMIT = 10;
const HISTORY_TEXT_MAX = 600;
conversationSchema.statics.pushHistory = function pushHistory(telegramId, role, text) {
  const trimmed = String(text || '').trim().slice(0, HISTORY_TEXT_MAX);
  const id = Number(telegramId);
  if (!trimmed || !Number.isFinite(id)) return Promise.resolve(null);
  return this.updateOne(
    { telegramId: id },
    { $push: { history: { $each: [{ role, text: trimmed, at: new Date() }], $slice: -HISTORY_LIMIT } } },
    { upsert: true }
  ).catch(() => null);
};

export default mongoose.model('Conversation', conversationSchema);
