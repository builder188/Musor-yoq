// Xizmatlar bilan ishlash — biznes mantig'ining yuragi.
// MUHIM moliyaviy qoidalar:
//  - Daromad faqat xizmat "bajarildi" bo'lganda yoziladi.
//  - Bajarilgandan keyin narx tahrirlansa — bog'langan daromad va mijoz qarzi qayta hisoblanadi.
//  - To'lanmagan qism mijoz qarziga (totalDebt) qo'shiladi.
import Service, { SERVICE_STATUS, PAYMENT_STATUS } from '../models/Service.js';
import Client from '../models/Client.js';
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import { findOrCreateClient } from './clientService.js';
import { computeReminders } from './reminderService.js';

const notDeleted = { isDeleted: { $ne: true } };

// Manzilni { address, coordinates } shakliga keltirish (matn yoki obyekt).
function normalizeLocation(loc) {
  if (!loc) return { address: '', coordinates: { lat: null, lng: null } };
  if (typeof loc === 'string') return { address: loc, coordinates: { lat: null, lng: null } };
  return {
    address: loc.address || loc.text || '',
    coordinates: {
      lat: loc.coordinates?.lat ?? loc.lat ?? null,
      lng: loc.coordinates?.lng ?? loc.lng ?? null,
    },
  };
}

// To'lov holatini paidAmount va narxdan aniqlaydi.
function resolvePaymentStatus(paidAmount, price) {
  if (paidAmount >= price && price > 0) return PAYMENT_STATUS.PAID;
  if (paidAmount > 0) return PAYMENT_STATUS.PARTIAL;
  return PAYMENT_STATUS.UNPAID;
}

// Yangi xizmat yaratish.
export async function createService(data) {
  const location = normalizeLocation(data.location);

  const client = await findOrCreateClient({
    name: data.clientName,
    phone: data.clientPhone,
    location: location.address,
    coordinates: location.coordinates,
  });

  const serviceDateTime = new Date(data.serviceDateTime);
  const isFuture = serviceDateTime.getTime() > Date.now();

  // Maxsus eslatma vaqti aytilgan bo'lsa — standartni almashtiradi.
  const customOffsets =
    Number(data.reminderOffsetMinutes) > 0 ? [Math.round(Number(data.reminderOffsetMinutes))] : null;
  const reminders = isFuture ? await computeReminders(serviceDateTime, customOffsets) : [];

  const service = await Service.create({
    clientId: client._id,
    clientName: client.name,
    clientPhone: client.phone,
    location,
    serviceDateTime,
    price: Math.round(Number(data.price) || 0),
    paymentMethod: data.paymentMethod,
    notes: data.notes || '',
    isHistorical: !!data.isHistorical,
    status: SERVICE_STATUS.PENDING,
    paymentStatus: PAYMENT_STATUS.UNPAID,
    reminders,
  });

  // Tarixiy (o'tgan zamonda aytilgan) ish — bajarilgan va to'langan deb hisoblaymiz.
  if (data.isHistorical && !isFuture) {
    return completeService(service._id, { markPaid: true });
  }
  return service;
}

// Xizmatni bajarilgan deb belgilash -> daromad yozish.
export async function completeService(serviceId, { newPrice = null, markPaid = false } = {}) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw new Error('Xizmat topilmadi');

  if (newPrice !== null && newPrice !== undefined) {
    service.price = Math.round(Number(newPrice));
  }
  if (service.status === SERVICE_STATUS.DONE) return service; // idempotent

  service.status = SERVICE_STATUS.DONE;
  service.completedAt = new Date();
  if (markPaid) service.paidAmount = service.price;
  service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);

  // Daromad tranzaksiyasi (to'liq narx — xizmat bajarilgani uchun).
  const tx = await Transaction.create({
    type: TX_TYPES.INCOME,
    amount: service.price,
    serviceId: service._id,
    clientId: service.clientId,
    paymentMethod: service.paymentMethod,
    note: `Xizmat: ${service.clientName}`,
    date: new Date(),
  });
  service.incomeTransactionId = tx._id;
  await service.save();

  // To'lanmagan qism mijoz qarziga qo'shiladi.
  const unpaid = service.price - (service.paidAmount || 0);
  if (unpaid > 0) {
    await Client.findByIdAndUpdate(service.clientId, { $inc: { totalDebt: unpaid } });
  }
  return service;
}

