// Qarz to'lovi — mijozdan olingan to'liq yoki qisman to'lov.
// Alohida kolleksiya: debt_payments.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';

const debtPaymentSchema = new mongoose.Schema(
  {
    clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
    // Tezkorlik uchun nusxa (denormalizatsiya).
    clientName: { type: String },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },

    amount: { type: Number, required: true },
    note: { type: String },
    date: { type: Date, required: true },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Multi-tenant: telegramUserId maydoni + avtomatik scope.
debtPaymentSchema.plugin(tenantScopePlugin);

// Indekslar: clientId, date.
debtPaymentSchema.index({ clientId: 1 });
debtPaymentSchema.index({ telegramUserId: 1, date: -1 });

// Kolleksiya nomi aynan 'debt_payments' bo'lishi uchun uchinchi argument.
export default mongoose.model('DebtPayment', debtPaymentSchema, 'debt_payments');
