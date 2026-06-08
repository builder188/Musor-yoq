// Xizmatlar bilan ishlash — biznes mantig'ining yuragi.
// MUHIM moliyaviy qoidalar:
//  - Daromad faqat xizmat "bajarildi" bo'lganda yoziladi.
//  - Bajarilgandan keyin narx tahrirlansa — bog'langan daromad va mijoz qarzi qayta hisoblanadi.
//  - To'lanmagan qism mijoz qarziga (totalDebt) qo'shiladi.
import Service, { SERVICE_STATUS } from '../models/Service.js';
import Client from '../models/Client.js';
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import { notDeleted } from '../models/softDelete.js';
import { findOrCreateClient } from './clientService.js';
import { computeReminders } from './reminderService.js';

// Yangi xizmat yaratish.
// data: { clientName, clientPhone, location, serviceDateTime, price, paymentMethod, notes, isHistorical }
export async function createService(data) {
  const client = await findOrCreateClient({
    name: data.clientName,
    phone: data.clientPhone,
    location: typeof data.location === 'string' ? data.location : data.location?.text,
  });

  const serviceDateTime = new Date(data.serviceDateTime);
  const isFuture = serviceDateTime.getTime() > Date.now();

  // Manzilni normallashtirish (matn yoki koordinata).
  const location =
    typeof data.location === 'string'
      ? { text: data.location, lat: null, lng: null }
      : {
          text: data.location?.text || '',
          lat: data.location?.lat ?? null,
          lng: data.location?.lng ?? null,
        };

  // Kelajakdagi ishlar uchun eslatmalar.
  const reminders = isFuture ? await computeReminders(serviceDateTime) : [];

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
    reminders,
  });

  // Tarixiy (o'tgan zamonda aytilgan) ish — bajarilgan deb hisoblaymiz va to'langan deb olamiz.
  // Bu taxmin: o'tgan ish odatda allaqachon bajarilgan va to'lovi olingan.
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

  // Allaqachon bajarilgan bo'lsa — qayta yozmaymiz (idempotent).
  if (service.status === SERVICE_STATUS.DONE) {
    return service;
  }

  service.status = SERVICE_STATUS.DONE;
  if (markPaid) service.paidAmount = service.price;

  // Daromad tranzaksiyasini yaratamiz (to'liq narx — xizmat bajarilgani uchun daromad).
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

  // Mijoz agregatlari.
  const client = await Client.findById(service.clientId);
  if (client) {
    client.totalSpent = (client.totalSpent || 0) + service.price;
    const unpaid = service.price - (service.paidAmount || 0);
    if (unpaid > 0) client.totalDebt = (client.totalDebt || 0) + unpaid;
    await client.save();
  }

  return service;
}

// Xizmatni bekor qilish. Bajarilgan bo'lsa — daromadni ham qaytaramiz.
export async function cancelService(serviceId) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw new Error('Xizmat topilmadi');

  if (service.status === SERVICE_STATUS.DONE && service.incomeTransactionId) {
    await reverseIncome(service);
  }
  service.status = SERVICE_STATUS.CANCELLED;
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
  if (data.location !== undefined) {
    service.location =
      typeof data.location === 'string'
        ? { text: data.location, lat: null, lng: null }
        : { ...service.location, ...data.location };
  }
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
    const client = await Client.findById(service.clientId);
    if (client) {
      client.totalSpent = (client.totalSpent || 0) + delta;
      client.totalDebt = Math.max(0, (client.totalDebt || 0) + delta);
      await client.save();
    }
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
  const client = await Client.findById(service.clientId);
  if (client) {
    client.totalSpent = Math.max(0, (client.totalSpent || 0) - service.price);
    const unpaid = service.price - (service.paidAmount || 0);
    if (unpaid > 0) client.totalDebt = Math.max(0, (client.totalDebt || 0) - unpaid);
    await client.save();
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
    filter.$or = [{ clientName: rx }, { clientPhone: rx }, { 'location.text': rx }, { notes: rx }];
  }
  return Service.find(filter).sort({ serviceDateTime: -1 }).limit(limit).lean();
}

export async function getServiceById(id) {
  return Service.findOne({ _id: id, ...notDeleted }).lean();
}
