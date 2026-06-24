// Xizmatlar bilan ishlash вЂ” biznes mantig'ining yuragi.
// MUHIM moliyaviy qoidalar:
//  - Daromad faqat xizmat "bajarildi" bo'lganda yoziladi.
//  - Bajarilgandan keyin narx tahrirlansa, bog'langan daromad qayta hisoblanadi.
//  - To'lov holati faqat xizmat ichida: tolangan/tolanmagan/qisman.
import Service, { SERVICE_STATUS, PAYMENT_STATUS } from '../models/Service.js';
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import { findOrCreateClient } from './clientService.js';
import { computeServiceSchedule, applyServiceSchedule } from './reminderService.js';

const notDeleted = { isDeleted: { $ne: true } };

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function badRequest(message) {
  return httpError(400, message);
}

function notFound(message) {
  return httpError(404, message);
}

function parseMoneyAmount(value, message) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw badRequest(message);
  return Math.round(number);
}

function parsePositiveMoneyAmount(value, message) {
  const amount = parseMoneyAmount(value, message);
  if (amount <= 0) throw badRequest(message);
  return amount;
}

function parseRequiredDate(value, message) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) throw badRequest(message);
  return date;
}

// Manzilni DB formati: { address, mapUrl } shakliga keltirish.
function normalizeLocation(loc) {
  if (!loc) return { address: '', mapUrl: null };
  if (typeof loc === 'string') return { address: loc.trim(), mapUrl: null };
  return {
    address: String(loc.address || loc.text || '').trim(),
    mapUrl: normalizeMapUrl(loc.mapUrl || loc.mapLink || loc.url || ''),
  };
}

function normalizeMapUrl(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : text;
  } catch {
    return text;
  }
}

// To'lov holatini paidAmount va narxdan aniqlaydi.
function resolvePaymentStatus(paidAmount, price) {
  if (paidAmount >= price && price > 0) return PAYMENT_STATUS.PAID;
  if (paidAmount > 0) return PAYMENT_STATUS.PARTIAL;
  return PAYMENT_STATUS.UNPAID;
}

// Yangi (kelajak) xizmat uchun jadval maydonlari (Service.create payload'iga qo'shiladi).
// applyServiceSchedule bilan bir xil mantiq: vaqti o'tib ketgan oldindan-eslatma yuborilmaydi.
async function buildScheduleFields(serviceDateTime, now = new Date()) {
  const { reminderAt, confirmAt } = await computeServiceSchedule(serviceDateTime);
  return {
    reminderAt,
    confirmAt,
    reminderSent: reminderAt.getTime() <= now.getTime(),
    confirmSent: false,
  };
}

// Yangi xizmat yaratish.
export async function createService(data) {
  const location = normalizeLocation(data.location);
  if (!location.address?.trim()) throw badRequest('Manzil kerak');

  const client = await findOrCreateClient({
    name: data.clientName,
    phone: data.clientPhone,
    location: location.address,
    mapUrl: location.mapUrl,
  });

  const serviceDateTime = parseRequiredDate(data.serviceDateTime, "Xizmat sanasi noto'g'ri");
  const price = parsePositiveMoneyAmount(data.price, "Xizmat narxi noto'g'ri");

  // Eslatma/tasdiqlash jadvali xizmat vaqtiga nisbatan (Settings soatlari).
  // Tarixiy yozuvga jadval qo'yilmaydi (pastda darhol "bajarildi" qilinadi).
  const schedule = data.isHistorical
    ? { reminderAt: null, confirmAt: null, reminderSent: true, confirmSent: true }
    : await buildScheduleFields(serviceDateTime);

  const service = await Service.create({
    clientId: client._id,
    clientName: client.name,
    clientPhone: client.phone,
    location,
    serviceDateTime,
    price,
    paymentMethod: data.paymentMethod,
    notes: data.notes || '',
    images: normalizeImages(data.images, data.imageFileId),
    isHistorical: !!data.isHistorical,
    status: SERVICE_STATUS.PENDING,
    paymentStatus: PAYMENT_STATUS.UNPAID,
    ...schedule,
  });

  // Tarixiy (o'tgan zamonda aytilgan) ish — darhol bajarilgan va to'langan deb hisoblaymiz.
  if (data.isHistorical) {
    return completeService(service._id, { markPaid: true });
  }
  return service;
}

