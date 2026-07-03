// Slot-filling helpers for missing fields.
import { normalizePhone } from '../utils/phone.js';
import { parseMoney } from '../utils/money.js';
import { parseHumanDateTime, parseUzbekDate } from '../utils/dates.js';
import { PAYMENT_METHODS } from '../models/Service.js';

// So'rash tartibi (STANDART holat): AI yetishmayotgan maydonlarni shu tartibda
// navbat bilan so'raydi. MUHIM: bular endi QAT'IY majburiy EMAS — foydalanuvchi
// to'xtatsa ("boshqa so'rama", "shu yetadi"...) qolganlari BO'SH qoldirilib saqlanadi.
// Yagona qat'iy talab — ENTRY_MINIMUM (kamida bitta identifikatsiya maydoni).
// To'lov usuli (paymentMethod) so'ralmaydi (model defaulti 'naqd').
export const ENTRY_REQUIRED = {
  SERVICE_ENTRY: ['clientName', 'clientPhone', 'location', 'serviceDateTime', 'price'],
  // Hamkorlik shartnomasi: nom + standart narx + standart manzil. Telefon so'ralmaydi
  // (hamkor ko'pincha korxona) — keyin Mini App/tahrir orqali qo'shsa bo'ladi.
  PARTNER_CONTRACT: ['clientName', 'price', 'location'],
  EXPENSE_ENTRY: ['amount'],
  INCOME_ENTRY: ['amount'],
  // Material sotuvi: summa to'g'ridan aytilmasa, miqdor*kilo narxidan hisoblanadi
  // (applyEntryDefaults), shunda 'amount' to'ladi.
  MATERIAL_SALE: ['materialName', 'amount'],
  ITEM_ENTRY: ['itemName'],
  ITEM_SALE: ['itemName', 'amount'],
  ITEM_GIVEAWAY: ['itemName'],
  // Qarz eslatma: kim (person) + summa + qachon eslatish (dueDate).
  DEBT_REMINDER: ['person', 'amount', 'dueDate'],
};

// ENG KAM talab: yozuv nima haqida ekanini bildiradigan KAMIDA BITTA maydon
// (ro'yxatdan istalgan biri yetarli). Busiz saqlab bo'lmaydi — nima saqlanayotgani noaniq.
export const ENTRY_MINIMUM = {
  SERVICE_ENTRY: ['clientName', 'clientPhone'],
  PARTNER_CONTRACT: ['clientName'],
  EXPENSE_ENTRY: ['amount', 'description', 'category'],
  INCOME_ENTRY: ['amount', 'description'],
  MATERIAL_SALE: ['materialName'],
  ITEM_ENTRY: ['itemName'],
  ITEM_SALE: ['itemName'],
  ITEM_GIVEAWAY: ['itemName'],
  DEBT_REMINDER: ['person'],
};

// Kamida bitta identifikatsiya maydoni to'lganmi?
export function hasMinimumIdentity(intent, collected) {
  const keys = ENTRY_MINIMUM[intent] || [];
  if (!keys.length) return true;
  return keys.some((field) => hasValue(field, collected));
}

// So'raladigan maydonlardan hali bo'sh qolganlari (xulosadagi "Aytilmagan" ro'yxati uchun).
export function missingEntryFields(intent, collected) {
  return (ENTRY_REQUIRED[intent] || []).filter((field) => !hasValue(field, collected));
}

// Maydonlarning foydalanuvchiga ko'rinadigan o'zbekcha nomlari ("Aytilmagan: manzil, narx").
export const FIELD_LABELS = {
  clientName: 'ism',
  clientPhone: 'telefon',
  location: 'manzil',
  serviceDateTime: 'sana/vaqt',
  price: 'narx',
  paymentMethod: "to'lov usuli",
  amount: 'summa',
  category: 'toifa',
  description: 'izoh',
  materialName: 'material nomi',
  quantityKg: 'miqdor (kg)',
  pricePerKg: 'kilo narxi',
  itemName: 'buyum nomi',
  estimatedPrice: 'taxminiy narx',
  recipient: 'oluvchi',
  person: 'kim',
  dueDate: 'eslatma sanasi',
};