// Xizmatni bekor qilish. Bajarilgan bo'lsa — daromadni qaytaramiz.
export async function cancelService(serviceId) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw new Error('Xizmat topilmadi');

  if (service.status === SERVICE_STATUS.DONE && service.incomeTransactionId) {
    await reverseIncome(service);
  }
  service.status = SERVICE_STATUS.CANCELLED;
  service.completedAt = null;
  await service.save();
  return service;
}

// Xizmatni tahrirlash. Bajarilgan xizmat narxi o'zgarsa — daromad/qarz qayta hisoblanadi.
export async function editService(serviceId, data) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw new Error('Xizmat topilmadi');

  const wasDone = service.status === SERVICE_STATUS.DONE;
  const oldPrice = service.price;

  if (data.clientName !== undefined) service.clientName = data.clientName;
  if (data.clientPhone !== undefined) service.clientPhone = data.clientPhone;
  if (data.location !== undefined) service.location = normalizeLocation(data.location);
  if (data.serviceDateTime !== undefined) {
    service.serviceDateTime = new Date(data.serviceDateTime);
    if (service.status === SERVICE_STATUS.PENDING) {
      service.reminders = await computeReminders(service.serviceDateTime);
    }
  }
  if (data.paymentMethod !== undefined) service.paymentMethod = data.paymentMethod;
  if (data.notes !== undefined) service.notes = data.notes;
  if (data.price !== undefined) service.price = Math.round(Number(data.price));

  // Bajarilgan xizmat narxi o'zgargan bo'lsa — moliyani moslashtiramiz.
  if (wasDone && data.price !== undefined && service.price !== oldPrice) {
    const delta = service.price - oldPrice;
    if (service.incomeTransactionId) {
      await Transaction.findByIdAndUpdate(service.incomeTransactionId, { amount: service.price });
    }
    await Client.findByIdAndUpdate(service.clientId, { $inc: { totalDebt: delta } });
    service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  }

  await service.save();
  return service;
}

// Bajarilgan xizmat daromadini qaytarish (bekor qilish/o'chirishda).
async function reverseIncome(service) {
  if (service.incomeTransactionId) {
    await Transaction.findByIdAndUpdate(service.incomeTransactionId, {
      isDeleted: true,
      deletedAt: new Date(),
    });
  }
  const unpaid = service.price - (service.paidAmount || 0);
  if (unpaid > 0) {
    const client = await Client.findById(service.clientId);
    if (client) {
      client.totalDebt = Math.max(0, (client.totalDebt || 0) - unpaid);
      await client.save();
    }
  }
  service.incomeTransactionId = null;
}

// Xizmatlar ro'yxati — filtrlar bilan (Kanban/List uchun).
export async function listServices({
  status = null,
  clientId = null,
  dateFrom = null,
  dateTo = null,
  search = '',
  limit = 500,
} = {}) {
  const filter = { ...notDeleted };
  if (status) filter.status = status;
  if (clientId) filter.clientId = clientId;
  if (dateFrom || dateTo) {
    filter.serviceDateTime = {};
    if (dateFrom) filter.serviceDateTime.$gte = new Date(dateFrom);
    if (dateTo) filter.serviceDateTime.$lte = new Date(dateTo);
  }
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ clientName: rx }, { clientPhone: rx }, { 'location.address': rx }, { notes: rx }];
  }
  return Service.find(filter).sort({ serviceDateTime: -1 }).limit(limit).lean();
}

export async function getServiceById(id) {
  return Service.findOne({ _id: id, ...notDeleted }).lean();
}
