// Xizmatlar bilan ishlash - biznes mantig'ining yuragi.
// MUHIM moliyaviy qoidalar:
//  - Daromad faqat xizmat "bajarildi" bo'lganda yoziladi.
//  - Bajarilgandan keyin narx tahrirlansa, bog'langan daromad qayta hisoblanadi.
//  - To'lov holati faqat xizmat ichida: tolangan/tolanmagan/qisman.
import Service, { SERVICE_STATUS, NO_INCOME_STATUSES, PAYMENT_STATUS } from '../models/Service.js';
import Transaction, { TX_TYPES } from '../models/Transaction.js';
import { findLatestServiceByIdentity, findClientRowByExactName } from './partnerService.js';
import { computeServiceSchedule, applyServiceSchedule } from './reminderService.js';
import { runGlobal } from '../db/tenantScope.js';
import { startOfDay, endOfDay } from '../utils/dates.js';
import { normalizePhone } from '../utils/phone.js';

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

// Ixtiyoriy sana: berilmagan bo'lsa null, berilgan-u noto'g'ri bo'lsa xato.
function parseOptionalServiceDate(value, message) {
  if (value === undefined || value === null || value === '') return null;
  return parseRequiredDate(value, message);
}

// Ixtiyoriy narx: berilmagan bo'lsa 0 ("hali aytilmagan"), berilgan bo'lsa musbat bo'lishi shart.
function parseOptionalPositiveMoneyAmount(value, message) {
  if (value === undefined || value === null || value === '') return 0;
  return parsePositiveMoneyAmount(value, message);
}

