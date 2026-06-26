// Valyuta kursi keshi — GLOBAL singleton (barcha foydalanuvchilar uchun bir xil:
// bu Markaziy Bank kursi, shaxsiy ma'lumot emas). Shu sabab tenantScopePlugin
// QO'YILMAYDI — kurs har egada takrorlanmaydi, bitta hujjat hammaga xizmat qiladi.
import mongoose from 'mongoose';

const exchangeRateSchema = new mongoose.Schema(
  {
    // Singleton kaliti (hozircha faqat USD). Kelajakda boshqa valyuta qo'shilsa kengayadi.
    base: { type: String, default: 'USD', unique: true },
    usdToUzsRate: { type: Number, default: null },
    rateUpdatedAt: { type: Date, default: null },
    source: { type: String, default: null },
  },
  { timestamps: true }
);

export default mongoose.model('ExchangeRate', exchangeRateSchema, 'exchange_rate_cache');
