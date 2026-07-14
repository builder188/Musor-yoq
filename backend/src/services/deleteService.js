import mongoose from 'mongoose';
import Client from '../models/Client.js';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import UsefulItem from '../models/UsefulItem.js';
import Reminder from '../models/Reminder.js';
import DebtPayment from '../models/DebtPayment.js';
import MaterialCategory from '../models/MaterialCategory.js';
import ExpenseCategory from '../models/ExpenseCategory.js';
import IncomeCategory from '../models/IncomeCategory.js';
import env from '../config/env.js';
import Settings from '../models/Settings.js';
import { applyServiceSchedule } from './reminderService.js';
import { formatDateTime } from '../utils/dates.js';

const MODELS = {
  client: Client,
  clients: Client,
  Client,
  service: Service,
  services: Service,
  Service,
  transaction: Transaction,
  transactions: Transaction,
  Transaction,
  item: UsefulItem,
  items: UsefulItem,
  UsefulItem,
  reminder: Reminder,
  reminders: Reminder,
  Reminder,
};

// 'services' va 'clients' maxsus funksiyalar bilan (bog'liq yozuvlar aniq qamrovda).
const BULK_TARGETS = {
  all: [Client, Service, Transaction, UsefulItem, Reminder],
  finance: [Transaction],
  items: [UsefulItem],
};

export function checkCode(code) {
  return String(code) === String(env.CONFIRM_DELETE_CODE);
}

export async function softDeleteOne(type, id, code = env.CONFIRM_DELETE_CODE) {
  await assertDeleteCode(code);
  const Model = MODELS[type];
  if (!Model) throw new Error("Noto'g'ri tur");
  if (Model === Client) return softDeleteClient(id);
  if (Model === Service) return softDeleteService(id);
  if (Model === Transaction) return softDeleteTransactionOne(id);
  return Model.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() }, { new: true });
}

// Bitta tranzaksiyani o'chirish: xizmatga bog'langan daromad bo'lsa, xizmatga
// "qasddan o'chirilgan" belgisi qo'yiladi — purgeOld'dan keyin repair uni qayta yaratmaydi.
async function softDeleteTransactionOne(id) {
  const tx = await Transaction.findByIdAndUpdate(
    id,
    { isDeleted: true, deletedAt: new Date() },
    { new: true }
  );
  if (tx && tx.type === TX_TYPES.INCOME && tx.serviceId) {
    await Service.updateOne({ _id: tx.serviceId }, { incomeManuallyRemoved: true }).catch((err) =>
      console.error('incomeManuallyRemoved belgilashda xato:', err.message)
    );
  }
  return tx;
}

async function softDeleteClient(id) {
  const deletedAt = new Date();
  const client = await Client.findByIdAndUpdate(id, { isDeleted: true, deletedAt }, { new: true });
  if (!client) return null;

  await Service.updateMany(
    { clientId: id, status: SERVICE_STATUS.PENDING, isDeleted: false },
    {
      isDeleted: true,
      deletedAt,
      clientDeletionNote: serviceNotVisitedNote(deletedAt),
    }
  );
  await Service.updateMany(
    { clientId: id, status: { $ne: SERVICE_STATUS.PENDING }, isDeleted: false },
    {
      isDeletedByClientDeletion: true,
      clientDeletionNote: clientDeletedHistoryNote(deletedAt),
    }
  );
  return client;
}

// Xizmatni (bog'langan daromadi bilan) soft-delete qiladi. Bot post-save "Bekor qilish"
// ham shu funksiyani KODSIZ chaqiradi — hozirgina kiritilgan yozuvni bekor qilish uchun
// 1990-kod so'ralmaydi (softDeleteOne esa avvalgidek kod talab qiladi).
export async function softDeleteServiceCascade(id) {
  const deletedAt = new Date();
  const service = await Service.findByIdAndUpdate(id, { isDeleted: true, deletedAt }, { new: true });
  if (service?.incomeTransactionId) {
    await Transaction.findByIdAndUpdate(service.incomeTransactionId, { isDeleted: true, deletedAt });
  }
  return service;
}

async function softDeleteService(id) {
  return softDeleteServiceCascade(id);
}

export async function bulkDelete(target, code = env.CONFIRM_DELETE_CODE) {
  await assertDeleteCode(code);
  if (target === 'clients') return bulkDeleteClients();
  if (target === 'services') return bulkDeleteServices();
  const models = BULK_TARGETS[target];
  if (!models) throw new Error("Noto'g'ri o'chirish turi");

  const stamp = { isDeleted: true, deletedAt: new Date() };
  const result = {
    clients: 0,
    services: 0,
    transactions: 0,
    items: 0,
    reminders: 0,
  };

  for (const Model of models) {
    const update = await Model.updateMany({ isDeleted: false }, stamp);
    if (Model === Client) result.clients = update.modifiedCount;
    if (Model === Service) result.services = update.modifiedCount;
    if (Model === Transaction) result.transactions = update.modifiedCount;
    if (Model === UsefulItem) result.items = update.modifiedCount;
    if (Model === Reminder) result.reminders = update.modifiedCount;
  }

  // Tranzaksiyalar qamrovga kirgan bo'lsa — bajarilgan (faol) xizmatlarga "daromadi
  // qasddan o'chirilgan" belgisi qo'yiladi, aks holda repair ularni qayta tiriltiradi.
  if (models.includes(Transaction)) {
    await Service.updateMany(
      { isDeleted: false, status: SERVICE_STATUS.DONE },
      { incomeManuallyRemoved: true }
    ).catch((err) => console.error('Bulk incomeManuallyRemoved xatosi:', err.message));
  }

  return {
    ...result,
    warning: 'PDF yuklab olishni xohlaysizmi?',
  };
}

