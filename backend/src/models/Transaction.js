// Moliyaviy tranzaksiya: daromad yoki xarajat.
// Qarz to'lovlari alohida kolleksiyada: DebtPayment (debt_payments).
import mongoose from 'mongoose';

export const TX_TYPES = {
  INCOME: 'income',
  EXPENSE: 'expense',
};

// Xarajat kategoriyalari.
export const EXPENSE_CATEGORIES = ["yoqilg'i", "ta'mirlash", 'oziq-ovqat', 'boshqa'];

const transactionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(TX_TYPES), required: true },
    amount: { type: Number, required: true },

    // Faqat xarajatlar uchun.
    category: { type: String, default: null },

    // Daromad xizmatdan kelgan bo'lsa — bog'langan xizmat.
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
    // Xizmatga bog'liq bo'lsa — mijoz (denormalizatsiya, qulaylik uchun).
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null },

    paymentMethod: { type: String, default: null },
    note: { type: String, default: '' },
    date: { type: Date, default: Date.now },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indekslar: type, date, serviceId, isDeleted.
transactionSchema.index({ type: 1 });
transactionSchema.index({ date: -1 });
transactionSchema.index({ serviceId: 1 });
transactionSchema.index({ isDeleted: 1 });

export default mongoose.model('Transaction', transactionSchema);
