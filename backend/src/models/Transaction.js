// Moliyaviy tranzaksiya: daromad yoki xarajat.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';
import { activeSheetIdFor, maybeArchiveFullSheet } from '../services/sheetService.js';

export const TX_TYPES = {
  INCOME: 'income',
  EXPENSE: 'expense',
};

// Kirim toifalari: xizmat (mijoz ishi), material (musordan chiqqan xom-ashyo sotuvi),
// buyum (kerakli buyum sotuvi), boshqa_kirim (toifasiz daromad) va dinamik erkin nomlar
// ("Ijara", "Bonus", ...).
// 'qarz' — egasi bergan/olgan shaxsiy qarz (Reminder bilan bog'liq). Ham chiqim (berdim),
// ham kirim (oldim) tomonida bo'lishi mumkin; qaytarilganda tranzaksiya soft-delete qilinadi.
// Kirim va xarajat toifalari endi DINAMIK: quyidagi ro'yxatlar legacy/tizim slug'lari xolos —
// yangi nomlar erkin string bo'lib saqlanadi. Nomlar IncomeCategory/ExpenseCategory modelida
// ro'yxatga olinadi, shu sabab schema'da enum YO'Q.
export const TX_CATEGORIES = ['xizmat', 'material', 'buyum', 'boshqa_kirim', 'yoqilgi', 'tamirlash', 'oziq-ovqat', 'svalka', 'jarima', 'boshqa_chiqim', 'qarz'];
export const INCOME_CATEGORIES = ['xizmat', 'material', 'buyum', 'boshqa_kirim'];
export const EXPENSE_CATEGORIES = ['yoqilgi', 'tamirlash', 'oziq-ovqat', 'svalka', 'jarima', 'boshqa_chiqim'];
// Moshina jarimasi toifasi — jarima to'lovi chiqimi (fineService bilan bog'liq).
export const FINE_CATEGORY = 'jarima';
export const OTHER_EXPENSE_CATEGORY = 'boshqa_chiqim';
export const OTHER_INCOME_CATEGORY = 'boshqa_kirim';
// Material sotuvi toifasi — daromad, lekin alohida kategoriya statistikasi bor.
export const MATERIAL_CATEGORY = 'material';
export const USEFUL_ITEM_CATEGORY = 'buyum';

const transactionSchema = new mongoose.Schema(
  {
    // Ko'p-jadval (sheets): kirim → 'income' scope faol jadvali, chiqim → 'expense'.
    // Hisobot/balans/qidiruv sheetId'ga QARAMAYDI — barcha jadvallar birga hisoblanadi.
    sheetId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    type: { type: String, enum: Object.values(TX_TYPES), required: true },
    amount: { type: Number, required: true, min: 0 }, // YAKUNIY summa — DOIM so'mda.
    // Asl valyuta (dollarda aytilgan bo'lsa) — faqat eslab qolish uchun; balansda so'm ishlatiladi.
    originalAmount: { type: Number, default: null },
    originalCurrency: { type: String, default: null },
    exchangeRateUsed: { type: Number, default: null },

    // Enum emas — xarajat toifasi dinamik nom bo'lishi mumkin (yuqoridagi izoh).
    category: { type: String, default: null },
    description: { type: String, default: '' },

    // Material sotuvi (category='material') uchun: aniq material nomi (Paxta, Mis, "chyorniy
    // taxta" ...), miqdori (kg) va kilo narxi. Boshqa tranzaksiyalarda null bo'ladi.
    // Kategoriya statistikasi shu materialName bo'yicha guruhlanadi.
    materialName: { type: String, default: null },
    quantityKg: { type: Number, default: null, min: 0 },
    pricePerKg: { type: Number, default: null, min: 0 },

    // Ovozli xabar orqali kiritilgan bo'lsa — asl ovoz (Mini App'da qayta eshitish uchun)
    // va uning matni. HAR QANDAY tranzaksiya (material, xarajat, kirim) ovozli kiritilsa,
    // o'sha ovoz tegishli kategoriya yozuviga biriktiriladi.
    voice: {
      type: new mongoose.Schema(
        {
          telegramFileId: { type: String, default: null },
          mimeType: { type: String, default: null },
          duration: { type: Number, default: null },
          messageId: { type: Number, default: null },
        },
        { _id: false }
      ),
      default: null,
    },
    sourceText: { type: String, default: '' },

    // Kerakli buyum sotuvi (category='buyum') uchun.
    itemName: { type: String, default: null },
    usefulItemId: { type: mongoose.Schema.Types.ObjectId, ref: 'UsefulItem', default: null },

    // Daromad xizmatdan kelgan bo'lsa - bog'langan xizmat.
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', default: null },
    date: { type: Date, required: true, default: Date.now },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Multi-tenant: telegramUserId maydoni + avtomatik scope.
transactionSchema.plugin(tenantScopePlugin);

// Indekslar: type, date, serviceId, isDeleted.
transactionSchema.index({ type: 1 });
transactionSchema.index({ serviceId: 1 });
transactionSchema.index({ isDeleted: 1 });
// Eng ko'p ishlatiladigan filtr/aggregatsiya: ega + sana oralig'i.
transactionSchema.index({ telegramUserId: 1, date: -1 });

// Sheets: yangi tranzaksiya turiga qarab (kirim/chiqim) FAOL jadvalga shtamplanadi.
transactionSchema.pre('validate', async function stampSheet() {
  if (this.isNew && !this.sheetId) {
    try {
      this.sheetId = await activeSheetIdFor(this.type === TX_TYPES.INCOME ? 'income' : 'expense', this.telegramUserId);
    } catch (err) {
      console.warn('Transaction sheet shtampida xato:', err.message);
    }
  }
});
transactionSchema.post('save', function checkSheetFull(doc) {
  const scope = doc.type === TX_TYPES.INCOME ? 'income' : 'expense';
  maybeArchiveFullSheet(scope, doc.telegramUserId).catch((err) =>
    console.warn(`Sheets avto-arxiv xatosi (${scope}):`, err.message)
  );
});

export default mongoose.model('Transaction', transactionSchema);
