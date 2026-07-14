// Mini App write notifications: short Telegram messages for manual create/edit/delete.
// Route handlers pass the old/new docs; this service formats only added/changed/deleted fields.
import { notifyOwner } from '../bot/notify.js';
import { formatMoney } from '../utils/money.js';
import { formatDateTime } from '../utils/dates.js';

function plain(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return JSON.parse(JSON.stringify(obj));
}

function present(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function get(obj, path) {
  if (!obj || !path) return undefined;
  return String(path)
    .split('.')
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

function hasInput(input, paths = []) {
  if (!input) return false;
  return paths.some((path) => present(get(input, path)));
}

function locationText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  return String(value.address || value.text || '').trim();
}

function firstLocation(doc) {
  if (Array.isArray(doc?.locations) && doc.locations.length) return locationText(doc.locations[0]);
  return locationText(doc?.location);
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? formatMoney(n) : '';
}

function dateTime(value) {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : formatDateTime(d);
}

const STATUS_LABEL = {
  kutilmoqda: 'Kutilmoqda',
  bajarildi: 'Bajarildi',
  bekor_qilindi: 'Bekor qilindi',
  tolanmagan: "To'lanmagan",
  tolangan: "To'langan",
  qisman: 'Qisman',
  available: 'Mavjud',
  sold: 'Sotildi',
  given_away: 'Tekinga berildi',
  discarded: "O'chirildi",
  pending: 'Kutilmoqda',
  done: 'Bajarildi',
  cancelled: 'Bekor qilindi',
};

const TYPE_LABEL = {
  income: 'Kirim',
  expense: 'Chiqim',
  given: 'Qarz berdim',
  taken: 'Qarz oldim',
};

function labelValue(value) {
  return STATUS_LABEL[value] || TYPE_LABEL[value] || value;
}

function formatValue(spec, value) {
  if (!present(value)) return '';
  if (spec.type === 'money') return money(value);
  if (spec.type === 'date') return dateTime(value);
  if (spec.type === 'location') return locationText(value);
  if (spec.type === 'boolean') return value ? 'Ha' : "Yo'q";
  if (spec.type === 'number') return String(value);
  if (spec.type === 'label') return labelValue(value);
  return String(value).replace(/\s+/g, ' ').trim();
}

const FIELD_SPECS = {
  service: [
    { key: 'clientName', label: 'Mijoz', paths: ['clientName', 'name'], get: (d) => d.clientName },
    { key: 'clientPhone', label: 'Telefon', paths: ['clientPhone', 'phone'], get: (d) => d.clientPhone },
    { key: 'location', label: 'Manzil', paths: ['location'], type: 'location', get: (d) => d.location },
    { key: 'serviceDateTime', label: 'Sana', paths: ['serviceDateTime'], type: 'date', get: (d) => d.serviceDateTime },
    { key: 'price', label: 'Narx', paths: ['price', 'newPrice'], type: 'money', get: (d) => d.price },
    { key: 'paidAmount', label: "To'langan", paths: ['paidAmount'], type: 'money', get: (d) => d.paidAmount },
    { key: 'paymentMethod', label: "To'lov usuli", paths: ['paymentMethod'], get: (d) => d.paymentMethod },
    { key: 'paymentStatus', label: "To'lov holati", paths: ['paymentStatus'], type: 'label', get: (d) => d.paymentStatus },
    { key: 'status', label: 'Holat', paths: ['status'], type: 'label', get: (d) => d.status },
    { key: 'cancellationReason', label: 'Bekor sababi', paths: ['reason', 'cancellationReason'], get: (d) => d.cancellationReason },
    { key: 'notes', label: 'Izoh', paths: ['notes'], get: (d) => d.notes },
  ],
  client: [
    { key: 'name', label: 'Mijoz', paths: ['name', 'clientName'], get: (d) => d.name },
    { key: 'phone', label: 'Telefon', paths: ['phone', 'clientPhone'], get: (d) => d.phone },
    { key: 'location', label: 'Manzil', paths: ['location', 'locations'], get: firstLocation },
    { key: 'isPartner', label: 'Hamkor', paths: ['isPartner'], type: 'boolean', get: (d) => d.isPartner },
    { key: 'partnerPrice', label: 'Standart narx', paths: ['partnerPrice', 'price'], type: 'money', get: (d) => d.partnerPrice },
    { key: 'partnerLocation', label: 'Standart manzil', paths: ['partnerLocation'], type: 'location', get: (d) => d.partnerLocation },
  ],
  transaction: [
    { key: 'type', label: 'Tur', paths: ['type'], type: 'label', get: (d) => d.type },
    { key: 'category', label: 'Kategoriya', paths: ['category'], get: (d) => d.category },
    { key: 'amount', label: 'Summa', paths: ['amount'], type: 'money', get: (d) => d.amount },
    { key: 'description', label: 'Izoh', paths: ['description', 'note'], get: (d) => d.description },
    { key: 'date', label: 'Sana', paths: ['date'], type: 'date', get: (d) => d.date },
    { key: 'materialName', label: 'Material', paths: ['materialName'], get: (d) => d.materialName },
    { key: 'quantityKg', label: 'Kg', paths: ['quantityKg'], type: 'number', get: (d) => d.quantityKg },
    { key: 'pricePerKg', label: 'Kg narxi', paths: ['pricePerKg'], type: 'money', get: (d) => d.pricePerKg },
    { key: 'itemName', label: 'Buyum', paths: ['itemName'], get: (d) => d.itemName },
  ],
  item: [
    { key: 'name', label: 'Buyum', paths: ['name', 'itemName'], get: (d) => d.name },
    { key: 'estimatedPrice', label: 'Taxminiy narx', paths: ['estimatedPrice', 'amount'], type: 'money', get: (d) => d.estimatedPrice },
    { key: 'acquiredAt', label: 'Sana', paths: ['acquiredAt', 'date'], type: 'date', get: (d) => d.acquiredAt },
    { key: 'status', label: 'Holat', paths: ['status'], type: 'label', get: (d) => d.status },
    { key: 'recipient', label: 'Oluvchi', paths: ['recipient'], get: (d) => d.recipient },
    { key: 'soldAmount', label: 'Sotuv summasi', paths: ['amount', 'soldAmount'], type: 'money', get: (d) => d.soldAmount },
    { key: 'closedAt', label: 'Yopilgan sana', paths: ['closedAt', 'date'], type: 'date', get: (d) => d.closedAt },
    { key: 'notes', label: 'Izoh', paths: ['notes'], get: (d) => d.notes },
  ],
  materialCategory: [
    { key: 'name', label: 'Kategoriya', paths: ['name'], get: (d) => d.name },
  ],
  reminder: [
    { key: 'person', label: 'Kim', paths: ['person'], get: (d) => d.person },
    { key: 'direction', label: "Yo'nalish", paths: ['direction'], type: 'label', get: (d) => d.direction },
    { key: 'amount', label: 'Summa', paths: ['amount'], type: 'money', get: (d) => d.amount },
    { key: 'dueDate', label: 'Eslatma sanasi', paths: ['dueDate'], type: 'date', get: (d) => d.dueDate },
    { key: 'status', label: 'Holat', paths: ['status'], type: 'label', get: (d) => d.status },
    { key: 'note', label: 'Izoh', paths: ['note'], get: (d) => d.note },
    { key: 'affectsBalance', label: "Balansga ta'sir", paths: ['affectsBalance'], type: 'boolean', get: (d) => d.affectsBalance },
  ],
};

function entityLabel(entity, doc = {}) {
  if (entity === 'transaction') {
    if (doc.type === 'expense') return 'chiqim';
    if (doc.category === 'material') return 'material sotuvi';
    if (doc.category === 'buyum') return 'buyum sotuvi';
    return 'kirim';
  }
  return {
    service: 'xizmat',
    client: 'mijoz',
    item: 'buyum',
    materialCategory: 'material kategoriyasi',
    reminder: 'eslatma',
  }[entity] || 'yozuv';
}

function titleOf(entity, doc = {}) {
  if (entity === 'service') return doc.clientName || doc.location?.address || 'xizmat';
  if (entity === 'client') return doc.name || doc.phone || 'mijoz';
  if (entity === 'transaction') return doc.description || doc.materialName || doc.itemName || doc.category || labelValue(doc.type) || 'tranzaksiya';
  if (entity === 'item') return doc.name || 'buyum';
  if (entity === 'materialCategory') return doc.name || 'kategoriya';
  if (entity === 'reminder') return doc.person || doc.text || 'eslatma';
  return doc.name || doc._id || 'yozuv';
}

function rowsForCreate(entity, doc, input = {}) {
  const specs = FIELD_SPECS[entity] || [];
  const rows = [];
  for (const spec of specs) {
    if (!hasInput(input, spec.paths)) continue;
    const formatted = formatValue(spec, spec.get(doc));
    if (formatted) rows.push({ label: spec.label, value: formatted });
  }
  if (!rows.length) {
    const title = titleOf(entity, doc);
    if (title) rows.push({ label: 'Nomi', value: title });
  }
  return rows;
}

function rowsForUpdate(entity, before, after) {
  const specs = FIELD_SPECS[entity] || [];
  const rows = [];
  for (const spec of specs) {
    const oldValue = formatValue(spec, spec.get(before || {}));
    const newValue = formatValue(spec, spec.get(after || {}));
    if (oldValue !== newValue) {
      rows.push({ label: spec.label, value: newValue || "bo'sh" });
    }
  }
  return rows;
}

function fieldLines(rows) {
  return rows.map((row) => `- ${row.label}: ${row.value}`);
}

function send(text) {
  if (text) notifyOwner(text).catch(() => {});
  return text;
}

export function buildMiniAppCreatedMessage(entity, doc, { input = {} } = {}) {
  const data = plain(doc);
  if (!data) return '';
  const label = entityLabel(entity, data);
  const rows = rowsForCreate(entity, data, input);
  return [`Mini App orqali yangi ${label} qo'shildi oka:`, ...fieldLines(rows)].join('\n');
}

export function buildMiniAppUpdatedMessage(entity, beforeDoc, afterDoc) {
  const before = plain(beforeDoc);
  const after = plain(afterDoc);
  if (!after) return '';
  const rows = rowsForUpdate(entity, before || {}, after);
  if (!rows.length) return '';
  const title = titleOf(entity, after);
  if (rows.length === 1) {
    return `Mini App orqali o'zgartirildi oka: ${title} - ${rows[0].label}: ${rows[0].value}`;
  }
  return [`Mini App orqali o'zgartirildi oka: ${title}`, ...fieldLines(rows)].join('\n');
}

export function buildMiniAppDeletedMessage(entity, doc) {
  const data = plain(doc);
  if (!data) return '';
  return `Mini App orqali o'chirildi oka: ${entityLabel(entity, data)} - ${titleOf(entity, data)}`;
}

export function notifyMiniAppCreated(entity, doc, options = {}) {
  return send(buildMiniAppCreatedMessage(entity, doc, options));
}

export function notifyMiniAppUpdated(entity, beforeDoc, afterDoc) {
  return send(buildMiniAppUpdatedMessage(entity, beforeDoc, afterDoc));
}

export function notifyMiniAppDeleted(entity, doc) {
  return send(buildMiniAppDeletedMessage(entity, doc));
}

export function buildMiniAppBulkDeleteMessage(target, result = {}) {
  const rows = [
    ['Mijozlar', result.clients],
    ['Xizmatlar', result.services],
    ['Tranzaksiyalar', result.transactions],
    ['Buyumlar', result.items],
    ['Eslatmalar', result.reminders],
  ].filter(([, count]) => Number(count) > 0);
  if (!rows.length) return `Mini App orqali o'chirish bajarildi oka: ${target || 'tanlangan yozuvlar'} - o'chirilgan yozuv topilmadi.`;
  return [
    `Mini App orqali o'chirish bajarildi oka: ${target || 'tanlangan yozuvlar'}`,
    ...rows.map(([label, count]) => `- ${label}: ${count} ta`),
  ].join('\n');
}

export function notifyMiniAppBulkDelete(target, result = {}) {
  return send(buildMiniAppBulkDeleteMessage(target, result));
}

export default {
  notifyMiniAppCreated,
  notifyMiniAppUpdated,
  notifyMiniAppDeleted,
  notifyMiniAppBulkDelete,
  buildMiniAppCreatedMessage,
  buildMiniAppUpdatedMessage,
  buildMiniAppDeletedMessage,
  buildMiniAppBulkDeleteMessage,
};
