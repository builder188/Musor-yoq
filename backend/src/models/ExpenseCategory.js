// Xarajat kategoriyalari — DINAMIK: egasi qanday atasa shunday saqlanadi ("Benzin",
// "Svalka", "Oylik", ...). Asosiy kategoriyalar (Yoqilg'i, Ta'mirlash, Oziq-ovqat, Svalka)
// konstanta sifatida doim mavjud (categoryService.DEFAULT_EXPENSE_CATEGORIES) — ular bu
// yerda saqlanmaydi. Bot yoki Mini App'da yangi nom uchrasa avtomatik yaratiladi
// (ensureExpenseCategory) va egaga xabar beriladi. MaterialCategory bilan bir xil naqsh.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';
import { softDeleteFields } from './softDelete.js';
import { activeSheetIdFor, maybeArchiveFullSheet } from '../services/sheetService.js';

const expenseCategorySchema = new mongoose.Schema(
  {
    // Ko'p-jadval (sheets): kategoriya qatori qaysi jadvalga (tab) tegishli.
    sheetId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
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

// Sheets: yangi kategoriya 'categories' scope faol jadvaliga shtamplanadi; to'lsa avto-arxiv.
expenseCategorySchema.pre('validate', async function stampSheet() {
  if (this.isNew && !this.sheetId) {
    try {
      this.sheetId = await activeSheetIdFor('categories', this.telegramUserId);
    } catch (err) {
      console.warn('Kategoriya sheet shtampida xato:', err.message);
    }
  }
});
expenseCategorySchema.post('save', function checkSheetFull(doc) {
  maybeArchiveFullSheet('categories', doc.telegramUserId).catch((err) =>
    console.warn('Sheets avto-arxiv xatosi (categories):', err.message)
  );
});

export default mongoose.model('ExpenseCategory', expenseCategorySchema);
