// Qidiruv mantig'i: yozuvlarni topish (SEARCH_QUERY) va bot uchun
// holat/to'lov yangilashda mos xizmatni aniqlash.
import Service, { SERVICE_STATUS } from '../models/Service.js';
import Client from '../models/Client.js';
import { notDeleted } from '../models/softDelete.js';
import { normalizePhone } from '../utils/phone.js';

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Umumiy qidiruv: matn + sana oralig'i bo'yicha xizmatlarni topadi.
export async function searchServices({ text = '', dateFrom = null, dateTo = null, limit = 50 } = {}) {
  const filter = { ...notDeleted };
  if (text) {
    const rx = new RegExp(escapeRegex(text), 'i');
    filter.$or = [{ clientName: rx }, { clientPhone: rx }, { 'location.address': rx }, { notes: rx }];
  }
  if (dateFrom || dateTo) {
    filter.serviceDateTime = {};
    if (dateFrom) filter.serviceDateTime.$gte = new Date(dateFrom);
    if (dateTo) filter.serviceDateTime.$lte = new Date(dateTo);
  }
  return Service.find(filter).sort({ serviceDateTime: -1 }).limit(limit).lean();
}

// Mijoz nomi yoki telefoni bo'yicha mijozni topish.
export async function findClient({ name = '', phone = '' } = {}) {
  if (phone) {
    const normalized = normalizePhone(phone);
    const byPhone = await Client.findOne({ phone: normalized, ...notDeleted });
    if (byPhone) return byPhone;
  }
  if (name) {
    const rx = new RegExp(escapeRegex(name), 'i');
    return Client.findOne({ name: rx, ...notDeleted });
  }
  return null;
}

// Holat/to'lov yangilash uchun eng mos xizmatni topish.
// Odatda mijozning eng oxirgi KUTILMOQDA xizmatini qaytaradi.
export async function findServiceForUpdate({ name = '', phone = '' } = {}) {
  const client = await findClient({ name, phone });
  const filter = { ...notDeleted };
  if (client) {
    filter.clientId = client._id;
  } else if (name) {
    filter.clientName = new RegExp(escapeRegex(name), 'i');
  } else {
    return null;
  }

  // Avval kutilayotgan xizmatni qidiramiz.
  const pending = await Service.findOne({ ...filter, status: SERVICE_STATUS.PENDING }).sort({
    serviceDateTime: 1,
  });
  if (pending) return pending;

  // Bo'lmasa — eng oxirgi xizmatni.
  return Service.findOne(filter).sort({ serviceDateTime: -1 });
}
