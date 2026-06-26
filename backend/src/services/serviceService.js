// Xizmatlar bilan ishlash вЂ” biznes mantig'ining yuragi.
// MUHIM moliyaviy qoidalar:
//  - Daromad faqat xizmat "bajarildi" bo'lganda yoziladi.
//  - Bajarilgandan keyin narx tahrirlansa, bog'langan daromad qayta hisoblanadi.
//  - To'lov holati faqat xizmat ichida: tolangan/tolanmagan/qisman.
import Service, { SERVICE_STATUS, PAYMENT_STATUS } from '../models/Service.js';
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import { findOrCreateClient } from './clientService.js';
import { computeServiceSchedule, applyServiceSchedule } from './reminderService.js';
import { runGlobal } from '../db/tenantScope.js';
import { startOfDay, endOfDay } from '../utils/dates.js';

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
    // Oldindan eslatma vaqti o'tib ketgan bo'lsa yuborilmaydi (kech kiritilgan ish).
    reminderSent: reminderAt.getTime() <= now.getTime(),
    // Xizmat vaqtidagi eslatma — vaqti hali kelmagan bo'lsa, o'sha paytda yuboriladi.
    startReminderSent: new Date(serviceDateTime).getTime() <= now.getTime(),
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
    ? { reminderAt: null, confirmAt: null, reminderSent: true, startReminderSent: true, confirmSent: true }
    : await buildScheduleFields(serviceDateTime);

  const service = await Service.create({
    telegramUserId: client.telegramUserId, // xizmat egasi = mijoz egasi (joriy foydalanuvchi)
    clientId: client._id,
    clientName: client.name,
    clientPhone: client.phone,
    location,
    serviceDateTime,
    price, // DOIM so'mda (agent dollarni oldindan aylantiradi)
    originalAmount: data.originalAmount ?? null,
    originalCurrency: data.originalCurrency ?? null,
    exchangeRateUsed: data.exchangeRateUsed ?? null,
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

// Bajarilgan xizmat uchun FAOL daromad yozuvi borligini kafolatlaydi.
//  1) Bog'langan tranzaksiya sog'lom bo'lsa — o'shani qaytaradi.
//  2) Bog'lanmagan, lekin shu xizmatga faol income bo'lsa — bog'lab qaytaradi.
//  3) Hech qanday income bo'lmasa — yaratadi (o'z-o'zini tuzatish: "bajarildi, lekin
//     balansga tushmagan" holatni tuzatadi). Qasddan o'chirilgan (soft-deleted) income
//     bo'lsa — tegmaydi (bekor/o'chirishda qaytarilgan daromadni qayta tiklamaslik uchun).
// Qaytaradi: { transaction, created } — `created` = yangi yozuv yaratildimi.
async function ensureServiceIncome(service) {
  if (service.incomeTransactionId) {
    const linked = await Transaction.findOne({ _id: service.incomeTransactionId, isDeleted: { $ne: true } });
    if (linked) return { transaction: linked, created: false };
  }
  const active = await Transaction.findOne({ serviceId: service._id, type: TX_TYPES.INCOME, isDeleted: { $ne: true } });
  if (active) {
    if (String(service.incomeTransactionId) !== String(active._id)) {
      service.incomeTransactionId = active._id;
      await service.save();
    }
    return { transaction: active, created: false };
  }
  // Faol income yo'q. O'chirilgan (qasddan olib tashlangan) income bo'lsa — tiklamaymiz.
  const removed = await Transaction.findOne({ serviceId: service._id, type: TX_TYPES.INCOME });
  if (removed || !(service.price > 0)) return { transaction: null, created: false };

  const transaction = await Transaction.create({
    telegramUserId: service.telegramUserId, // daromad egasi = xizmat egasi (global repair'da ham to'g'ri)
    type: TX_TYPES.INCOME,
    amount: service.price,
    category: 'xizmat',
    description: `Xizmat: ${service.clientName}`,
    serviceId: service._id,
    date: service.completedAt || new Date(),
  });
  service.incomeTransactionId = transaction._id;
  await service.save();
  return { transaction, created: true };
}

// Xizmatni bajarilgan deb belgilash -> daromad yozish.
export async function completeService(serviceId, { newPrice = null, markPaid = false, includeTransaction = false } = {}) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw notFound('Xizmat topilmadi');

  if (newPrice !== null && newPrice !== undefined) {
    service.price = parsePositiveMoneyAmount(newPrice, "Xizmat narxi noto'g'ri");
  }
  // Allaqachon bajarilgan — daromad yozuvi BORligini kafolatlaymiz (balansga tushmay
  // qolgan bo'lsa shu yerda tiklanadi). Narx o'zgargan bo'lsa, summani moslaymiz.
  if (service.status === SERVICE_STATUS.DONE) {
    if (newPrice !== null && newPrice !== undefined) {
      service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
      await service.save();
    }
    const { transaction, created } = await ensureServiceIncome(service);
    if (transaction && !created && newPrice !== null && newPrice !== undefined && transaction.amount !== service.price) {
      await Transaction.findByIdAndUpdate(transaction._id, { amount: service.price });
      transaction.amount = service.price;
    }
    if (!includeTransaction) return service;
    return { service, transaction, created };
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
    // Boshqa tik (double-click) atomar ravishda ulgurdi: u daromadni yaratmoqda —
    // bu yerda FAQAT mavjudini qidiramiz (dublikat yozuvning oldini olamiz).
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
    return includeTransaction ? { service: current, transaction, created: false } : current;
  }

  // Daromad tranzaksiyasi (to'liq narx — xizmat bajarilgani uchun).
  const transaction = await Transaction.create({
    telegramUserId: completed.telegramUserId, // daromad egasi = xizmat egasi
    type: TX_TYPES.INCOME,
    amount: completed.price,
    category: 'xizmat',
    description: `Xizmat: ${completed.clientName}`,
    serviceId: completed._id,
    date: new Date(),
  });
  completed.incomeTransactionId = transaction._id;
  await completed.save();

  return includeTransaction ? { service: completed, transaction, created: true } : completed;
}

// Startup tiklash: bajarilgan, lekin daromad yozuvi yo'qolib qolgan xizmatlarni topib,
// balansga tiklaydi (eski/qisman muvaffaqiyatsiz yozuvlar uchun). Dublikat yaratmaydi.
// Startup maintenance — BARCHA foydalanuvchilar bo'yicha (runGlobal). Har bir income
// tranzaksiyasi o'z xizmatining telegramUserId si bilan yaratiladi (ensureServiceIncome).
export async function repairMissingServiceIncome() {
  return runGlobal(async () => {
    const doneServices = await Service.find({ ...notDeleted, status: SERVICE_STATUS.DONE });
    let repaired = 0;
    for (const service of doneServices) {
      try {
        const { created } = await ensureServiceIncome(service);
        if (created) repaired += 1;
      } catch (err) {
        console.error('Daromad tiklashda xato:', err.message);
      }
    }
    if (repaired > 0) console.log(`[REPAIR] ${repaired} ta bajarilgan xizmatga yo'qolgan daromad balansga tiklandi`);
    return repaired;
  });
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

// Bugungi (Asia/Tashkent kun chegarasi) kutilayotgan xizmatlar, vaqt bo'yicha tartiblangan.
// "Mijozlar haqida ma'lumot" standart shabloni va eng yaqin mijoz tavsiyasi uchun.
export async function getTodayPendingServices() {
  return Service.find({
    ...notDeleted,
    status: SERVICE_STATUS.PENDING,
    serviceDateTime: { $gte: startOfDay(), $lte: endOfDay() },
  })
    .sort({ serviceDateTime: 1 })
    .lean();
}

// Bugungi barcha xizmatlar (kutilmoqda + bajarildi; bekor qilingani chiqmaydi), vaqt
// bo'yicha tartiblangan. "Xizmatlar haqida ma'lumot" qisqa shabloni uchun.
export async function getTodayServices() {
  return Service.find({
    ...notDeleted,
    status: { $in: [SERVICE_STATUS.PENDING, SERVICE_STATUS.DONE] },
    serviceDateTime: { $gte: startOfDay(), $lte: endOfDay() },
  })
    .sort({ serviceDateTime: 1 })
    .lean();
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