// Xizmatni bajarilgan deb belgilash -> daromad yozish.
export async function completeService(serviceId, { newPrice = null, markPaid = false, includeTransaction = false } = {}) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw notFound('Xizmat topilmadi');

  if (newPrice !== null && newPrice !== undefined) {
    service.price = parsePositiveMoneyAmount(newPrice, "Xizmat narxi noto'g'ri");
  }
  if (service.status === SERVICE_STATUS.DONE) {
    if (newPrice !== null && newPrice !== undefined) {
      service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
      if (service.incomeTransactionId) {
        await Transaction.findByIdAndUpdate(service.incomeTransactionId, { amount: service.price });
      }
      await service.save();
    }
    if (!includeTransaction) return service;
    const transaction = service.incomeTransactionId
      ? await Transaction.findById(service.incomeTransactionId).lean()
      : await Transaction.findOne({ serviceId: service._id, type: TX_TYPES.INCOME, isDeleted: { $ne: true } }).lean();
    if (!service.incomeTransactionId && transaction?._id) {
      service.incomeTransactionId = transaction._id;
      await service.save();
    }
    return { service, transaction };
  }
  if (service.status === SERVICE_STATUS.CANCELLED) {
    throw badRequest("Bekor qilingan xizmatni bajarib bo'lmaydi");
  }

  service.status = SERVICE_STATUS.DONE;
  service.completedAt = new Date();
  if (markPaid) service.paidAmount = service.price;
  service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  const completed = await Service.findOneAndUpdate(
    { _id: serviceId, ...notDeleted, status: SERVICE_STATUS.PENDING },
    {
      status: SERVICE_STATUS.DONE,
      completedAt: service.completedAt,
      price: service.price,
      paidAmount: service.paidAmount,
      paymentStatus: service.paymentStatus,
    },
    { new: true }
  );
  if (!completed) {
    const current = await Service.findOne({ _id: serviceId, ...notDeleted });
    const transaction = current?.incomeTransactionId
      ? await Transaction.findById(current.incomeTransactionId).lean()
      : current
        ? await Transaction.findOne({ serviceId: current._id, type: TX_TYPES.INCOME, isDeleted: { $ne: true } }).lean()
        : null;
    if (current && !current.incomeTransactionId && transaction?._id) {
      current.incomeTransactionId = transaction._id;
      await current.save();
    }
    return includeTransaction ? { service: current, transaction } : current;
  }

  // Daromad tranzaksiyasi (to'liq narx вЂ” xizmat bajarilgani uchun).
  const transaction = await Transaction.create({
    type: TX_TYPES.INCOME,
    amount: completed.price,
    category: 'xizmat',
    description: `Xizmat: ${completed.clientName}`,
    serviceId: completed._id,
    date: new Date(),
  });
  completed.incomeTransactionId = transaction._id;
  await completed.save();

  return includeTransaction ? { service: completed, transaction } : completed;
}

// Xizmatni bekor qilish. Bajarilgan bo'lsa вЂ” daromadni qaytaramiz.
export async function cancelService(serviceId, reason = null) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw notFound('Xizmat topilmadi');

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
  const paid = parseMoneyAmount(amount, "To'lov summasi noto'g'ri");
  if (paid <= 0) throw badRequest("To'lov summasi noto'g'ri");

  const service = await Service.findOne({
    clientId,
    ...notDeleted,
    status: { $ne: SERVICE_STATUS.CANCELLED },
    $expr: { $lt: [{ $ifNull: ['$paidAmount', 0] }, '$price'] },
  }).sort({ status: 1, serviceDateTime: -1 });

  if (!service) throw notFound("To'lanmagan yoki qisman to'langan xizmat topilmadi");

  service.paidAmount = Math.min(service.price, (service.paidAmount || 0) + paid);
  service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  if (note) service.notes = service.notes ? `${service.notes}\n${note}` : note;
  await service.save();

  return { service, amountApplied: paid };
}
// Xizmatni tahrirlash. Bajarilgan xizmat narxi o'zgarsa, daromad qayta hisoblanadi.

export async function editService(serviceId, data) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw notFound('Xizmat topilmadi');

  const wasDone = service.status === SERVICE_STATUS.DONE;
  const oldPrice = service.price;

  let scheduleDirty = false;
  if (data.clientName !== undefined) service.clientName = data.clientName;
  if (data.clientPhone !== undefined) service.clientPhone = data.clientPhone;
  if (data.location !== undefined) service.location = normalizeLocation(data.location);
  if (data.serviceDateTime !== undefined) {
    service.serviceDateTime = parseRequiredDate(data.serviceDateTime, "Xizmat sanasi noto'g'ri");
    scheduleDirty = true;
  }
  if (data.isHistorical !== undefined) {
    service.isHistorical = !!data.isHistorical;
    scheduleDirty = true;
  }
  if (data.paymentMethod !== undefined) service.paymentMethod = data.paymentMethod;
  if (data.notes !== undefined) service.notes = data.notes;
  if (data.price !== undefined) service.price = parsePositiveMoneyAmount(data.price, "Xizmat narxi noto'g'ri");
  if (data.paidAmount !== undefined) {
    service.paidAmount = Math.min(service.price, parseMoneyAmount(data.paidAmount, "To'lov summasi noto'g'ri"));
    service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  }

  // Bajarilgan xizmat narxi o'zgargan bo'lsa вЂ” moliyani moslashtiramiz.
  if (wasDone && data.price !== undefined && service.price !== oldPrice) {
    if (service.incomeTransactionId) {
      await Transaction.findByIdAndUpdate(service.incomeTransactionId, { amount: service.price });
    }
    service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  }

  // Sana yoki tarixiy holat o'zgarsa — eslatma/tasdiq jadvalini qayta hisoblaymiz
  // (eskisi bekor bo'lib, yangisi ishlaydi). Faqat kutilayotgan xizmat uchun.
  if (scheduleDirty && service.status === SERVICE_STATUS.PENDING) {
    await applyServiceSchedule(service);
  }

  await service.save();
  return service;
}

export async function rescheduleService(serviceId, newDateTime) {
  if (!newDateTime) throw new Error('Yangi vaqt kerak');
  return editService(serviceId, { serviceDateTime: newDateTime });
}

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
    if (dateFrom) filter.serviceDateTime.$gte = parseRequiredDate(dateFrom, "Boshlanish sanasi noto'g'ri");
    if (dateTo) filter.serviceDateTime.$lte = parseRequiredDate(dateTo, "Tugash sanasi noto'g'ri");
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
