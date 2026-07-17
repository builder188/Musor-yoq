// Kirim kategoriyalari - dinamik: egasi qanday atasa shunday saqlanadi
// ("Ijara", "Bonus", "Metall savdosi", ...). Xizmat/material/buyum kabi tizim
// manbalari categoryService.SYSTEM_INCOME_CATEGORIES'da doim tanilgan.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';
import { softDeleteFields } from './softDelete.js';
import { activeSheetIdFor, maybeArchiveFullSheet } from '../services/sheetService.js';

const incomeCategorySchema = new mongoose.Schema(
  {
    // Ko'p-jadval (sheets): kategoriya qatori qaysi jadvalga (tab) tegishli.
    sheetId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
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

// Sheets: yangi kategoriya 'categories' scope faol jadvaliga shtamplanadi; to'lsa avto-arxiv.
incomeCategorySchema.pre('validate', async function stampSheet() {
  if (this.isNew && !this.sheetId) {
    try {
      this.sheetId = await activeSheetIdFor('categories', this.telegramUserId);
    } catch (err) {
      console.warn('Kategoriya sheet shtampida xato:', err.message);
    }
  }
});
incomeCategorySchema.post('save', function checkSheetFull(doc) {
  maybeArchiveFullSheet('categories', doc.telegramUserId).catch((err) =>
    console.warn('Sheets avto-arxiv xatosi (categories):', err.message)
  );
});

export default mongoose.model('IncomeCategory', incomeCategorySchema);
