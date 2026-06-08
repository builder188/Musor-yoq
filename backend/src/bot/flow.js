// Yetishmayotgan maydonlarni bittalab to'ldirish mantig'i (slot-filling).
import { normalizePhone } from '../utils/phone.js';
import { parseMoney } from '../utils/money.js';
import { PAYMENT_METHODS } from '../models/Service.js';

// Kiritish niyatlari uchun majburiy maydonlar (ustuvorlik tartibida).
export const ENTRY_REQUIRED = {
  SERVICE_ENTRY: ['clientPhone', 'clientName', 'location', 'serviceDateTime', 'price', 'paymentMethod'],
  EXPENSE_ENTRY: ['amount'],
  INCOME_ENTRY: ['amount'],
};

// Har bir maydon uchun o'zbekcha savol.
export const QUESTIONS = {
  clientPhone: "📞 Mijozning telefon raqamini yuboring (masalan: +998 90 123 45 67).",
  clientName: "👤 Mijozning ismi nima?",
  location: "📍 Manzilni yozing yoki lokatsiya yuboring.",
  serviceDateTime: "🗓 Xizmat qachon bo'ladi? (masalan: ertaga soat 10:00)",
  price: "💵 Narxi qancha? (masalan: 400 ming)",
  paymentMethod: "💳 To'lov turi qanday? (naqd / karta / o'tkazma)",
  amount: "💰 Summasi qancha? (masalan: 50 ming)",
  category: "🏷 Qaysi turdagi xarajat? (yoqilg'i / ta'mirlash / oziq-ovqat / boshqa)",
};

export function isEntryIntent(intent) {
  return Object.prototype.hasOwnProperty.call(ENTRY_REQUIRED, intent);
}

// To'lov turini normallashtirish (apostrof variantlari).
export function normalizePaymentMethod(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().replace(/[`'‘’]/g, "'");
  if (v.includes('naqd')) return 'naqd';
  if (v.includes('karta') || v.includes('plastik')) return 'karta';
  if (v.includes('tkazma') || v.includes('perevod') || v.includes('o\'tkaz')) return "o'tkazma";
  return null;
}

// Maydon to'ldirilganini tekshirish.
export function hasValue(field, collected) {
  const v = collected[field];
  switch (field) {
    case 'clientPhone':
    case 'targetPhone':
      return typeof v === 'string' && /^\+998\d{9}$/.test(v);
    case 'price':
    case 'amount':
    case 'paymentAmount':
      return typeof v === 'number' && v > 0;
    case 'serviceDateTime':
      return !!v && !Number.isNaN(new Date(v).getTime());
    case 'paymentMethod':
      return PAYMENT_METHODS.includes(v);
    default:
      return typeof v === 'string' ? v.trim().length > 0 : v != null;
  }
}

// NLU dan kelgan maydonlarni mavjud to'plamga qo'shish (faqat bo'sh bo'lganlarini).
export function mergeFields(collected, incoming = {}) {
  const out = { ...collected };
  for (const [key, raw] of Object.entries(incoming)) {
    if (raw === null || raw === undefined || raw === '' || raw === 0 || raw === false) continue;
    let value = raw;
    if (key === 'clientPhone' || key === 'targetPhone') value = normalizePhone(raw) || raw;
    else if (key === 'price' || key === 'amount' || key === 'paymentAmount') value = parseMoney(raw);
    else if (key === 'paymentMethod') value = normalizePaymentMethod(raw) || raw;
    if (value === null || value === undefined || value === '') continue;
    // Mavjud to'g'ri qiymatni qayta yozmaymiz.
    if (out[key] === undefined || out[key] === '' || out[key] === null) {
      out[key] = value;
    }
  }
  return out;
}

// Kutilayotgan maydonga foydalanuvchining xom javobini qo'llash (NLU topa olmasa).
export function applyRawValue(field, rawText, collected) {
  const out = { ...collected };
  const text = (rawText || '').trim();
  if (!text) return out;
  switch (field) {
    case 'clientPhone':
    case 'targetPhone': {
      const norm = normalizePhone(text);
      if (norm) out[field] = norm;
      break;
    }
    case 'price':
    case 'amount':
    case 'paymentAmount': {
      const num = parseMoney(text);
      if (num) out[field] = num;
      break;
    }
    case 'paymentMethod': {
      const pm = normalizePaymentMethod(text);
      if (pm) out[field] = pm;
      break;
    }
    case 'category':
    case 'clientName':
    case 'location':
    default:
      out[field] = text;
  }
  return out;
}

// Keyingi yetishmayotgan majburiy maydonni topish.
export function nextMissing(intent, collected) {
  const required = ENTRY_REQUIRED[intent] || [];
  for (const field of required) {
    if (!hasValue(field, collected)) return field;
  }
  return null;
}