// "Xizmatlarni o'chirish": faqat xizmatlar + o'sha xizmatlarga TO'G'RIDAN-TO'G'RI
// bog'liq tranzaksiyalar (serviceId orqali). Qarz/jarima/material/buyum kabi mustaqil
// moliya yozuvlariga TEGILMAYDI (avval barcha tranzaksiyalar o'chirilardi — xato qamrov).
async function bulkDeleteServices() {
  const deletedAt = new Date();
  const tx = await Transaction.updateMany(
    { isDeleted: false, serviceId: { $ne: null } },
    { isDeleted: true, deletedAt }
  );
  const services = await Service.updateMany({ isDeleted: false }, { isDeleted: true, deletedAt });
  return {
    clients: 0,
    services: services.modifiedCount,
    transactions: tx.modifiedCount,
    items: 0,
    reminders: 0,
    warning: 'PDF yuklab olishni xohlaysizmi?',
  };
}

async function bulkDeleteClients() {
  const deletedAt = new Date();
  const clients = await Client.updateMany({ isDeleted: false }, { isDeleted: true, deletedAt });
  const pending = await Service.updateMany(
    { status: SERVICE_STATUS.PENDING, isDeleted: false },
    {
      isDeleted: true,
      deletedAt,
      clientDeletionNote: serviceNotVisitedNote(deletedAt),
    }
  );
  const history = await Service.updateMany(
    { status: { $ne: SERVICE_STATUS.PENDING }, isDeleted: false },
    {
      isDeletedByClientDeletion: true,
      clientDeletionNote: clientDeletedHistoryNote(deletedAt),
    }
  );
  return {
    clients: clients.modifiedCount,
    services: pending.modifiedCount,
    historyServicesKept: history.modifiedCount,
    transactions: 0,
    items: 0,
    reminders: 0,
    warning: 'PDF yuklab olishni xohlaysizmi?',
  };
}

export async function listDeleted() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const filter = { isDeleted: true, deletedAt: { $gte: thirtyDaysAgo } };
  const [clients, services, transactions, items, reminders] = await Promise.all([
    Client.find(filter).sort({ deletedAt: -1 }).lean(),
    Service.find(filter).sort({ deletedAt: -1 }).lean(),
    Transaction.find(filter).sort({ deletedAt: -1 }).lean(),
    UsefulItem.find(filter).sort({ deletedAt: -1 }).lean(),
    Reminder.find(filter).sort({ deletedAt: -1 }).lean(),
  ]);
  const clientIds = clients.map((client) => client._id);
  const restoreServices = clientIds.length
    ? await Service.find({
        clientId: { $in: clientIds },
        $or: [{ isDeleted: true }, { isDeletedByClientDeletion: true }],
      })
        .sort({ serviceDateTime: -1 })
        .lean()
    : [];
  return { clients, services, transactions, items, reminders, clientRestoreServices: restoreServices };
}

export async function restore(typeOrIds, maybeId = null) {
  if (Array.isArray(typeOrIds)) return restoreByIds(typeOrIds);

  const Model = MODELS[typeOrIds];
  if (!Model) throw new Error("Noto'g'ri tur");
  const doc = await Model.findByIdAndUpdate(
    maybeId,
    { isDeleted: false, deletedAt: null },
    { new: true }
  );

  if (Model === Service && doc) {
    await restoreServiceLinks(doc);
  }
  if (Model === Transaction && doc) {
    await relinkRestoredTransaction(doc);
  }
  return doc;
}

// Tiklangan income tranzaksiyani xizmatiga qayta bog'laydi va "qasddan o'chirilgan"
// belgisini olib tashlaydi (holat yana izchil: faol income + toza bayroq).
async function relinkRestoredTransaction(tx) {
  if (tx.type !== TX_TYPES.INCOME || !tx.serviceId) return;
  await Service.updateOne(
    { _id: tx.serviceId },
    { incomeManuallyRemoved: false, incomeTransactionId: tx._id }
  ).catch((err) => console.error('Tiklangan daromadni bog\'lashda xato:', err.message));
}

