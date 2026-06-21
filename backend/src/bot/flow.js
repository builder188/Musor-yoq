// Slot-filling helpers for missing fields.
import { normalizePhone } from '../utils/phone.js';
import { parseMoney } from '../utils/money.js';
import { PAYMENT_METHODS } from '../models/Service.js';

export const ENTRY_REQUIRED = {
  SERVICE_ENTRY: ['clientPhone', 'clientName', 'location', 'serviceDateTime', 'price', 'paymentMethod'],
  EXPENSE_ENTRY: ['amount'],
  INCOME_ENTRY: ['amount'],
};

export const QUESTIONS = {
  clientPhone: 'Mijozning telefon raqami?',
  clientName: 'Mijozning ismi?',
  location: 'Qaysi manzilga borish kerak?',
  serviceDateTime: 'Qachon borasiz? (sana va vaqt)',
  price: 'Xizmat narxi qancha?',
  paymentMethod: "To'lov usuli? (naqd/karta/o'tkazma)",
  amount: 'Summasi qancha? (masalan: 50 ming)',
  category: 'Qaysi turdagi xarajat? (yoqilgi / tamirlash / oziq-ovqat / boshqa)',
};

export function isEntryIntent(intent) {
  return Object.prototype.hasOwnProperty.call(ENTRY_REQUIRED, intent);
}

export function normalizePaymentMethod(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().replace(/[`'‘’]/g, '');
  if (v.includes('naqd')) return 'naqd';
  if (v.includes('karta') || v.includes('plastik')) return 'karta';
  if (v.includes('tkazma') || v.includes('perevod')) return 'otkazma';
  return null;
}

export function normalizeExpenseCategory(value) {
  if (!value) return null;
  const v = String(value).toLowerCase().replace(/[`'‘’]/g, '');
  if (/(yoqilgi|yoqilg|benzin|dizel|gaz|yakit|salyarka|propan|metan)/.test(v)) return 'yoqilgi';
  if (/(tamir|tamirlash|remont|shina|balon|moy|maslo|ehtiyot|zapchast|akkumulyator)/.test(v)) {
    return 'tamirlash';
  }
  if (/(oziq|ovqat|non|tushlik|choy|kafe|osh|somsa|suv)/.test(v)) return 'oziq-ovqat';
  if (/(boshqa_chiqim|boshqa|chiqim)/.test(v)) return 'boshqa_chiqim';
  return 'boshqa_chiqim';
}

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

export function mergeFields(collected, incoming = {}) {
  const out = { ...collected };
  for (const [key, raw] of Object.entries(incoming)) {
    if (raw === null || raw === undefined || raw === '' || raw === false) continue;
    let value = raw;
    if (key === 'clientPhone' || key === 'targetPhone') value = normalizePhone(raw) || raw;
    else if (key === 'price' || key === 'amount' || key === 'paymentAmount') value = parseMoney(raw);
    else if (key === 'paymentMethod') value = normalizePaymentMethod(raw) || raw;
    else if (key === 'category') value = normalizeExpenseCategory(raw) || raw;
    if (value === null || value === undefined || value === '') continue;

    if (out[key] === undefined || out[key] === '' || out[key] === null) {
      out[key] = value;
    }
  }
  return out;
}

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
    case 'category': {
      out[field] = normalizeExpenseCategory(text);
      break;
    }
    default:
      out[field] = text;
  }
  return out;
}

// Maxsus eslatma matnini daqiqaga aylantiradi.
// "2 soat oldin" -> 120, "30 daqiqa oldin" -> 30, "1 kun oldin" -> 1440,
// "yarim soat" -> 30, "xizmat vaqtida" -> 0.
export function parseReminderOffset(text) {
  if (!text) return null;
  const v = String(text).toLowerCase().replace(/[`'‘’]/g, '');
  if (/(xizmat vaqti|aniq vaqt|vaqtida)/.test(v)) return 0;
  if (/yarim\s*soat/.test(v)) return 30;

  const num = parseFloat((v.match(/[\d.]+/) || [])[0]);
  if (Number.isNaN(num)) return null;

  if (/(kun|sutka|day)/.test(v)) return num > 0 ? Math.round(num * 1440) : null;
  if (/(soat|hour|chas)/.test(v)) return num > 0 ? Math.round(num * 60) : null;
  if (/(daqiqa|daq|minut|min)/.test(v)) return num >= 0 ? Math.round(num) : null;
  return null;
}

export function nextMissing(intent, collected) {
  const required = ENTRY_REQUIRED[intent] || [];
  for (const field of required) {
    if (!hasValue(field, collected)) return field;
  }
  return null;
}
