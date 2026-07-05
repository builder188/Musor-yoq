// Xarajat kategoriyalari — DINAMIK: egasi qanday atasa shunday saqlanadi ("Benzin",
// "Svalka", "Oylik", ...). Asosiy kategoriyalar (Yoqilg'i, Ta'mirlash, Oziq-ovqat, Svalka)
// konstanta sifatida doim mavjud (categoryService.DEFAULT_EXPENSE_CATEGORIES) — ular bu
// yerda saqlanmaydi. Bot yoki Mini App'da yangi nom uchrasa avtomatik yaratiladi
// (ensureExpenseCategory) va egaga xabar beriladi. MaterialCategory bilan bir xil naqsh.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';
import { softDeleteFields } from './softDelete.js';

const expenseCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, index: true },
    // 'bot' (xarajat kiritishda avtomatik) yoki 'miniapp' (qo'lda yaratilgan).
    source: { type: String, enum: ['bot', 'miniapp'], default: 'bot' },
    ...softDeleteFields,
  },
  { timestamps: true }
);

expenseCategorySchema.plugin(tenantScopePlugin);
expenseCategorySchema.index({ telegramUserId: 1, normalizedName: 1 });

export default mongoose.model('ExpenseCategory', expenseCategorySchema);
