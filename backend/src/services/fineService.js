// Moshina jarimasi (shtraf) xizmati — bot va Mini App umumiy ishlatadi.
// Yagona joy: jarima yozish, to'lash (balansdan ayirish) va oylik statistika.
//
// MANTIQ (balans mexanikasi qarzdan FARQ qiladi):
//  - Jarima YARATILGANDA balansga tegilmaydi (qarzda darhol tegardi).
//  - "To'ladim" bo'lganda chiqim Transaction (category='jarima') yaratiladi va
//    reminder.transactionId ga bog'lanadi — balans SHU payt kamayadi.
//  - dueDate (kelajak to'lov vaqti) aytilsa — o'sha ANIQ vaqtda BIR MARTA eslatma
//    (remindAt = dueDate, oldindan ogohlantirish YO'Q). Aytilmasa remindAt=null —
//    cron hech qachon olmaydi, yozuv "to'lanmagan jarima" bo'lib turadi.
//  - paidNow (darhol to'landi) bo'lsa: status=done, summa bo'lsa chiqim darhol yoziladi,
//    eslatma yaratilmaydi.
import mongoose from 'mongoose';
import Reminder, { REMINDER_STATUS, REMINDER_TYPE } from '../models/Reminder.js';
import Transaction, { TX_TYPES, FINE_CATEGORY } from '../models/Transaction.js';
import { getSummary } from './financeService.js';
import { parseMoney } from '../utils/money.js';

const notDeleted = { isDeleted: { $ne: true } };

export const FINE_TEXT = 'Moshina jarimasi';

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function serialize(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return JSON.parse(JSON.stringify(obj));
}

function parseOptionalAmount(value) {
  const amount = parseMoney(value);
  return typeof amount === 'number' && amount > 0 ? amount : 0;
}