// Foydalanuvchi ma'lumot berishni TUGATGANINI bildiradimi? ("boshqa narsa so'rama",
// "shu yetadi", "bilmayman", qisqa "bo'ldi"...). Bu deterministik zaxira — Gemini ham
// kontekstdan tushunsa fields.stopAsking=true beradi (ikkalasi ham tekshiriladi).
const STOP_PHRASE_RE = /(so'?rama|so'?ramang|surama|shu yetadi|shu kifoya|yetarli|qolganini keyin|keyin aytaman|keyin kiritaman|keyin yozaman|hozircha shu|boshqa narsa yo'?q|boshqasi yo'?q|bilmayman|bilmadim|esimda yo'?q|shart emas|hozir bilmayman)/i;
const STOP_SHORT_RE = /^(bo'?ldi|boldi|bo'?ldi shu|shu bo'?ldi|shu|shu xolos|xolos|tamom|tugadi|yetadi|yetarli|kifoya)[.!\s]*$/i;

export function detectStopSignal(text) {
  const v = String(text || '').replace(/[`'‘’ʻ]/g, "'").trim().toLowerCase();
  if (!v) return false;
  if (STOP_PHRASE_RE.test(v)) return true;
  // Qisqa yakun so'zlari faqat butun xabar shulardan iborat bo'lsa (<= 3 so'z) sanaladi
  // ("bo'ldi" — yetarli; "ish bo'ldi zo'r narsa..." — emas).
  const words = v.split(/\s+/);
  if (words.length <= 3 && STOP_SHORT_RE.test(v)) return true;
  return false;
}

// Hamkorlik shartnomasi uchun maydon savollari (umumiy QUESTIONS o'rniga ishlatiladi —
// "xizmat haqi" emas, "standart narx" deb so'raladi).
export const PARTNER_QUESTIONS = {
  clientName: '🤝 Qaysi mijoz bilan shartnoma tuzdingiz, oka? (nomi)',
  price: '💰 Har tashrif uchun standart narx qancha, oka?',
  location: '📍 Hamkorning doimiy manzili qayerda, oka?',
};

export const QUESTIONS = {
  clientPhone: '📞 Mijozning telefon raqami nechi, oka?',
  clientName: '👤 Mijozning ismi nima, oka?',
  location: '📍 Qaysi manzilga borasiz, oka?',
  serviceDateTime: '📅 Qachon borasiz, oka? (sana va vaqt)',
  price: '💰 Xizmat haqi qancha, oka?',
  paymentMethod: "💳 To'lovni qanday oladi, oka? (naqd/karta/o'tkazma)",
  amount: "💰 Qancha bo'ldi, oka? (masalan: 50 ming)",
  category: '🗂 Qaysi turdagi xarajat? (yoqilgi / tamirlash / oziq-ovqat / boshqa)',
  materialName: '♻️ Qaysi materialni sotdingiz, oka? (masalan: paxta, temir, plastik)',
  pricePerKg: "📊 1 kg ni necha pulga sotdingiz, oka?",
  itemName: 'Qaysi buyum, oka? (masalan: muzlatgich, televizor, divan)',
  recipient: 'Kimga berdingiz yoki sotdingiz, oka?',
  person: '👤 Kimga qarz berdingiz, oka? (ism)',
  dueDate: '📅 Qachon eslatay, oka? (masalan: 30-iyun, ertaga, 3 kundan keyin)',
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
    case 'quantityKg':
    case 'pricePerKg':
    case 'estimatedPrice':
      return typeof v === 'number' && v > 0;
    case 'serviceDateTime':
    case 'dueDate':
      return !!v && !Number.isNaN(new Date(v).getTime());
    case 'paymentMethod':
      return PAYMENT_METHODS.includes(v);
    default:
      return typeof v === 'string' ? v.trim().length > 0 : v != null;
  }
}

// `overwrite=false` (default): faqat bo'sh maydonni to'ldiradi (slot-filling).
// `overwrite=true`: mavjud qiymat ustiga yozadi (yakuniy tasdiqdagi tahrir loop'i uchun).
export function mergeFields(collected, incoming = {}, { overwrite = false } = {}) {
  const out = { ...collected };
  for (const [key, raw] of Object.entries(incoming)) {
    if (raw === null || raw === undefined || raw === '' || raw === false) continue;
    // stopAsking — bir martalik xabar signali (yig'ilgan maydon emas), saqlanmaydi.
    if (key === 'stopAsking') continue;
    let value = raw;
    if (key === 'clientPhone' || key === 'targetPhone') value = normalizePhone(raw) || raw;
    else if (key === 'price' || key === 'amount' || key === 'paymentAmount' || key === 'quantityKg' || key === 'pricePerKg' || key === 'estimatedPrice') value = parseMoney(raw);
    else if (key === 'paymentMethod') value = normalizePaymentMethod(raw) || raw;
    else if (key === 'category') value = normalizeExpenseCategory(raw) || raw;
    else if (key === 'materialName' || key === 'itemName' || key === 'recipient' || key === 'person') value = String(raw).replace(/\s+/g, ' ').trim();
    else if (key === 'dueDate' || key === 'eventDate') {
      // AI odatda ISO beradi (YYYY-MM-DD...). Sof matn ("30 iyun", "5-may") new Date() da
      // noto'g'ri yilga o'qilishi mumkin — shuning uchun ISO bo'lmasa avval qat'iy o'zbek oy
      // parseri, so'ng nisbiy parser sinaladi.
      const str = String(raw).trim();
      if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        const iso = new Date(str);
        value = Number.isNaN(iso.getTime()) ? raw : iso.toISOString();
      } else {
        const d = parseUzbekDate(str) || parseHumanDateTime(str);
        if (d) value = d.toISOString();
        else {
          const iso = new Date(str);
          value = Number.isNaN(iso.getTime()) ? raw : iso.toISOString();
        }
      }
    }
    if (value === null || value === undefined || value === '') continue;

    if (overwrite || out[key] === undefined || out[key] === '' || out[key] === null) {
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
    case 'paymentAmount':
    case 'quantityKg':
    case 'pricePerKg':
    case 'estimatedPrice': {
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
    case 'serviceDateTime': {
      // Foydalanuvchi sana/vaqtni alohida javob bersa ("ertaga soat 9") — mahalliy
      // (Asia/Tashkent) vaqtda deterministik parse qilamiz; bo'lmasa xom matnni qoldiramiz.
      const d = parseHumanDateTime(text);
      if (d) out[field] = d.toISOString();
      else {
        const iso = new Date(text);
        out[field] = Number.isNaN(iso.getTime()) ? text : iso.toISOString();
      }
      break;
    }
    case 'dueDate': {
      // Qarz eslatma sanasi. parseUzbekDate AVVAL: u qat'iy (faqat haqiqiy oy nomida ishlaydi),
      // shu sabab parseHumanDateTime ning yumshoq new Date() si "5-may" ni 2001-yilga aylantirib
      // yuborishidan oldin to'g'ri sanani beradi. So'ng nisbiy ("ertaga", "3 kundan keyin"), so'ng ISO.
      const d = parseUzbekDate(text) || parseHumanDateTime(text);
      if (d) out[field] = d.toISOString();
      else {
        const iso = new Date(text);
        out[field] = Number.isNaN(iso.getTime()) ? text : iso.toISOString();
      }
      break;
    }
    default:
      out[field] = text;
  }
  return out;
}

export function nextMissing(intent, collected) {
  const required = ENTRY_REQUIRED[intent] || [];
  for (const field of required) {
    if (!hasValue(field, collected)) return field;
  }
  return null;
}

// IXTIYORIY (yumshoq) so'rov — bir marta beriladi, javob shart emas. Material sotuvida:
// miqdor va umumiy summa bor, lekin kilo narxi yo'q bo'lsa — "1 kg necha pul?" deb so'raymiz.
// Foydalanuvchi javob bersa yoziladi; bermasa (rad etsa) mavjud ma'lumot bilan saqlanadi.
export function nextSoftAsk(intent, collected) {
  if (intent !== 'MATERIAL_SALE') return null;
  if (
    hasValue('quantityKg', collected) &&
    hasValue('amount', collected) &&
    !hasValue('pricePerKg', collected)
  ) {
    return 'pricePerKg';
  }
  return null;
}
