// Xizmatlar bilan ishlash вЂ” biznes mantig'ining yuragi.
// MUHIM moliyaviy qoidalar:
//  - Daromad faqat xizmat "bajarildi" bo'lganda yoziladi.
//  - Bajarilgandan keyin narx tahrirlansa, bog'langan daromad qayta hisoblanadi.
//  - To'lov holati faqat xizmat ichida: tolangan/tolanmagan/qisman.
import Service, { SERVICE_STATUS, PAYMENT_STATUS } from '../models/Service.js';
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import { findOrCreateClient } from './clientService.js';
import { computeReminders, scheduleRemindersForService } from './reminderService.js';

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

  // Maxsus eslatma vaqti aytilgan bo'lsa вЂ” standartni almashtiradi.
  // Tarixiy yozuvga (isHistorical) eslatma rejalashtirilmaydi.
  const hasCustomOffset = data.reminderOffsetMinutes !== undefined && data.reminderOffsetMinutes !== null;
  const customOffsets = hasCustomOffset ? [Math.max(0, Math.round(Number(data.reminderOffsetMinutes) || 0))] : null;
  const reminders = isFuture && !data.isHistorical ? await computeReminders(serviceDateTime, customOffsets) : [];

  const service = await Service.create({
    clientId: client._id,
    clientName: client.name,
    clientPhone: client.phone,
    location,
    serviceDateTime,
    price: Math.round(Number(data.price) || 0),
    paymentMethod: data.paymentMethod,
    notes: data.notes || '',
    images: normalizeImages(data.images, data.imageFileId),
    isHistorical: !!data.isHistorical,
    status: SERVICE_STATUS.PENDING,
    paymentStatus: PAYMENT_STATUS.UNPAID,
    reminders,
  });

  // Tarixiy (o'tgan zamonda aytilgan) ish вЂ” bajarilgan va to'langan deb hisoblaymiz.
  if (data.isHistorical && !isFuture) {
    return completeService(service._id, { markPaid: true });
  }
  return service;
}

// Xizmatni bajarilgan deb belgilash -> daromad yozish.
export async function completeService(serviceId, { newPrice = null, markPaid = false, includeTransaction = false } = {}) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw new Error('Xizmat topilmadi');

  if (newPrice !== null && newPrice !== undefined) {
    service.price = Math.round(Number(newPrice));
  }
  if (service.status === SERVICE_STATUS.DONE) {
    if (!includeTransaction) return service;
    const transaction = service.incomeTransactionId
      ? await Transaction.findById(service.incomeTransactionId).lean()
      : null;
    return { service, transaction };
  }

  service.status = SERVICE_STATUS.DONE;
  service.completedAt = new Date();
  if (markPaid) service.paidAmount = service.price;
  service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);

  // Daromad tranzaksiyasi (to'liq narx вЂ” xizmat bajarilgani uchun).
  const transaction = await Transaction.create({
    type: TX_TYPES.INCOME,
    amount: service.price,
    category: 'xizmat',
    description: `Xizmat: ${service.clientName}`,
    serviceId: service._id,
    date: new Date(),
  });
  service.incomeTransactionId = transaction._id;
  await service.save();

  return includeTransaction ? { service, transaction } : service;
}