function toDate(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

// Jarima to'lovi chiqimi — balans shu tranzaksiya orqali kamayadi.
async function createFinePaymentTransaction({ amount, paidAt, note }) {
  return Transaction.create({
    type: TX_TYPES.EXPENSE,
    amount,
    category: FINE_CATEGORY,
    description: note ? `${FINE_TEXT}: ${note}` : FINE_TEXT,
    date: paidAt ? new Date(paidAt) : new Date(),
  });
}

// Yangi jarima yozuvi. HECH QAYSI maydon majburiy emas — "Shtrafga tushdim"ning o'zi yetarli.
//  - eventDate: jarima OLINGAN sana (doim yoziladi; aytilmasa bugun).
//  - dueDate:   KELAJAK to'lov vaqti — o'sha aniq vaqtda bir marta eslatma.
//  - paidNow:   xuddi shu xabarda to'langani aytildi — darhol chiqim, eslatmasiz.
export async function createFine(data = {}) {
  const amount = parseOptionalAmount(data.amount);
  const paidNow = data.paidNow === true;
  const eventDate = toDate(data.eventDate) || toDate(data.date) || new Date();
  // To'langan jarimaga eslatma kerak emas; o'tib ketgan sana ham eslatma bo'lmaydi
  // (o'tmish uchun cron baribir darhol yuborib yuborardi — bu foydasiz shovqin).
  let dueDate = paidNow ? null : toDate(data.dueDate);
  if (dueDate && dueDate.getTime() <= Date.now()) dueDate = null;
  const note = String(data.note || data.description || '').trim();

  let transactionId = null;
  let paidAt = null;
  if (paidNow && amount > 0) {
    // To'lov darhol bo'ldi — pul jarima kunida ketgan (EVENT DATE qoidasi).
    const tx = await createFinePaymentTransaction({ amount, paidAt: eventDate, note });
    transactionId = tx._id;
    paidAt = new Date();
  }

  const reminder = await Reminder.create({
    type: REMINDER_TYPE.FINE,
    person: '',
    text: FINE_TEXT,
    note,
    amount,
    // Balansga ta'sir faqat to'lov tranzaksiyasi orqali (transactionId) — affectsBalance
    // qarz semantikasida "yaratilganda tegdi" degani, jarimada DOIM false.
    affectsBalance: false,
    transactionId,
    eventDate,
    dueDate,
    // MUHIM: remindAt = dueDate AYNAN o'zi (computeRemindAt'siz) — egasi aytgan aniq
    // vaqtda, oldindan ogohlantirishsiz, bir marta.
    remindAt: dueDate,
    remindSent: false,
    status: paidNow ? REMINDER_STATUS.DONE : REMINDER_STATUS.PENDING,
    doneAt: paidAt,
    source: data.source === 'miniapp' ? 'miniapp' : 'bot',
  });

  const summary = await getSummary('all');
  return {
    reminder: serialize(reminder),
    paidNow,
    paidRecorded: Boolean(transactionId),
    balanceAfter: summary.balance,
  };
}

// To'lash mumkin bo'lgan (hali chiqimi yozilmagan) eng so'nggi jarima:
// pending yozuv YOKI "to'ladim" deyilgan-u summasi noma'lum qolgani (done, tx yo'q).
export async function findPayableFine() {
  return Reminder.findOne({
    ...notDeleted,
    type: REMINDER_TYPE.FINE,
    transactionId: null,
    status: { $in: [REMINDER_STATUS.PENDING, REMINDER_STATUS.DONE] },
  })
    .sort({ eventDate: -1, createdAt: -1 })
    .exec();
}

export async function getFineById(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Reminder.findOne({ _id: id, ...notDeleted, type: REMINDER_TYPE.FINE }).exec();
}

// Jarimani to'landi deb belgilaydi: chiqim Transaction yaratiladi (balans kamayadi).
// amount berilsa — yozuvdagi summa ham yangilanadi; berilmasa yozuvdagi summa ishlatiladi.
// Summa umuman yo'q bo'lsa xato — chaqiruvchi (bot/Mini App) avval summani so'raydi.
export async function payFine(id, { amount } = {}) {
  const reminder = await Reminder.findOne({ _id: id, ...notDeleted, type: REMINDER_TYPE.FINE });
  if (!reminder) throw badRequest('Jarima yozuvi topilmadi.');
  if (reminder.transactionId) throw badRequest("Bu jarima allaqachon to'langan.");

  const paidAmount = parseOptionalAmount(amount) || reminder.amount;
  if (!(paidAmount > 0)) throw badRequest("Jarima summasini ayting oka (masalan: 150 ming).");

  const tx = await createFinePaymentTransaction({
    amount: paidAmount,
    paidAt: new Date(),
    note: reminder.note,
  });

  reminder.amount = paidAmount;
  reminder.transactionId = tx._id;
  reminder.status = REMINDER_STATUS.DONE;
  reminder.doneAt = new Date();
  await reminder.save();

  const summary = await getSummary('all');
  return { reminder: serialize(reminder), balanceAfter: summary.balance, paidAmount };
}

// Oylik jarima statistikasi (hisobotlar uchun): davr ichida
//  - count: nechta jarima OLINGAN (eventDate bo'yicha, bekor qilinganlar kirmaydi)
//  - paidTotal / paidCount: jami QANCHA to'langan (jarima chiqim tranzaksiyalari bo'yicha)
//  - unpaidCount: hali to'lanmagan jarimalar soni (davr ichida olinganlardan)
export async function getFineStats({ from, to } = {}) {
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) range.$lte = new Date(to);
  const eventFilter = {
    ...notDeleted,
    type: REMINDER_TYPE.FINE,
    status: { $ne: REMINDER_STATUS.CANCELLED },
  };
  if (range.$gte || range.$lte) eventFilter.eventDate = range;

  const txFilter = {
    ...notDeleted,
    type: TX_TYPES.EXPENSE,
    category: FINE_CATEGORY,
  };
  if (range.$gte || range.$lte) txFilter.date = range;

  const [fines, txAgg] = await Promise.all([
    Reminder.find(eventFilter).select('transactionId').lean(),
    Transaction.aggregate([
      { $match: txFilter },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);

  const paid = txAgg[0] || { total: 0, count: 0 };
  return {
    count: fines.length,
    unpaidCount: fines.filter((f) => !f.transactionId).length,
    paidTotal: paid.total || 0,
    paidCount: paid.count || 0,
  };
}

// Oylik jarima qatorlari (PDF/Excel hisobot bo'limi): har oy uchun
// nechta jarimaga tushilgan (eventDate) va jami qancha to'langan (to'lov tranzaksiyalari).
// Ikkala o'lchov ham o'z oyiga yoziladi — jarima bir oyda olinib keyingi oyda to'lansa,
// soni olingan oyda, to'lovi to'langan oyda ko'rinadi.
export async function getMonthlyFineRows({ from, to } = {}) {
  const range = {};
  if (from) range.$gte = new Date(from);
  if (to) range.$lte = new Date(to);

  const eventFilter = {
    ...notDeleted,
    type: REMINDER_TYPE.FINE,
    status: { $ne: REMINDER_STATUS.CANCELLED },
  };
  if (range.$gte || range.$lte) eventFilter.eventDate = range;
  const txFilter = { ...notDeleted, type: TX_TYPES.EXPENSE, category: FINE_CATEGORY };
  if (range.$gte || range.$lte) txFilter.date = range;

  const [fineAgg, paidAgg] = await Promise.all([
    Reminder.aggregate([
      { $match: eventFilter },
      {
        $group: {
          _id: { year: { $year: '$eventDate' }, month: { $month: '$eventDate' } },
          count: { $sum: 1 },
          unpaid: { $sum: { $cond: [{ $ifNull: ['$transactionId', false] }, 0, 1] } },
        },
      },
    ]),
    Transaction.aggregate([
      { $match: txFilter },
      {
        $group: {
          _id: { year: { $year: '$date' }, month: { $month: '$date' } },
          paidTotal: { $sum: '$amount' },
          paidCount: { $sum: 1 },
        },
      },
    ]),
  ]);

  const byMonth = new Map();
  const ensure = (year, month) => {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!byMonth.has(key)) byMonth.set(key, { year, month, count: 0, unpaid: 0, paidTotal: 0, paidCount: 0 });
    return byMonth.get(key);
  };
  for (const row of fineAgg) {
    const item = ensure(row._id.year, row._id.month);
    item.count = row.count;
    item.unpaid = row.unpaid;
  }
  for (const row of paidAgg) {
    const item = ensure(row._id.year, row._id.month);
    item.paidTotal = row.paidTotal;
    item.paidCount = row.paidCount;
  }

  return Array.from(byMonth.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([, row]) => row);
}

export default {
  FINE_TEXT,
  createFine,
  payFine,
  findPayableFine,
  getFineById,
  getFineStats,
  getMonthlyFineRows,
};
