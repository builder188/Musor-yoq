// Shaxsiy eslatma / qarz xizmati — bot va Mini App umumiy ishlatadi (takrorlamaymiz).
// Yagona joy: qarz eslatmasini yaratish, ro'yxat, hal qilish/bekor/snooze va balans mexanikasi.
import mongoose from 'mongoose';
import Reminder, { REMINDER_STATUS, REMINDER_TYPE, REMINDER_DIRECTION } from '../models/Reminder.js';
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import { getSummary } from './financeService.js';
import { parseMoney } from '../utils/money.js';

const notDeleted = { isDeleted: { $ne: true } };

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

function parsePositiveAmount(value) {
  const amount = parseMoney(value);
  return typeof amount === 'number' && amount > 0 ? amount : 0;
}

function toDate(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

// Eslatma yuborish vaqti: dueDate aniq vaqt bilan kelsa o'shani, faqat sana (00:00) bo'lsa
// o'sha kun ertalab 09:00 (Asia/Tashkent jarayon mintaqasi) — yarim tunda eslatmaslik uchun.
function computeRemindAt(dueDate) {
  const d = new Date(dueDate);
  if (d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0) {
    d.setHours(9, 0, 0, 0);
  }
  return d;
}

function directionOf(value) {
  return value === REMINDER_DIRECTION.TAKEN ? REMINDER_DIRECTION.TAKEN : REMINDER_DIRECTION.GIVEN;
}

function debtText({ direction, person, type }) {
  if (type === REMINDER_TYPE.GENERAL) return '';
  const who = person || 'kimdir';
  return direction === REMINDER_DIRECTION.TAKEN ? `${who}ga qarz (men oldim)` : `${who}dan qarz (men berdim)`;
}

// Balans tranzaksiyasini yaratadi (qarz berdim => chiqim, qarz oldim => kirim).
async function createBalanceTransaction({ direction, person, amount, eventDate, originalAmount, originalCurrency, exchangeRateUsed }) {
  const type = direction === REMINDER_DIRECTION.TAKEN ? TX_TYPES.INCOME : TX_TYPES.EXPENSE;
  const who = person || '-';
  const description = direction === REMINDER_DIRECTION.TAKEN ? `Qarz olindi: ${who}` : `Qarz berildi: ${who}`;
  return Transaction.create({
    type,
    amount,
    category: 'qarz',
    description,
    date: eventDate ? new Date(eventDate) : new Date(),
    originalAmount: originalAmount ?? null,
    originalCurrency: originalCurrency ?? null,
    exchangeRateUsed: exchangeRateUsed ?? null,
  });
}

// Bog'langan balans tranzaksiyasini soft-delete qiladi (qarz qaytdi/bekor — balans tiklanadi).
async function reverseBalanceTransaction(transactionId) {
  if (!transactionId) return;
  await Transaction.updateOne(
    { _id: transactionId, ...notDeleted },
    { $set: { isDeleted: true, deletedAt: new Date() } }
  ).catch(() => null);
}

// Yangi qarz eslatmasi. affectsBalance=true (default) bo'lsa summa balansdan ayiriladi/qo'shiladi.
// Faqat person (kim) majburiy — summa/sana aytilmagan bo'lsa bo'sh qoladi: summasiz qarz
// balansga tegmaydi, sanasiz qarz eslatma yubormaydi (keyin tahrir/Mini App to'ldiradi).
export async function createDebtReminder(data = {}) {
  const type = data.type === REMINDER_TYPE.GENERAL ? REMINDER_TYPE.GENERAL : REMINDER_TYPE.DEBT;
  const direction = directionOf(data.direction);
  const person = String(data.person || '').replace(/\s+/g, ' ').trim();
  const amount = parsePositiveAmount(data.amount);

  const dueDate = toDate(data.dueDate);

  if (type === REMINDER_TYPE.DEBT && !person) throw badRequest("Kimga/kimdan qarz ekanini ayting oka.");

  // Egasi aniq "balansga tegma" degan bo'lsa — bu niyat yozuvning o'zida saqlanadi
  // (keyingi tahrirlar transactionId yo'qligidan xato xulosa chiqarmasin).
  const skipBalance = data.affectsBalance === false;
  // Balansga ta'sir faqat summa bo'lsa mantiqiy. skipBalance true bo'lsa — tegmaymiz.
  const affectsBalance = type === REMINDER_TYPE.DEBT && amount > 0 && !skipBalance;
  const eventDate = toDate(data.eventDate) || new Date();

  let transactionId = null;
  if (affectsBalance) {
    const tx = await createBalanceTransaction({
      direction,
      person,
      amount,
      eventDate,
      originalAmount: data.originalAmount,
      originalCurrency: data.originalCurrency,
      exchangeRateUsed: data.exchangeRateUsed,
    });
    transactionId = tx._id;
  }

  const reminder = await Reminder.create({
    type,
    direction,
    person,
    text: data.text || debtText({ direction, person, type }),
    note: data.note || '',
    amount,
    originalAmount: data.originalAmount ?? null,
    originalCurrency: data.originalCurrency ?? null,
    exchangeRateUsed: data.exchangeRateUsed ?? null,
    affectsBalance,
    skipBalance,
    transactionId,
    eventDate,
    dueDate,
    remindAt: dueDate ? computeRemindAt(dueDate) : null,
    remindSent: false,
    status: REMINDER_STATUS.PENDING,
    source: data.source === 'miniapp' ? 'miniapp' : 'bot',
  });

  // Egaga ko'rsatish uchun: joriy balansni (barcha vaqt) qaytaramiz.
  const summary = await getSummary('all');
  return { reminder: serialize(reminder), balanceAfter: summary.balance, affectsBalance, direction };
}

export async function listReminders({ status = 'pending', limit = 200 } = {}) {
  const filter = { ...notDeleted };
  if (status && status !== 'all') filter.status = status;
  return Reminder.find(filter)
    .sort({ status: 1, remindAt: 1, dueDate: 1 })
    .limit(Math.min(Number(limit) || 200, 500))
    .lean();
}

export async function getReminderById(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return Reminder.findOne({ _id: id, ...notDeleted }).lean();
}

// Qarz eslatmasini tahrirlash (bot post-save tahriri): kim/summa/sana/yo'nalish/izoh.
// Balans tranzaksiyasi bilan sinxron: summa o'zgarsa tx summasi ham; summa keyin kiritilsa
// (avval 0 edi) va skipBalance so'ralmagan bo'lsa — tx ENDI yaratiladi (balansga shu payt tushadi);
// skipBalance keyin so'ralsa — tx bekor qilinadi (balans tiklanadi).
export async function updateDebtReminder(id, data = {}) {
  const reminder = await Reminder.findOne({ _id: id, ...notDeleted });
  if (!reminder) throw badRequest('Eslatma topilmadi.');

  if (data.person !== undefined && data.person) {
    reminder.person = String(data.person).replace(/\s+/g, ' ').trim();
  }
  if (data.direction !== undefined && data.direction) {
    reminder.direction = directionOf(data.direction);
  }
  if (data.note !== undefined) reminder.note = data.note || '';
  if (data.amount !== undefined) {
    reminder.amount = parsePositiveAmount(data.amount);
  }
  if (data.dueDate !== undefined) {
    const due = toDate(data.dueDate);
    if (due) {
      reminder.dueDate = due;
      reminder.remindAt = computeRemindAt(due);
      // Yangi sana kelajakda bo'lsa eslatma qaytadan yuborilsin.
      if (reminder.remindAt.getTime() > Date.now()) reminder.remindSent = false;
    }
  }
  reminder.text = debtText({ direction: reminder.direction, person: reminder.person, type: reminder.type });

  // skipBalance niyati yozuvning O'ZIDA saqlanadi: aniq ko'rsatma kelsa yangilanadi,
  // kelmasa avvalgi qaror amal qiladi. Avval "transactionId yo'q" dan xulosa chiqarilardi —
  // skipBalance qarzning istalgan tahriri balans tranzaksiyasini xato yaratib yuborardi.
  if (data.affectsBalance !== undefined) {
    reminder.skipBalance = data.affectsBalance === false;
  }
  // Balans holatini kelishtiramiz. wantBalance: summa bor va egasi balansni taqiqlamagan.
  const wantBalance =
    reminder.type === REMINDER_TYPE.DEBT &&
    reminder.amount > 0 &&
    !reminder.skipBalance;
  if (reminder.status === REMINDER_STATUS.PENDING) {
    if (wantBalance && reminder.transactionId) {
      // Mavjud tx'ni yangilaymiz (summa/yo'nalish/sana/izoh mos bo'lsin).
      const type = reminder.direction === REMINDER_DIRECTION.TAKEN ? TX_TYPES.INCOME : TX_TYPES.EXPENSE;
      const who = reminder.person || '-';
      await Transaction.updateOne(
        { _id: reminder.transactionId, ...notDeleted },
        {
          $set: {
            amount: reminder.amount,
            type,
            description: reminder.direction === REMINDER_DIRECTION.TAKEN ? `Qarz olindi: ${who}` : `Qarz berildi: ${who}`,
          },
        }
      ).catch(() => null);
      reminder.affectsBalance = true;
    } else if (wantBalance && !reminder.transactionId) {
      const tx = await createBalanceTransaction({
        direction: reminder.direction,
        person: reminder.person,
        amount: reminder.amount,
        eventDate: reminder.eventDate,
      });
      reminder.transactionId = tx._id;
      reminder.affectsBalance = true;
    } else if (!wantBalance && reminder.transactionId) {
      await reverseBalanceTransaction(reminder.transactionId);
      reminder.transactionId = null;
      reminder.affectsBalance = false;
    } else {
      reminder.affectsBalance = false;
    }
  }

  await reminder.save();
  const summary = await getSummary('all');
  return { reminder: serialize(reminder), balanceAfter: summary.balance, affectsBalance: reminder.affectsBalance };
}

// Qarz hal bo'ldi (qaytdi/to'lab yubordim) — balans tranzaksiyasi bekor qilinadi (tiklanadi).
// JARIMA (type='fine') TESKARI ishlaydi: "bajarildi" = to'landi, ya'ni chiqim ENDI yoziladi
// (balans kamayadi) — fineService.payFine orqali. Summa berilmagan-u yozuvda ham yo'q bo'lsa
// payFine aniq xato qaytaradi ("summani ayting") — Mini App/bot avval summani so'raydi.
export async function markReminderDone(id, { amount } = {}) {
  const reminder = await Reminder.findOne({ _id: id, ...notDeleted });
  if (!reminder) throw badRequest("Eslatma topilmadi.");
  if (reminder.type === REMINDER_TYPE.FINE) {
    if (reminder.transactionId) {
      // Allaqachon to'langan — takror chiqim yozmaymiz, shunchaki holatni qaytaramiz.
      const summary = await getSummary('all');
      return { reminder: serialize(reminder), balanceAfter: summary.balance };
    }
    const { payFine } = await import('./fineService.js');
    return payFine(id, { amount });
  }
  if (reminder.status !== REMINDER_STATUS.DONE) {
    if (reminder.affectsBalance && reminder.transactionId) await reverseBalanceTransaction(reminder.transactionId);
    reminder.status = REMINDER_STATUS.DONE;
    reminder.doneAt = new Date();
    await reminder.save();
  }
  const summary = await getSummary('all');
  return { reminder: serialize(reminder), balanceAfter: summary.balance };
}

// Bekor qilish (xato kiritildi / qarz bo'lmadi) — balans tranzaksiyasi ham bekor qilinadi.
export async function cancelReminder(id) {
  const reminder = await Reminder.findOne({ _id: id, ...notDeleted });
  if (!reminder) throw badRequest("Eslatma topilmadi.");
  if (reminder.affectsBalance && reminder.transactionId) await reverseBalanceTransaction(reminder.transactionId);
  reminder.status = REMINDER_STATUS.CANCELLED;
  reminder.doneAt = new Date();
  await reminder.save();
  return { reminder: serialize(reminder) };
}

// Keyinroq eslat (snooze) — yuborilgan eslatmani N kun keyinga suradi.
export async function snoozeReminder(id, days = 1) {
  const reminder = await Reminder.findOne({ _id: id, ...notDeleted });
  if (!reminder) throw badRequest("Eslatma topilmadi.");
  const shift = Math.max(1, Number(days) || 1);
  const base = new Date();
  base.setDate(base.getDate() + shift);
  // Soatni asl remindAt soatiga moslab qo'yamiz (ertalab eslatma bo'lsa ertaga ham ertalab).
  const prev = new Date(reminder.remindAt);
  base.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
  reminder.remindAt = base;
  reminder.dueDate = base;
  reminder.remindSent = false;
  reminder.status = REMINDER_STATUS.PENDING;
  await reminder.save();
  return { reminder: serialize(reminder) };
}

// O'chirish (soft-delete). Hali aktiv (pending) balans tranzaksiyasi bo'lsa — uni ham bekor qilamiz.
export async function deleteReminder(id) {
  const reminder = await Reminder.findOne({ _id: id, ...notDeleted });
  if (!reminder) throw badRequest("Eslatma topilmadi.");
  if (reminder.status === REMINDER_STATUS.PENDING && reminder.affectsBalance && reminder.transactionId) {
    await reverseBalanceTransaction(reminder.transactionId);
  }
  reminder.isDeleted = true;
  reminder.deletedAt = new Date();
  await reminder.save();
  return { reminder: serialize(reminder) };
}

export default {
  REMINDER_STATUS,
  REMINDER_TYPE,
  REMINDER_DIRECTION,
  createDebtReminder,
  updateDebtReminder,
  listReminders,
  getReminderById,
  markReminderDone,
  cancelReminder,
  snoozeReminder,
  deleteReminder,
};
