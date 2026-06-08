// Moliyaviy tranzaksiya: daromad, xarajat yoki qarz to'lovi.
import mongoose from 'mongoose';
import { softDeleteFields } from './softDelete.js';

export const TX_TYPES = {
  INCOME: 'income',
  EXPENSE: 'expense',
  DEBT_PAYMENT: 'debt_payment',
};

// Xarajat kategoriyalari.
export const EXPENSE_CATEGORIES = ["yoqilg'i", "ta'mirlash", 'oziq-ovqat', 'boshqa'];

const transactionSchema = new mongoose.Schema(
  {
    type: { type: String, enum: Object.values(TX_TYPES), required: true, index: true },
    amount: { type: Number, required: true },

    // Faqat xarajatlar uchun.
    category: { type: String, default: null },

    // Daromad xizmatdan kelgan bo'lsa — bog'langan xizmat.
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null, index: true },
    // Qarz to'lovi yoki xizmatga bog'liq bo'lsa — mijoz.
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', default: null, index: true },

    paymentMethod: { type: String, default: null },
    note: { type: String, default: '' },
    date: { type: Date, default: Date.now, index: true },

    ...softDeleteFields,
  },
  { timestamps: true }
);

export default mongoose.model('Transaction', transactionSchema);
