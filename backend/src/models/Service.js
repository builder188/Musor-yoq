// Xizmat (musor olib ketish ishi) modeli.
import mongoose from 'mongoose';
import { tenantScopePlugin } from '../db/tenantScope.js';
import { activeSheetIdFor, maybeArchiveFullSheet } from '../services/sheetService.js';

export const SERVICE_STATUS = {
  PENDING: 'kutilmoqda',
  DONE: 'bajarildi',
  // Vaqti keldi, lekin amalga oshmadi (mas. mashina buzildi). Bekor emas — keyin sana
  // tahrirlanib qayta rejalashtirilishi mumkin. Balansga ta'sir qilmaydi.
  NOT_DONE: 'bajarilmadi',
  CANCELLED: 'bekor_qilindi',
};

// Balansga daromad yozilMAYdigan holatlar (bajarilmadi ham bekor kabi — pul yo'q).
export const NO_INCOME_STATUSES = [SERVICE_STATUS.NOT_DONE, SERVICE_STATUS.CANCELLED];

export const PAYMENT_METHODS = ['naqd', 'karta', 'otkazma'];

export const PAYMENT_STATUS = {
  UNPAID: 'tolanmagan',
  PAID: 'tolangan',
  PARTIAL: 'qisman',
};

const imageSchema = new mongoose.Schema(
  {
    telegramFileId: { type: String },
  },
  { _id: false }
);

const serviceSchema = new mongoose.Schema(
  {
    // Ko'p-jadval (sheets): qator qaysi jadvalga (tab) tegishli. Yangi qator FAOL jadvalga
    // tushadi; qidiruv/hisobotlar sheetId'ga QARAMAYDI (barcha jadvallar birga).
    sheetId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },

    // Mijoz ma'lumoti FAQAT shu qatorning o'zida saqlanadi — alohida Client kolleksiyasi YO'Q.
    // Bir mijozning qatorlari telefon (bo'lmasa ism) bo'yicha guruhlanadi.
    clientName: { type: String },
    clientPhone: { type: String },
    // Hamkor (shartnomaviy) mijoz qatori: "X ga bordim" deganda standart narx/manzil
    // shu telefon/ismga tegishli ENG OXIRGI qatordan olinadi.
    isPartner: { type: Boolean, default: false },

    // Manzil ixtiyoriy: aytilmagan bo'lsa address bo'sh qoladi.
    location: {
      address: { type: String, default: '' },
      mapUrl: { type: String, default: null },
      coordinates: {
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },
      },
    },

    // Sana ixtiyoriy: aytilmagan bo'lsa null (eslatma/tasdiq jadvali qo'yilmaydi).
    serviceDateTime: { type: Date, default: null, index: true },
    isHistorical: { type: Boolean, default: false },

    // 0 = narx hali aytilmagan (balansga ta'sir qilmaydi). Musbat qiymat — DOIM so'mda.
    price: { type: Number, default: 0, min: 0 }, // YAKUNIY summa (balans/hisobot shu).
    // Asl valyuta (dollarda kelishilган bo'lsa) — faqat eslab qolish uchun; balansda ishlatilmaydi.
    originalAmount: { type: Number, default: null }, // mas. 100
    originalCurrency: { type: String, default: null }, // mas. 'USD'
    exchangeRateUsed: { type: Number, default: null }, // mas. 12052 (1$ = ... so'm)
    // To'lov usuli endi bot oqimida so'ralmaydi (egasi uchun ahamiyatsiz). Default 'naqd';
    // Mini App'dan istalgan vaqtda o'zgartirilishi mumkin.
    paymentMethod: { type: String, enum: PAYMENT_METHODS, default: 'naqd' },
    paymentStatus: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      default: PAYMENT_STATUS.UNPAID,
    },
    paidAmount: { type: Number, default: 0 },

    status: {
      type: String,
      enum: Object.values(SERVICE_STATUS),
      default: SERVICE_STATUS.PENDING,
      index: true,
    },
    cancellationReason: { type: String, default: null },
    completedAt: { type: Date, default: null },

    // Xizmat vaqtiga nisbatan eslatma/tasdiqlash jadvali (cron shu yerga qaraydi).
    //  - reminderAt: serviceDateTime - reminderHoursBefore (oldindan eslatma).
    //  - startReminderSent: xizmat VAQTIDA ("hozir borish vaqti") eslatma yuborilganmi.
    //    Vaqti serviceDateTime ga teng, shuning uchun alohida sana saqlanmaydi.
    //  - confirmAt:  serviceDateTime + confirmHoursAfter (tugmali tasdiq).
    // *Sent bayroqlari atomar belgilanadi — bir xabar ikki marta yuborilmaydi.
    reminderAt: { type: Date, default: null, index: true },
    reminderSent: { type: Boolean, default: false },
    startReminderSent: { type: Boolean, default: false },
    confirmAt: { type: Date, default: null, index: true },
    confirmSent: { type: Boolean, default: false },

    notes: { type: String },
    images: { type: [imageSchema], default: [] },

    incomeTransactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    // Egasi bu xizmatning daromadini QASDDAN o'chirgan (1990-kod bilan yoki bulk delete).
    // ensureServiceIncome/repair bu bayroq turganda daromadni HECH QACHON qayta yaratmaydi —
    // aks holda purgeOld soft-deleted tranzaksiyani butunlay o'chirgach, "o'chirilgan income
    // bor" belgisi yo'qolib, repair uni qayta tiriltirardi (zombi daromad).
    incomeManuallyRemoved: { type: Boolean, default: false },
    // Legacy (Client kolleksiyasi davridan qolgan) — eski yozuvlar tiklanganda tozalanadi.
    isDeletedByClientDeletion: { type: Boolean, default: false },
    clientDeletionNote: { type: String, default: '' },

    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Indekslar: status, serviceDateTime (yuqorida), isDeleted.
serviceSchema.index({ isDeleted: 1 });
// Multi-tenant: telegramUserId maydoni + avtomatik scope (har bir query/aggregate/save).
serviceSchema.plugin(tenantScopePlugin);
// Eng ko'p ishlatiladigan filtrlar telegramUserId bilan birga keladi.
serviceSchema.index({ telegramUserId: 1, serviceDateTime: -1 });
serviceSchema.index({ telegramUserId: 1, status: 1 });
// Mijoz guruhlash (hisobot/standartlar) telefon bo'yicha ishlaydi.
serviceSchema.index({ telegramUserId: 1, clientPhone: 1 });

// Sheets: yangi qator FAOL jadvalga shtamplanadi (tenant plugin telegramUserId'ni
// pre('validate')da allaqachon yozgan — hook tartibi shuni kafolatlaydi).
serviceSchema.pre('validate', async function stampSheet() {
  if (this.isNew && !this.sheetId) {
    try {
      this.sheetId = await activeSheetIdFor('services', this.telegramUserId);
    } catch (err) {
      // Jadval aniqlanmasa ham yozuv YO'QOLMAYDI — sheetId'siz saqlanadi (hisobotlar baribir ko'radi).
      console.warn('Service sheet shtampida xato:', err.message);
    }
  }
});
// Saqlangandan keyin: faol jadval to'lgan bo'lsa avto-arxiv (fire-and-forget).
serviceSchema.post('save', function checkSheetFull(doc) {
  maybeArchiveFullSheet('services', doc.telegramUserId).catch((err) =>
    console.warn('Sheets avto-arxiv xatosi (services):', err.message)
  );
});

export default mongoose.model('Service', serviceSchema);
