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
export async function createDebtReminder(data = {}) {
  const type = data.type === REMINDER_TYPE.GENERAL ? REMINDER_TYPE.GENERAL : REMINDER_TYPE.DEBT;
  const direction = directionOf(data.direction);
  const person = String(data.person || '').replace(/\s+/g, ' ').trim();
  const amount = parsePositiveAmount(data.amount);

  const dueDate = toDate(data.dueDate);
  if (!dueDate) throw badRequest("Eslatma sanasini ayting oka.");

  if (type === REMINDER_TYPE.DEBT && !person) throw badRequest("Kimga/kimdan qarz ekanini ayting oka.");
  if (type === REMINDER_TYPE.DEBT && amount <= 0) throw badRequest("Qarz summasini ayting oka.");

  // Balansga ta'sir faqat summa bo'lsa mantiqiy. skipBalance true bo'lsa — tegmaymiz.
  const affectsBalance = type === REMINDER_TYPE.DEBT && amount > 0 && data.affectsBalance !== false;
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
    transactionId,
    eventDate,
    dueDate,
    remindAt: computeRemindAt(dueDate),
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

// Qarz hal bo'ldi (qaytdi/to'lab yubordim) — balans tranzaksiyasi bekor qilinadi (tiklanadi).
export async function markReminderDone(id) {
  const reminder = await Reminder.findOne({ _id: id, ...notDeleted });
  if (!reminder) throw badRequest("Eslatma topilmadi.");
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
  listReminders,
  getReminderById,
  markReminderDone,
  cancelReminder,
  snoozeReminder,
  deleteReminder,
};
