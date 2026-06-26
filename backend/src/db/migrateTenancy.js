// Bir martalik (idempotent) migratsiya: eski bitta-egali ma'lumotlarni multi-tenantga
// ko'chiradi. telegramUserId'siz qolgan har bir yozuvga eski/asosiy egani yozadi.
//
// IDEMPOTENT — faqat telegramUserId yetishmagan yozuvlarga tegadi, shuning uchun startupda
// har safar xavfsiz ishlaydi (birinchi safardan keyin no-op). Qo'lda "bir marta ishlatib
// keyin o'chirish" o'rniga shunday qildik: hech narsa unutilmaydi, qayta deploy ham xavfsiz.
import Client from '../models/Client.js';
import Service from '../models/Service.js';
import Transaction from '../models/Transaction.js';
import DebtPayment from '../models/DebtPayment.js';
import { runGlobal } from './tenantScope.js';
import { legacyOwnerId } from '../config/env.js';

const TARGETS = [
  ['clients', Client],
  ['services', Service],
  ['transactions', Transaction],
  ['debt_payments', DebtPayment],
];

export async function migrateTenancy() {
  const legacy = legacyOwnerId();
  if (!legacy) {
    console.warn('[MIGRATION] Asosiy egasi IDsi topilmadi — tenant backfill o\'tkazib yuborildi.');
    return 0;
  }
  const owner = String(legacy);

  return runGlobal(async () => {
    let total = 0;
    for (const [label, Model] of TARGETS) {
      // telegramUserId umuman yo'q, yoki null/'' bo'lib qolganlar.
      const res = await Model.updateMany(
        { $or: [{ telegramUserId: { $exists: false } }, { telegramUserId: null }, { telegramUserId: '' }] },
        { $set: { telegramUserId: owner } }
      );
      const n = res.modifiedCount || 0;
      if (n) console.log(`[MIGRATION] ${label}: ${n} ta eski yozuv ${owner} egasiga biriktirildi`);
      total += n;
    }
    if (total) console.log(`[MIGRATION] Jami ${total} ta yozuv ko'chirildi (asosiy egasi: ${owner}).`);
    else console.log('[MIGRATION] Backfill shart emas — barcha yozuvlarda telegramUserId bor.');
    return total;
  });
}

export default migrateTenancy;