// serviceEdits: { [serviceId]: { serviceDateTime?, price? } } — tiklashdan oldin
// xizmatni tahrirlash (masalan o'tib ketgan sanani yangilash yoki narxni to'g'rilash).
export async function restoreClientWithServices(clientId, serviceIds = [], serviceEdits = {}) {
  const client = await Client.findByIdAndUpdate(
    clientId,
    { isDeleted: false, deletedAt: null },
    { new: true }
  );
  if (!client) throw new Error('Mijoz topilmadi');

  const selected = new Set(serviceIds.map(String));
  const services = await Service.find({
    clientId,
    $or: [{ isDeleted: true }, { isDeletedByClientDeletion: true }],
  });

  const restoredServices = [];
  for (const service of services) {
    if (!selected.has(String(service._id))) continue;
    service.isDeleted = false;
    service.deletedAt = null;
    const priceChanged = applyRestoreEdit(service, serviceEdits[String(service._id)]);
    await restoreServiceLinks(service); // income tiklash + eslatmalarni (yangi sanaga) qayta hisoblash
    // Bajarilgan xizmat narxi o'zgargan bo'lsa, bog'langan daromadni ham moslaymiz.
    if (priceChanged && service.status === SERVICE_STATUS.DONE && service.incomeTransactionId) {
      await Transaction.findByIdAndUpdate(service.incomeTransactionId, { amount: service.price });
    }
    restoredServices.push(service);
  }

  return { client, services: restoredServices };
}

// Tiklash paytidagi tahrirni qo'llaydi. Narx o'zgarsa true qaytaradi.
function applyRestoreEdit(service, edit) {
  if (!edit || typeof edit !== 'object') return false;
  if (edit.serviceDateTime) {
    const date = new Date(edit.serviceDateTime);
    if (!Number.isNaN(date.getTime())) service.serviceDateTime = date;
  }
  if (edit.price !== undefined && edit.price !== null && edit.price !== '') {
    const price = Math.round(Number(edit.price));
    if (Number.isFinite(price) && price > 0 && price !== service.price) {
      service.price = price;
      return true;
    }
  }
  return false;
}

export async function restoreByIds(ids = []) {
  const restored = {
    clients: [],
    services: [],
    transactions: [],
    items: [],
    reminders: [],
  };

  for (const id of ids.filter(Boolean)) {
    if (!mongoose.Types.ObjectId.isValid(id)) continue;
    const found = await findDeletedById(id);
    if (!found) continue;

    const { modelName, doc } = found;
    doc.isDeleted = false;
    doc.deletedAt = null;
    await doc.save();

    if (modelName === 'services') {
      await restoreServiceLinks(doc);
    }
    if (modelName === 'transactions') {
      await relinkRestoredTransaction(doc);
    }

    restored[modelName].push(doc);
  }

  return restored;
}

export async function purgeOld(days = 30) {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const filter = { isDeleted: true, deletedAt: { $lt: cutoff } };

  const t = await Transaction.deleteMany(filter);
  const s = await Service.deleteMany(filter);
  const c = await Client.deleteMany(filter);
  const i = await UsefulItem.deleteMany(filter);
  // Qolgan soft-delete modellari ham izchil tozalanadi — hech biri "na purge, na
  // restore ro'yxatida" zombi bo'lib qolmasin.
  const r = await Reminder.deleteMany(filter);
  const dp = await DebtPayment.deleteMany(filter);
  const cats = await Promise.all([
    MaterialCategory.deleteMany(filter),
    ExpenseCategory.deleteMany(filter),
    IncomeCategory.deleteMany(filter),
  ]);

  return {
    clients: c.deletedCount,
    services: s.deletedCount,
    transactions: t.deletedCount,
    items: i.deletedCount,
    reminders: r.deletedCount,
    debtPayments: dp.deletedCount,
    categories: cats.reduce((sum, res) => sum + res.deletedCount, 0),
  };
}

async function findDeletedById(id) {
  const queries = [
    ['clients', Client],
    ['services', Service],
    ['transactions', Transaction],
    ['items', UsefulItem],
    ['reminders', Reminder],
  ];

  for (const [modelName, Model] of queries) {
    const doc = await Model.findOne({ _id: id, isDeleted: true });
    if (doc) return { modelName, doc };
  }
  return null;
}

async function restoreServiceLinks(service) {
  if (service.incomeTransactionId) {
    await Transaction.findByIdAndUpdate(service.incomeTransactionId, {
      isDeleted: false,
      deletedAt: null,
    });
  }
  service.incomeManuallyRemoved = false; // tiklangan xizmat daromadi yana odatiy oqimda
  service.isDeletedByClientDeletion = false;
  service.clientDeletionNote = '';
  if (
    service.status === SERVICE_STATUS.PENDING
    && !service.isHistorical
    && new Date(service.serviceDateTime).getTime() > Date.now()
  ) {
    await applyServiceSchedule(service);
  }
  await service.save();
}

function serviceNotVisitedNote(date) {
  return `Bu xizmat ${formatDateTime(date)} da bekor qilindi, borilmagan.`;
}

function clientDeletedHistoryNote(date) {
  return `Mijoz ${formatDateTime(date)} da o'chirildi. Xizmat tarixi balans uchun saqlandi.`;
}

async function assertDeleteCode(code) {
  const settings = await Settings.getSingleton().catch(() => null);
  const expected = settings?.deleteCode || env.CONFIRM_DELETE_CODE || '1990';
  if (String(code) !== String(expected)) throw new Error("Noto'g'ri kod. 1990 kiriting.");
}
