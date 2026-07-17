// Material kategoriyalari — foydalanuvchi yaratgan yoki sotuvda birinchi marta uchragan
// material turlari (Paxta, Taxta dan tashqari yangi: "chyorniy taxta" va h.k.). 10 ta asosiy
// kategoriya konstanta (materialService.DEFAULT_MATERIALS) — ular bu yerda saqlanmaydi.
// Bu model faqat QO'SHIMCHA (default bo'lmagan) kategoriyalarni saqlaydi, shunda bo'sh
// (hali sotilmagan) kategoriya ham Mini App ro'yxatida ko'rinadi.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';
import { softDeleteFields } from './softDelete.js';
import { activeSheetIdFor, maybeArchiveFullSheet } from '../services/sheetService.js';

const materialCategorySchema = new mongoose.Schema(
  {
    // Ko'p-jadval (sheets): kategoriya qatori qaysi jadvalga (tab) tegishli.
    sheetId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    name: { type: String, required: true, trim: true },
    normalizedName: { type: String, required: true, index: true },
    // 'bot' (sotuvda avtomatik) yoki 'miniapp' (qo'lda yaratilgan).
    source: { type: String, enum: ['bot', 'miniapp'], default: 'miniapp' },
    ...softDeleteFields,
  },
  { timestamps: true }
);

materialCategorySchema.plugin(tenantScopePlugin);
materialCategorySchema.index({ telegramUserId: 1, normalizedName: 1 });

// Sheets: yangi kategoriya 'categories' scope faol jadvaliga shtamplanadi; to'lsa avto-arxiv.
materialCategorySchema.pre('validate', async function stampSheet() {
  if (this.isNew && !this.sheetId) {
    try {
      this.sheetId = await activeSheetIdFor('categories', this.telegramUserId);
    } catch (err) {
      console.warn('Kategoriya sheet shtampida xato:', err.message);
    }
  }
});
materialCategorySchema.post('save', function checkSheetFull(doc) {
  maybeArchiveFullSheet('categories', doc.telegramUserId).catch((err) =>
    console.warn('Sheets avto-arxiv xatosi (categories):', err.message)
  );
});

export default mongoose.model('MaterialCategory', materialCategorySchema);