// Xizmatni bekor qilish. Bajarilgan bo'lsa вЂ” daromadni qaytaramiz.
export async function cancelService(serviceId, reason = null) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw new Error('Xizmat topilmadi');

  const wasDone = service.status === SERVICE_STATUS.DONE;
  if (wasDone && service.incomeTransactionId) {
    await reverseIncome(service);
  }
  service.status = SERVICE_STATUS.CANCELLED;
  service.cancellationReason = reason || service.cancellationReason;
  service.completedAt = null;
  await service.save();
  return service;
}
// Mijozdan olingan pul balansni oshirmaydi: xizmat daromadi "bajarildi" paytida yozilgan.
// Bu faqat eng yaqin to'lanmagan/qisman xizmatning paymentStatus qiymatini yangilaydi.
export async function recordServicePayment({ clientId, amount, note = '' }) {
  const paid = Math.round(Number(amount) || 0);
  if (paid <= 0) throw new Error("To'lov summasi noto'g'ri");

  const service = await Service.findOne({
    clientId,
    ...notDeleted,
    status: { $ne: SERVICE_STATUS.CANCELLED },
    $expr: { $lt: [{ $ifNull: ['$paidAmount', 0] }, '$price'] },
  }).sort({ status: 1, serviceDateTime: -1 });

  if (!service) throw new Error("To'lanmagan yoki qisman to'langan xizmat topilmadi");

  service.paidAmount = Math.min(service.price, (service.paidAmount || 0) + paid);
  service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  if (note) service.notes = service.notes ? `${service.notes}\n${note}` : note;
  await service.save();

  return { service, amountApplied: paid };
}
// Xizmatni tahrirlash. Bajarilgan xizmat narxi o'zgarsa, daromad qayta hisoblanadi.

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
    if (service.status === SERVICE_STATUS.PENDING && !service.isHistorical) {
      const sentReminders = (service.reminders || []).filter((reminder) => reminder.sent);
      const nextReminders = service.serviceDateTime.getTime() > Date.now()
        ? await computeReminders(service.serviceDateTime)
        : [];
      service.reminders = [...sentReminders, ...nextReminders];
    }
  }
  if (data.isHistorical !== undefined) {
    service.isHistorical = !!data.isHistorical;
    if (service.isHistorical) {
      service.reminders = [];
    }
  }
  if (data.paymentMethod !== undefined) service.paymentMethod = data.paymentMethod;
  if (data.notes !== undefined) service.notes = data.notes;
  if (data.price !== undefined) service.price = Math.round(Number(data.price));
  if (data.paidAmount !== undefined) {
    service.paidAmount = Math.max(0, Math.min(service.price, Math.round(Number(data.paidAmount) || 0)));
    service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  }

  // Bajarilgan xizmat narxi o'zgargan bo'lsa вЂ” moliyani moslashtiramiz.
  if (wasDone && data.price !== undefined && service.price !== oldPrice) {
    if (service.incomeTransactionId) {
      await Transaction.findByIdAndUpdate(service.incomeTransactionId, { amount: service.price });
    }
    service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  }

  await service.save();
  return service;
}

export async function rescheduleService(serviceId, newDateTime) {
  if (!newDateTime) throw new Error('Yangi vaqt kerak');
  return editService(serviceId, { serviceDateTime: newDateTime });
}

export { scheduleRemindersForService };

// Bajarilgan xizmat daromadini qaytarish (bekor qilish/o'chirishda).
async function reverseIncome(service) {
  if (service.incomeTransactionId) {
    await Transaction.findByIdAndUpdate(service.incomeTransactionId, {
      isDeleted: true,
      deletedAt: new Date(),
    });
  }
  service.incomeTransactionId = null;
}

// Xizmatlar ro'yxati вЂ” filtrlar bilan (Kanban/List uchun).
export async function listServices({
  status = null,
  clientId = null,
  dateFrom = null,
  dateTo = null,
  search = '',
  limit = 500,
  page = null,
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
  const pageNumber = Math.max(1, parseInt(page, 10) || 0);
  const limitNumber = Math.min(Math.max(parseInt(limit, 10) || 0, 1), 500);
  if (!pageNumber) return Service.find(filter).sort({ serviceDateTime: -1 }).limit(limitNumber).lean();

  const [items, total] = await Promise.all([
    Service.find(filter)
      .sort({ serviceDateTime: -1 })
      .skip((pageNumber - 1) * limitNumber)
      .limit(limitNumber)
      .lean(),
    Service.countDocuments(filter),
  ]);
  return { items, page: pageNumber, limit: limitNumber, total };
}

export async function listUpcomingServices(days = 7) {
  const from = new Date();
  const to = new Date();
  to.setDate(to.getDate() + Number(days || 7));
  to.setHours(23, 59, 59, 999);
  return Service.find({
    ...notDeleted,
    status: SERVICE_STATUS.PENDING,
    serviceDateTime: { $gte: from, $lte: to },
  })
    .sort({ serviceDateTime: 1 })
    .lean();
}

export async function getServiceById(id) {
  return Service.findOne({ _id: id, ...notDeleted }).lean();
}

function normalizeImages(images = [], imageFileId = null) {
  const list = Array.isArray(images) ? images : [];
  if (imageFileId) list.push({ telegramFileId: imageFileId });
  return list
    .filter((image) => image?.telegramFileId || image?.fileId || image?.file_id)
    .map((image) => ({
      telegramFileId: image.telegramFileId || image.fileId || image.file_id || null,
    }));
}