// Manzilni DB formati: { address, mapUrl, coordinates } shakliga keltirish.
function normalizeLocation(loc) {
  if (!loc) return { address: '', mapUrl: null, coordinates: null };
  if (typeof loc === 'string') return { address: loc.trim(), mapUrl: null, coordinates: null };
  return {
    address: String(loc.address || loc.text || '').trim(),
    mapUrl: normalizeMapUrl(loc.mapUrl || loc.mapLink || loc.url || ''),
    coordinates: normalizeCoordinates(loc.coordinates || loc.coords || loc),
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

function normalizeCoordinates(value) {
  if (!value) return null;
  const lat = Number(value.lat ?? value.latitude);
  const lng = Number(value.lng ?? value.longitude ?? value.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
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

// Yangi xizmat yaratish. Faqat identifikatsiya (ism YOKI telefon) majburiy —
// manzil/sana/narx aytilmagan bo'lsa bo'sh qoladi (keyin tahrir/Mini App'dan to'ldiriladi).
// Alohida Client yozuvi YO'Q — ism/telefon shu qatorning o'zida saqlanadi.
export async function createService(data) {
  let location = normalizeLocation(data.location);
  let name = String(data.clientName || '').trim();
  const normalizedPhone = normalizePhone(data.clientPhone);
  const hasPhone = !!normalizedPhone && /^\+998\d{9}$/.test(normalizedPhone);
  if (!name && !hasPhone) throw badRequest('Kamida mijoz ismi yoki telefon raqami kerak');

  const serviceDateTime = parseOptionalServiceDate(data.serviceDateTime, "Xizmat sanasi noto'g'ri");
  let price = parseOptionalPositiveMoneyAmount(data.price, "Xizmat narxi noto'g'ri");

  // Shu mijozning (telefon, bo'lmasa ism bo'yicha) ENG OXIRGI qatori — kanonik nom va
  // hamkor belgisining manbasi. Hamkor bo'lsa, aytilmagan narx/manzil o'sha qatordan
  // meros qilinadi (standartni ALOHIDA saqlash shart emas: har yangi qator o'zi
  // "eng oxirgi" bo'lib, keyingi tashrif uchun standart bo'lib xizmat qiladi).
  let latest = null;
  try {
    latest = hasPhone
      ? await findLatestServiceByIdentity({ name, phone: normalizedPhone })
      : await findClientRowByExactName(name);
  } catch (err) {
    console.warn('Oldingi qatorni qidirishda xato:', err.message);
  }
  const isPartner = !!(data.isPartner || latest?.isPartner);
  if (latest) {
    if (!name && latest.clientName) name = latest.clientName;
    if (isPartner) {
      if (!(price > 0) && latest.price > 0) price = latest.price;
      if (!location.address && latest.location?.address) {
        location = normalizeLocation(latest.location);
      }
    }
  }

  // Eslatma/tasdiqlash jadvali xizmat vaqtiga nisbatan (Settings soatlari).
  // Tarixiy yozuvga (yoki sanasi aytilmagan ishga) jadval qo'yilmaydi.
  const schedule = data.isHistorical || !serviceDateTime
    ? { reminderAt: null, confirmAt: null, reminderSent: true, startReminderSent: true, confirmSent: true }
    : await buildScheduleFields(serviceDateTime);

  const service = await Service.create({
    clientName: name,
    clientPhone: hasPhone ? normalizedPhone : latest?.clientPhone || '',
    isPartner,
    location,
    serviceDateTime,
    price, // DOIM so'mda (agent dollarni oldindan aylantiradi); 0 = hali aytilmagan
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
    if (linked) {
      // Faol income bor (masalan tiklangan) — "qasddan o'chirilgan" bayrog'i eskirgan.
      if (service.incomeManuallyRemoved) {
        service.incomeManuallyRemoved = false;
        await service.save();
      }
      return { transaction: linked, created: false };
    }
  }
  const active = await Transaction.findOne({ serviceId: service._id, type: TX_TYPES.INCOME, isDeleted: { $ne: true } });
  if (active) {
    if (String(service.incomeTransactionId) !== String(active._id) || service.incomeManuallyRemoved) {
      service.incomeTransactionId = active._id;
      service.incomeManuallyRemoved = false;
      await service.save();
    }
    return { transaction: active, created: false };
  }
  // Egasi daromadni QASDDAN o'chirgan — soft-deleted tranzaksiya purgeOld bilan butunlay
  // yo'qolgandan keyin ham qayta yaratmaymiz (bayroq Service'ning o'zida saqlanadi).
  if (service.incomeManuallyRemoved) return { transaction: null, created: false };
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

// Bajarish (va daromad) sanasi: TARIXIY (o'tgan zamonda aytilgan) xizmat — voqea
// allaqachon yuz bergan, shuning uchun u AYTILGAN sanaga (serviceDateTime) tegishli;
// oddiy (kelajak) xizmat hozir bajarilsa — hozirgi sana. Shu sabab oylik/davriy hisobotlar
// daromadni voqea YUZ BERGAN oyga to'g'ri hisoblaydi (kiritilgan oyga emas).
function completionDateFor(service) {
  if (service?.isHistorical && service?.serviceDateTime) {
    const date = new Date(service.serviceDateTime);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
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
  // Kutilmoqda / bajarilmadi / bekor qilingan — barchasidan "bajarildi"ga o'tish mumkin
  // (har bir katak istalgan vaqt tahrirlanadi).
  service.status = SERVICE_STATUS.DONE;
  service.completedAt = completionDateFor(service);
  if (markPaid) service.paidAmount = service.price;
  service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  const completed = await Service.findOneAndUpdate(
    { _id: serviceId, ...notDeleted, status: { $ne: SERVICE_STATUS.DONE } },
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
  // Narx hali aytilmagan (0) bo'lsa daromad yozilmaydi — narx keyin kiritilganda
  // editService/ensureServiceIncome balansga qo'shadi.
  if (!(completed.price > 0)) {
    return includeTransaction ? { service: completed, transaction: null, created: false } : completed;
  }
  const transaction = await Transaction.create({
    telegramUserId: completed.telegramUserId, // daromad egasi = xizmat egasi
    type: TX_TYPES.INCOME,
    amount: completed.price,
    category: 'xizmat',
    description: `Xizmat: ${completed.clientName}`,
    serviceId: completed._id,
    // Tarixiy xizmatda voqea sanasi (serviceDateTime), aks holda hozir — completedAt shu sanaga teng.
    date: completed.completedAt || new Date(),
  });
  completed.incomeTransactionId = transaction._id;
  completed.incomeManuallyRemoved = false; // yangi bajarilish — eski "qasddan o'chirilgan" belgisi bekor
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

    // Teskari tozalash: BEKOR QILINGAN yoki BAJARILMAGAN xizmatda faol income qolib
    // ketgan bo'lsa (masalan o'tish paytida link uzilgan edi) — balansdan qaytaramiz.
    try {
      const cancelledIds = await Service.find({ ...notDeleted, status: { $in: NO_INCOME_STATUSES } })
        .select('_id')
        .lean();
      if (cancelledIds.length) {
        const reversed = await Transaction.updateMany(
          {
            serviceId: { $in: cancelledIds.map((s) => s._id) },
            type: TX_TYPES.INCOME,
            isDeleted: { $ne: true },
          },
          { isDeleted: true, deletedAt: new Date() }
        );
        if (reversed.modifiedCount > 0) {
          console.log(`[REPAIR] ${reversed.modifiedCount} ta bekor qilingan xizmatning qolib ketgan daromadi qaytarildi`);
        }
      }
    } catch (err) {
      console.error('Bekor qilingan xizmat daromadini qaytarishda xato:', err.message);
    }
    return repaired;
  });
}

// Xizmatni bekor qilish (butunlay yopish). Bajarilgan bo'lsa - daromadni qaytaramiz.
export async function cancelService(serviceId, reason = null) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw notFound('Xizmat topilmadi');

  const wasDone = service.status === SERVICE_STATUS.DONE;
  if (wasDone) {
    // Link (incomeTransactionId) uzilgan bo'lsa ham serviceId orqali topib qaytaramiz.
    await reverseIncome(service);
  }
  service.status = SERVICE_STATUS.CANCELLED;
  service.cancellationReason = reason || service.cancellationReason;
  service.completedAt = null;
  await service.save();
  return service;
}

// "Bajarilmadi": vaqti keldi, lekin amalga oshmadi (mas. mashina buzildi). Bekor emas —
// keyin sanasi tahrirlanib qayta rejalashtirilishi mumkin. Balansga ta'sir yo'q
// (bajarilgan bo'lsa daromad qaytariladi), eslatmalar o'chiriladi.
export async function markServiceNotDone(serviceId, reason = null) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw notFound('Xizmat topilmadi');

  if (service.status === SERVICE_STATUS.DONE) {
    await reverseIncome(service);
  }
  service.status = SERVICE_STATUS.NOT_DONE;
  service.cancellationReason = reason || service.cancellationReason;
  service.completedAt = null;
  // Vaqti o'tgan ish — eslatma/tasdiq endi yuborilmaydi (sana tahrirlansa qayta hisoblanadi).
  service.reminderSent = true;
  service.startReminderSent = true;
  service.confirmSent = true;
  await service.save();
  return service;
}

// Qayta "kutilmoqda"ga qaytarish (masalan bajarilmadi → sanasi o'zgartirilib qayta reja).
export async function reopenService(serviceId) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw notFound('Xizmat topilmadi');

  if (service.status === SERVICE_STATUS.DONE) {
    await reverseIncome(service);
  }
  service.status = SERVICE_STATUS.PENDING;
  service.completedAt = null;
  // Kelajak sanasi bo'lsa eslatma/tasdiq jadvali qayta tiklanadi.
  if (!service.isHistorical && service.serviceDateTime) {
    await applyServiceSchedule(service);
  }
  await service.save();
  return service;
}

// Holat dropdown uchun yagona kirish nuqtasi: 4 holatning istalgan biriga o'tkazadi,
// daromad yozish/qaytarish mos servis funksiyasida bajariladi.
export async function setServiceStatus(serviceId, status, { reason = null } = {}) {
  switch (status) {
    case SERVICE_STATUS.DONE:
      return completeService(serviceId, { markPaid: true });
    case SERVICE_STATUS.CANCELLED:
      return cancelService(serviceId, reason);
    case SERVICE_STATUS.NOT_DONE:
      return markServiceNotDone(serviceId, reason);
    case SERVICE_STATUS.PENDING:
      return reopenService(serviceId);
    default:
      throw badRequest("Noto'g'ri holat");
  }
}

// Mijozdan olingan pul balansni oshirmaydi: xizmat daromadi "bajarildi" paytida yozilgan.
// Bu faqat eng yaqin to'lanmagan/qisman xizmatning paymentStatus qiymatini yangilaydi.
// Mijoz endi telefon (bo'lmasa ism) bo'yicha topiladi — alohida Client yozuvi yo'q.
export async function recordServicePayment({ phone = '', name = '', amount, note = '' }) {
  const paid = parseMoneyAmount(amount, "To'lov summasi noto'g'ri");
  if (paid <= 0) throw badRequest("To'lov summasi noto'g'ri");

  const normalized = normalizePhone(phone);
  const identity = normalized && /^\+998\d{9}$/.test(normalized)
    ? { clientPhone: normalized }
    : name
      ? { clientName: new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      : null;
  if (!identity) throw badRequest('Mijoz ismi yoki telefoni kerak');

  const service = await Service.findOne({
    ...identity,
    ...notDeleted,
    status: { $nin: NO_INCOME_STATUSES },
    price: { $gt: 0 },
    $expr: { $lt: [{ $ifNull: ['$paidAmount', 0] }, '$price'] },
  }).sort({ status: 1, serviceDateTime: -1 });

  if (!service) throw notFound("To'lanmagan yoki qisman to'langan xizmat topilmadi");

  service.paidAmount = Math.min(service.price, (service.paidAmount || 0) + paid);
  service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  if (note) service.notes = service.notes ? `${service.notes}\n${note}` : note;
  await service.save();

  return { service, amountApplied: paid };
}

// Mijozning O'Z ma'lumotini (ism/telefon) o'zgartirish — endi alohida yozuv yo'q,
// shu identifikatsiyaga tegishli BARCHA aktiv qatorlarda yangilanadi.
export async function updateClientInfo({ phone = '', name = '' }, data = {}) {
  const normalized = normalizePhone(phone);
  const filter = normalized && /^\+998\d{9}$/.test(normalized)
    ? { clientPhone: normalized }
    : name
      ? { clientName: new RegExp(`^${String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
      : null;
  if (!filter) throw badRequest('Mijoz ismi yoki telefoni kerak');

  const update = {};
  if (data.name !== undefined && String(data.name).trim()) update.clientName = String(data.name).trim();
  if (data.phone !== undefined) {
    const newPhone = normalizePhone(data.phone);
    if (!newPhone || !/^\+998\d{9}$/.test(newPhone)) throw badRequest("Telefon raqami noto'g'ri");
    update.clientPhone = newPhone;
  }
  if (!Object.keys(update).length) throw badRequest("O'zgartiriladigan maydon yo'q");

  const sample = await Service.findOne({ ...filter, ...notDeleted }).sort({ createdAt: -1 }).lean();
  if (!sample) throw notFound('Mijoz topilmadi');

  const res = await Service.updateMany({ ...filter, ...notDeleted }, update);
  return {
    name: update.clientName || sample.clientName || '',
    phone: update.clientPhone || sample.clientPhone || '',
    updatedRows: res.modifiedCount || 0,
  };
}
// Xizmatni tahrirlash. Bajarilgan xizmat narxi o'zgarsa, daromad qayta hisoblanadi.

export async function editService(serviceId, data) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw notFound('Xizmat topilmadi');

  const wasDone = service.status === SERVICE_STATUS.DONE;
  const oldPrice = service.price;

  let scheduleDirty = false;
  if (data.clientName !== undefined) service.clientName = data.clientName;
  if (data.clientPhone !== undefined) {
    const normalized = normalizePhone(data.clientPhone);
    if (!normalized || !/^\+998\d{9}$/.test(normalized)) {
      throw badRequest("Telefon raqami noto'g'ri");
    }
    service.clientPhone = normalized;
  }
  if (data.isPartner !== undefined) service.isPartner = !!data.isPartner;
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
  // Narx tahririda asl valyuta metasi ham mos yangilanadi (USD tahriri — yangi kurs/summa;
  // so'm tahriri — null bilan tozalanadi). undefined kelsa tegilmaydi.
  if (data.originalAmount !== undefined) service.originalAmount = data.originalAmount;
  if (data.originalCurrency !== undefined) service.originalCurrency = data.originalCurrency;
  if (data.exchangeRateUsed !== undefined) service.exchangeRateUsed = data.exchangeRateUsed;
  if (data.paidAmount !== undefined) {
    service.paidAmount = Math.min(service.price, parseMoneyAmount(data.paidAmount, "To'lov summasi noto'g'ri"));
    service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  }

  // Bajarilgan xizmat narxi o'zgargan bo'lsa - moliyani moslashtiramiz.
  if (wasDone && data.price !== undefined && service.price !== oldPrice) {
    if (service.incomeTransactionId) {
      await Transaction.findByIdAndUpdate(service.incomeTransactionId, { amount: service.price });
    } else if (service.price > 0) {
      // Xizmat narxsiz (0) bajarilgan edi — narx endi kiritildi: daromadni endi yozamiz
      // (spec: narx keyin kiritilganda balansga o'sha payt qo'shiladi).
      await ensureServiceIncome(service);
    }
    service.paymentStatus = resolvePaymentStatus(service.paidAmount, service.price);
  }

  // Sana yoki tarixiy holat o'zgarsa — eslatma/tasdiq jadvalini qayta hisoblaymiz
  // (eskisi bekor bo'lib, yangisi ishlaydi). Faqat kutilayotgan va sanasi bor xizmat uchun.
  // Hamkor standartini alohida sinxronlash SHART EMAS: standart doim eng oxirgi
  // qatordan o'qiladi, tahrir esa qatorda o'zi turibdi.
  if (scheduleDirty && service.status === SERVICE_STATUS.PENDING && service.serviceDateTime) {
    await applyServiceSchedule(service);
  }

  await service.save();
  return service;
}

export async function rescheduleService(serviceId, newDateTime) {
  if (!newDateTime) throw new Error('Yangi vaqt kerak');
  return editService(serviceId, { serviceDateTime: newDateTime });
}

// Keyin yuborilgan lokatsiya pinini MAVJUD qatorga biriktirish ("bu manzil qaysi
// xizmatga tegishli?" oqimi). Qatorda manzil MATNI allaqachon bo'lsa — o'sha nom
// saqlanib qoladi; bo'lmasa pin'dan olingan (reverse-geocoded) nom yoziladi.
// mapUrl (Yandex Maps havolasi) va koordinatalar har doim yangilanadi — Mini App'da
// va bot javobida manzil TUGMA bo'lib ochiladi.
export async function attachLocationToService(serviceId, { address = '', mapUrl = null, coordinates = null } = {}) {
  const service = await Service.findOne({ _id: serviceId, ...notDeleted });
  if (!service) throw notFound('Xizmat topilmadi');
  const keptAddress =
    String(service.location?.address || '').trim() || String(address || '').trim() || 'Lokatsiya (xaritada)';
  service.location = {
    address: keptAddress,
    mapUrl: mapUrl || service.location?.mapUrl || null,
    coordinates: coordinates || service.location?.coordinates || null,
  };
  await service.save();
  return service;
}

// Bajarilgan xizmat daromadini qaytarish (bekor qilish/o'chirishda).
// Faqat incomeTransactionId ga tayanmaymiz: link uzilgan bo'lsa ham shu xizmatga
// serviceId orqali bog'langan FAOL income'lar birga qaytariladi.
async function reverseIncome(service) {
  const deletedAt = new Date();
  if (service.incomeTransactionId) {
    await Transaction.findByIdAndUpdate(service.incomeTransactionId, {
      isDeleted: true,
      deletedAt,
    });
  }
  await Transaction.updateMany(
    { serviceId: service._id, type: TX_TYPES.INCOME, isDeleted: { $ne: true } },
    { isDeleted: true, deletedAt }
  );
  service.incomeTransactionId = null;
}

// Xizmatlar ro'yxati - filtrlar bilan (jadval/List uchun). Qidiruv FAQAT shu jadval
// ichida ishlaydi: ism/telefon/manzil/izoh, raqamli so'rovda esa summa (narx) bo'yicha ham.
export async function listServices({
  status = null,
  dateFrom = null,
  dateTo = null,
  search = '',
  limit = 500,
  page = null,
} = {}) {
  const filter = { ...notDeleted };
  if (status) filter.status = status;
  if (dateFrom || dateTo) {
    filter.serviceDateTime = {};
    if (dateFrom) filter.serviceDateTime.$gte = parseRequiredDate(dateFrom, "Boshlanish sanasi noto'g'ri");
    if (dateTo) filter.serviceDateTime.$lte = parseRequiredDate(dateTo, "Tugash sanasi noto'g'ri");
  }
  if (search) {
    const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ clientName: rx }, { clientPhone: rx }, { 'location.address': rx }, { notes: rx }];
    // Raqamli so'rov ("150000" yoki "150 000") — SUMMA (narx) bo'yicha ham qidiradi.
    const numeric = Number(String(search).replace(/[\s']/g, ''));
    if (Number.isFinite(numeric) && numeric > 0 && /^[\d\s']+$/.test(String(search).trim())) {
      filter.$or.push({ price: numeric });
    }
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
// Mijozlar/xizmatlar standart shablonlari va "keyingi mijoz" tavsiyasining yagona manbasi.
export async function getTodayPendingServices() {
  return Service.find({
    ...notDeleted,
    status: SERVICE_STATUS.PENDING,
    serviceDateTime: { $gte: startOfDay(), $lte: endOfDay() },
  })
    .sort({ serviceDateTime: 1 })
    .lean();
}

// Joriy vaqtga serviceDateTime bo'yicha eng yaqin (|Δt| eng kichik) xizmatni tanlaydi.
// Lokatsiya/masofa HISOBGA OLINMAYDI — faqat vaqt. Bo'sh ro'yxatda null.
// MIJOZLAR/XIZMATLAR tavsiyasi va get_next_client BIR XIL mantiqdan foydalanadi (takror yo'q).
export function pickNearestByTime(services = []) {
  if (!services.length) return null;
  const now = Date.now();
  let nearest = services[0];
  let best = Math.abs(new Date(nearest.serviceDateTime).getTime() - now);
  for (const s of services) {
    const diff = Math.abs(new Date(s.serviceDateTime).getTime() - now);
    if (diff < best) {
      best = diff;
      nearest = s;
    }
  }
  return nearest;
}

// get_next_client(): "Endi qaysi mijoz uyiga boraman?" — bugungi, status=kutilmoqda
// xizmatlardan joriy vaqtga eng yaqinini (BIRINCHISINI) qaytaradi. Hech narsa bo'lmasa null.
export async function getNextClient() {
  return pickNearestByTime(await getTodayPendingServices());
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
