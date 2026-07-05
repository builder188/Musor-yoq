// Kirim kategoriyalari - dinamik: egasi qanday atasa shunday saqlanadi
// ("Ijara", "Bonus", "Metall savdosi", ...). Xizmat/material/buyum kabi tizim
// manbalari categoryService.SYSTEM_INCOME_CATEGORIES'da doim tanilgan.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';
import { softDeleteFields } from './softDelete.js';

const incomeCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, index: true },
    // 'bot' (kirim kiritishda avtomatik) yoki 'miniapp' (kelajakda qo'lda yaratilsa).
    source: { type: String, enum: ['bot', 'miniapp'], default: 'bot' },
    ...softDeleteFields,
  },
  { timestamps: true }
);

incomeCategorySchema.plugin(tenantScopePlugin);
incomeCategorySchema.index({ telegramUserId: 1, normalizedName: 1 });

export default mongoose.model('IncomeCategory', incomeCategorySchema);
