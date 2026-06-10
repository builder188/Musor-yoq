// O'chirish mantig'i: soft delete, qayta tiklash, to'liq reset.
// HAR QANDAY o'chirish tasdiqlash kodini (1990) talab qiladi.
import Client from '../models/Client.js';
import Service from '../models/Service.js';
import Transaction from '../models/Transaction.js';
import DebtPayment from '../models/DebtPayment.js';
import env from '../config/env.js';

const MODELS = {
  client: Client,
  service: Service,
  transaction: Transaction,
  debt_payment: DebtPayment,
};

// Tasdiqlash kodini tekshirish.
export function checkCode(code) {
  return String(code) === String(env.CONFIRM_DELETE_CODE);
}

// Bitta yozuvni soft-delete qilish.
export async function softDeleteOne(type, id, code) {
  if (!checkCode(code)) throw new Error('Tasdiqlash kodi noto\'g\'ri');
  const Model = MODELS[type];
  if (!Model) throw new Error('Noto\'g\'ri tur');
  return Model.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() }, { new: true });
}

// Ko'plab yozuvlarni o'chirish. target: 'clients' | 'services' | 'finance' | 'all'
export async function bulkDelete(target, code) {
  if (!checkCode(code)) throw new Error('Tasdiqlash kodi noto\'g\'ri');
  const stamp = { isDeleted: true, deletedAt: new Date() };
  const result = {};

  if (target === 'clients' || target === 'all') {
    result.clients = (await Client.updateMany({ isDeleted: { $ne: true } }, stamp)).modifiedCount;
  }
  if (target === 'services' || target === 'all') {
    result.services = (await Service.updateMany({ isDeleted: { $ne: true } }, stamp)).modifiedCount;
  }
  if (target === 'finance' || target === 'all') {
    result.finance = (await Transaction.updateMany({ isDeleted: { $ne: true } }, stamp)).modifiedCount;
    result.debtPayments = (await DebtPayment.updateMany({ isDeleted: { $ne: true } }, stamp)).modifiedCount;
  }
  return result;
}

// O'chirilgan yozuvlarni ko'rish (30 kun ichida tiklash mumkin).
export async function listDeleted() {
  const filter = { isDeleted: true };
  const [clients, services, transactions, debtPayments] = await Promise.all([
    Client.find(filter).sort({ deletedAt: -1 }).lean(),
    Service.find(filter).sort({ deletedAt: -1 }).lean(),
    Transaction.find(filter).sort({ deletedAt: -1 }).lean(),
    DebtPayment.find(filter).sort({ deletedAt: -1 }).lean(),
  ]);
  return { clients, services, transactions, debtPayments };
}

// Yozuvni qayta tiklash.
export async function restore(type, id) {
  const Model = MODELS[type];
  if (!Model) throw new Error('Noto\'g\'ri tur');
  return Model.findByIdAndUpdate(id, { isDeleted: false, deletedAt: null }, { new: true });
}

// 30 kundan oshgan soft-delete yozuvlarni butunlay o'chirish (cron uchun).
export async function purgeOld(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const filter = { isDeleted: true, deletedAt: { $lte: cutoff } };
  const [c, s, t, d] = await Promise.all([
    Client.deleteMany(filter),
    Service.deleteMany(filter),
    Transaction.deleteMany(filter),
    DebtPayment.deleteMany(filter),
  ]);
  return {
    clients: c.deletedCount,
    services: s.deletedCount,
    transactions: t.deletedCount,
    debtPayments: d.deletedCount,
  };
}
