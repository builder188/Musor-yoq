// Gemini AI Agent executor.
// Flow: classified intent -> missing-field guard -> Gemini action tool call ->
// MongoDB service operation -> Gemini Uzbek response.
import {
  isEntryIntent,
  mergeFields,
  applyRawValue,
  hasValue,
  nextMissing,
  nextSoftAsk,
  hasMinimumIdentity,
  detectStopSignal,
  ENTRY_MINIMUM,
  FIELD_LABELS,
  QUESTIONS,
  PARTNER_QUESTIONS,
  normalizeExpenseCategory,
  normalizeIncomeCategory,
} from '../bot/flow.js';
import {
  SUB_INTENTS,
  SUB_TO_HIGH,
  HIGH_DEFAULT_SUB,
  CONFIDENCE_THRESHOLD,
} from './intents.js';
import { formulateToolResponse, MULTI_ENTRY_KIND_TO_INTENT, MULTI_ENTRY_INTENTS } from './gemini.js';
import {
  createService,
  completeService,
  cancelService,
  recordServicePayment,
  editService,
  rescheduleService,
} from '../services/serviceService.js';
import {
  createTransaction,
  getSummary,
  listTransactions,
  updateTransaction,
  softDeleteTransaction,
} from '../services/financeService.js';
import { createDebtReminder, updateDebtReminder, deleteReminder } from '../services/reminderEntryService.js';
import { softDeleteServiceCascade } from '../services/deleteService.js';
import { listClients, updateClient } from '../services/clientService.js';
import { formatKg } from '../services/materialService.js';
import {
  createUsefulItem,
  sellUsefulItem,
  giveAwayUsefulItem,
  confirmUsefulItemAction,
  updateUsefulItem,
  updateItemSale,
  revertItemSale,
  revertItemGiveaway,
  softDeleteUsefulItem,
} from '../services/usefulItemService.js';
import { searchServices, findServiceForUpdate, findClient, findClientsByName } from '../services/searchService.js';
import { findPartnerByName, upsertPartnerContract, revertPartnerContract } from '../services/partnerService.js';
import { getUsdToUzsRate } from '../services/exchangeRateService.js';
import { answerReadQuery } from './queries.js';
import { TX_TYPES } from '../models/Transaction.js';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import { formatMoney, parseMoney, convertUsdToUzs } from '../utils/money.js';
import { formatDateTime, parseHumanDateTime, parseUzbekDate, correctServiceDateTime } from '../utils/dates.js';
import { formatPhone, normalizePhone } from '../utils/phone.js';
import {
  editConfirmKeyboard,
  paymentMethodKeyboard,
  clientPickKeyboard,
  clarifyKeyboard,
  savedSummaryText,
  multiSavedSummaryText,
  savedEntryKeyboard,
  reminderInfoLine,
} from '../bot/ui.js';
import { expenseKey } from '../services/categoryService.js';

// Yetishmayotgan maydonni so'rash — paymentMethod uchun tugmalar bilan.
// Hamkorlik shartnomasida maydonlar o'ziga xos savol bilan so'raladi ("standart narx").
function askField(field, intent = null) {
  if (field === 'paymentMethod') {
    return { text: QUESTIONS[field], keyboard: paymentMethodKeyboard() };
  }
  if (intent === 'PARTNER_CONTRACT' && PARTNER_QUESTIONS[field]) {
    return { text: PARTNER_QUESTIONS[field] };
  }
  return { text: QUESTIONS[field] };
}

const PIVOT_SUBS = new Set(['SEARCH_QUERY', 'ANALYTICS_QUERY']);
// Erkin matnli maydonlar har qanday matnni "yutadi" — bu yerda pivot faqat aniq savolda.
const FREE_TEXT_FIELDS = new Set(['clientName', 'location', 'notes', 'description']);
// Slot-filling o'rtasida niyat korreksiyasi faqat shu aniq yozuv amallari uchun.
const WRITE_ACTIONS = new Set([
  'SERVICE_ENTRY', 'PARTNER_CONTRACT', 'EXPENSE_ENTRY', 'INCOME_ENTRY', 'MATERIAL_SALE', 'ITEM_ENTRY', 'ITEM_SALE', 'ITEM_GIVEAWAY', 'STATUS_UPDATE',
  'SERVICE_EDIT', 'CLIENT_EDIT', 'PAYMENT_UPDATE', 'DEBT_REMINDER',
]);

function looksLikeQuestion(text) {
  const v = String(text || '').toLowerCase();
  return /\?|qancha|qachon|nima|qayer|qaysi|necha|balans|foyda|daromad|hisob|royxat|ro'yxat|qarz/.test(v);
}

// Slot-filling o'rtasidagi SUXBAT savolini aniqlaydi: savolga javob berib, to'xtagan
// maydonni qayta so'raydi (conversation holatiga tegmaydi).
async function maybePivot({ conversation, understanding, rawText, mode }) {
  const sub = understanding?.subIntent;
  if (!PIVOT_SUBS.has(sub)) return null;
  if ((understanding?.confidence ?? 0) < CONFIDENCE_THRESHOLD) return null;

  const field = conversation.awaitingField;
  if (!field) return null;

  if (FREE_TEXT_FIELDS.has(field)) {
    if (!looksLikeQuestion(rawText)) return null;
  } else if (hasValue(field, applyRawValue(field, rawText, {}))) {
    // Tuzilmali maydon (tel/narx/sana/to'lov) javobi to'g'ri qiymat bersa — pivot emas.
    return null;
  }

  const answerSub =
    sub === 'ANALYTICS_QUERY' || hasAnalyticsSignal(understanding.fields) ? 'ANALYTICS_QUERY' : 'SEARCH_QUERY';
  const answer = await executeToolFlow({ intent: answerSub, fields: understanding.fields || {}, rawText, mode });
  const reAsk = askField(field, conversation.pendingIntent);
  const text = `${answer.text}\n\n${reAsk.text}`;
  return reAsk.keyboard ? { text, keyboard: reAsk.keyboard } : { text };
}

// Slot-filling o'rtasida AI niyatni xato aniqlagan bo'lib, foydalanuvchi shu zahoti
// BOSHQA aniq yozuv niyatini bildirsa (mas. SERVICE_ENTRY o'rtasida "yo'q, benzinga 50ming"),
// eski sessiyani tashlab yangisiga o'tishni aniqlaydi. Juda ehtiyotkor: yuqori ishonch,
// boshqa WRITE amal, o'ziga xos konkret maydon, va joriy maydonga sof javob EMASligi.
function maybeCorrectIntent({ conversation, understanding, rawText }) {
  if ((understanding?.confidence ?? 0) < CONFIDENCE_THRESHOLD) return false;
  const action = resolveAction(understanding);
  if (!WRITE_ACTIONS.has(action)) return false; // SUXBAT savoli — maybePivot hal qiladi
  if (action === conversation.pendingIntent) return false; // bir xil niyat — bu davom, korreksiya emas
  if (!hasConcreteSignal(action, understanding.fields || {})) return false;
  if (answersCurrentField(conversation.awaitingField, rawText)) return false; // joriy maydon javobi
  return true;
}

// Yangi niyat haqiqatan "yangi amal"ga arziydigan konkret maydonga egami?
// (Tasodifiy/yarim klassifikatsiya bo'yicha sessiyani buzib yubormaslik uchun.)
function hasConcreteSignal(action, f = {}) {
  switch (action) {
    case 'EXPENSE_ENTRY':
    case 'INCOME_ENTRY':
      return typeof f.amount === 'number' && f.amount > 0;
    case 'MATERIAL_SALE':
      // Aniq material nomi + (umumiy summa YOKI miqdor*kilo narxi) — haqiqiy yangi sotuv.
      return Boolean(
        f.materialName &&
          ((typeof f.amount === 'number' && f.amount > 0) ||
            (typeof f.quantityKg === 'number' && f.quantityKg > 0 &&
              typeof f.pricePerKg === 'number' && f.pricePerKg > 0))
      );
    case 'ITEM_ENTRY':
      return Boolean(f.itemName);
    case 'ITEM_SALE':
      return Boolean(f.itemName && typeof f.amount === 'number' && f.amount > 0);
    case 'ITEM_GIVEAWAY':
      return Boolean(f.itemName);
    case 'SERVICE_ENTRY':
      // Shunchaki ism emas — to'liqroq yangi ish (sana/narx/tel ham bor).
      return Boolean(f.clientName && (f.serviceDateTime || f.price || f.clientPhone));
    case 'PARTNER_CONTRACT':
      // Aniq shartnoma: nom + (standart narx YOKI manzil) bo'lsa haqiqiy yangi hamkorlik.
      return Boolean(f.clientName && (f.price || f.location));
    case 'STATUS_UPDATE':
      return Boolean(f.newStatus);
    case 'PAYMENT_UPDATE':
      return Boolean(f.paymentAmount || f.amount);
    case 'DEBT_REMINDER':
      // Aniq qarz: kim + summa + sana (uchalasi bo'lsa haqiqiy yangi qarz eslatmasi).
      return Boolean(f.person && typeof f.amount === 'number' && f.amount > 0 && f.dueDate);
    case 'SERVICE_EDIT':
    case 'CLIENT_EDIT':
      return Boolean(f.editField || f.newValue);
    default:
      return false;
  }
}

// Matn joriy so'ralayotgan maydonga aniq javob bermoqdami? Bo'lsa — korreksiya emas, javob.
// Tuzilmali maydonlarda: qisqa va sof qiymat (gap ichidagi tasodifiy raqam emas) bo'lishi shart.
function answersCurrentField(field, rawText) {
  const text = String(rawText || '').trim();
  if (!field || !text) return false;
  if (FREE_TEXT_FIELDS.has(field)) return false; // erkin matn: "javob" deb hisoblamaymiz
  const words = text.split(/\s+/).length;
  if (field === 'price' || field === 'amount' || field === 'paymentAmount') {
    return words <= 3 && hasValue(field, applyRawValue(field, text, {}));
  }
  if (field === 'serviceDateTime') {
    return words <= 4 && hasValue(field, applyRawValue(field, text, {}));
  }
  // clientPhone / targetPhone / paymentMethod — qiymatga parse bo'lsa, javob.
  return hasValue(field, applyRawValue(field, text, {}));
}

const TOOL_BY_INTENT = {
  SERVICE_ENTRY: 'create_service',
  PARTNER_CONTRACT: 'upsert_partner_contract',
  EXPENSE_ENTRY: 'create_transaction',
  INCOME_ENTRY: 'create_transaction',
  MATERIAL_SALE: 'create_transaction',
  ITEM_ENTRY: 'create_useful_item',
  ITEM_SALE: 'sell_useful_item',
  ITEM_GIVEAWAY: 'give_useful_item',
  STATUS_UPDATE: 'update_service_status',
  SERVICE_EDIT: 'edit_service',
  CLIENT_EDIT: 'edit_client',
  PAYMENT_UPDATE: 'record_payment',
  DEBT_REMINDER: 'create_debt_reminder',
  SEARCH_QUERY: 'search_data',
  ANALYTICS_QUERY: 'get_analytics',
};

// Foydalanuvchi aytadigan maydon nomi -> service maydoni.
const SERVICE_EDIT_FIELD = {
  narx: 'price',
  price: 'price',
  sana: 'serviceDateTime',
  vaqt: 'serviceDateTime',
  date: 'serviceDateTime',
  manzil: 'location',
  location: 'location',
  address: 'location',
};

const CLIENT_EDIT_FIELD = {
  ism: 'name',
  name: 'name',
  telefon: 'phone',
  tel: 'phone',
  phone: 'phone',
  raqam: 'phone',
};

export async function runAgent({ understanding, rawText = '', conversation = null, mode = 'bot', sourceMeta = null }) {
  // 0) MULTI-ENTRY: bitta xabarda 2+ kirim/chiqim ("ovqatga 60 ming, benzinga 100 ming") —
  // slot-filling'siz HAR BIRINI alohida tranzaksiya qilib darhol saqlaymiz. Avval faqat
  // birinchi yozuv saqlanardi (foydalanuvchi shikoyat qilgan bug). Yarim qolgan oqim
  // bo'lsa ham bu aniq ustun buyruq — eski sessiya tashlanadi.
  const multiEntries = resolveMultiEntries(understanding);
  if (multiEntries) {
    if (mode === 'query') return { text: "Buni bot orqali bajaramiz oka. Bu yer faqat qidiruv va tahlil uchun." };
    if (conversation?.pendingIntent) await conversation.reset();
    return handleMultiEntry({ conversation, entries: multiEntries, fields: understanding.fields || {}, rawText, mode, sourceMeta });
  }

  // 1) Davom etayotgan slot-filling ustuvor — SUXBAT pivoti shu ichida hal bo'ladi.
  if (conversation?.pendingIntent && isEntryIntent(conversation.pendingIntent)) {
    return continueEntry({ conversation, understanding, rawText, mode });
  }

  // 2) CLARIFY: ishonch past yoki 2 niyatga teng mos — taxmin qilmay, tugmali savol beramiz.
  const clarify = resolveClarify(understanding);
  if (clarify) return startClarify({ clarify, understanding, rawText, conversation });

  // 3) Aniq amal (sub-action) — MongoDB operatsiyasi shu darajada bajariladi.
  // Eslatma: dollar endi RAD ETILMAYDI — summa avtomatik so'mga aylantiriladi (pastdagi
  // applyCurrencyConversion / handlePaymentUpdate / handleServiceEdit).
  const action = resolveAction(understanding);

  switch (action) {
    case 'SERVICE_ENTRY':
    case 'PARTNER_CONTRACT':
    case 'EXPENSE_ENTRY':
    case 'INCOME_ENTRY':
    case 'MATERIAL_SALE':
    case 'ITEM_ENTRY':
    case 'ITEM_SALE':
    case 'ITEM_GIVEAWAY':
    case 'DEBT_REMINDER':
      if (mode === 'query') return { text: "Buni bot orqali bajaramiz oka. Bu yer faqat qidiruv va tahlil uchun." };
      return startEntry({ conversation, intent: action, fields: understanding.fields || {}, rawText, mode, sourceMeta });

    case 'STATUS_UPDATE':
      return handleStatusUpdate({ fields: understanding.fields || {}, rawText, conversation, mode });

    case 'SERVICE_EDIT':
      return handleServiceEdit({ fields: understanding.fields || {}, rawText, conversation, mode });

    case 'CLIENT_EDIT':
      return handleClientEdit({ fields: understanding.fields || {}, rawText, conversation, mode });

    case 'PAYMENT_UPDATE':
      return handlePaymentUpdate({ fields: understanding.fields || {}, rawText, conversation, mode });

    case 'SEARCH_QUERY':
    case 'ANALYTICS_QUERY': {
      // Raqamli savol (analyticsMetric/analyticsPeriod bor) qidiruv emas — model
      // SEARCH_QUERY desa ham get_analytics'ga yo'naltiramiz (javob sifati buzilmasin).
      const isAnalytics = action === 'ANALYTICS_QUERY' || hasAnalyticsSignal(understanding.fields);
      // Standart o'qish-shablonlari (balans / mijozlar / xizmatlar / keyingi mijoz) —
      // bot va Mini App BIR XIL modulni chaqiradi (ai/queries.js). Mos kelmasa null →
      // umumiy qidiruv/tahlilga tushadi.
      const templated = await answerReadQuery({ rawText, fields: understanding.fields || {}, isAnalytics });
      if (templated) return templated;
      const suxbat = isAnalytics ? 'ANALYTICS_QUERY' : 'SEARCH_QUERY';
      return executeToolFlow({ intent: suxbat, fields: understanding.fields || {}, rawText, mode });
    }

    default:
      return {
        text:
          understanding.clarifyingQuestion ||
          understanding.reply ||
          "Tushunmadim oka, birozroq ochiqroq aytib bersangiz? Mijoz, xizmat, xarajat, to'lov, material yoki buyum sotuvi, yoki hisobot bo'lishi mumkin.",
      };
  }
}

// Bajariladigan aniq amalni (sub-action) hal qiladi.
// Eski chaqiruvlar (callbacks, OCR) to'g'ridan sub-intent berishi mumkin — uni qabul qilamiz;
// yangi klassifikator esa high-level intent + subIntent beradi.
function resolveAction(understanding) {
  const { intent, subIntent } = understanding || {};
  if (SUB_INTENTS.includes(intent)) return intent;
  if (subIntent && SUB_INTENTS.includes(subIntent)) return subIntent;
  return HIGH_DEFAULT_SUB[intent] || 'SEARCH_QUERY';
}

// Raqamli/analitik savol belgisi — qaysi SUXBAT sub-actionga borishni aniqlaydi.
function hasAnalyticsSignal(fields = {}) {
  return Boolean(fields?.analyticsMetric || fields?.analyticsPeriod);
}

// CLARIFY kerakmi? Gemini CLARIFY desa — uni ishlatamiz. Aks holda xavfsizlik to'ri:
// confidence < 0.7 bo'lsa har qanday high-level natija bo'yicha taxmin qilmay, so'raymiz.
function resolveClarify(understanding) {
  // Callback/continue to'g'ridan sub-intent bersa — hech qachon clarify qilmaymiz.
  if (SUB_INTENTS.includes(understanding?.intent)) return null;

  const conf = understanding?.confidence ?? 1;
  // Haqiqiy 2 tomonlama ikkilanish bormi? (2+ farqli subIntentli tugma).
  const distinctOptions = new Set(
    (understanding?.clarifyOptions || []).map((o) => o.subIntent).filter(Boolean)
  );
  const hasRealFork = distinctOptions.size >= 2;
  const clearSub = SUB_INTENTS.includes(understanding?.subIntent);

  if (understanding?.intent === 'CLARIFY') {
    // Soxta CLARIFY: model "CLARIFY" desa-da, aslida ishonchi yetarli, aniq bitta amal bor
    // va haqiqiy ikki tomonlama tanlov yo'q (mas. ravshan xarajat "yog' va guruch oldim").
    // Bunda taxmin emas — model o'zi aniqlagan amalni so'ramay bajaramiz.
    if (clearSub && !hasRealFork && conf >= CONFIDENCE_THRESHOLD) return null;
    return {
      question:
        understanding.clarifyingQuestion ||
        understanding.reply ||
        'Aniqlashtiring: bu nima haqida?',
      options: hasRealFork ? understanding.clarifyOptions : defaultClarifyOptions(understanding),
    };
  }

  if (conf < CONFIDENCE_THRESHOLD) {
    return { question: 'Buni qanday tushunay? Aniqlashtiring:', options: defaultClarifyOptions(understanding) };
  }
  return null;
}

// Gemini clarifyOptions bermasa — mazmunli zaxira tugmalar (taxmin qilingan amal birinchi).
function defaultClarifyOptions(understanding) {
  const guess = resolveAction(understanding);
  const base = [
    { label: 'Mijoz / xizmat', subIntent: 'SERVICE_ENTRY' },
    { label: 'Xarajat', subIntent: 'EXPENSE_ENTRY' },
    { label: 'Daromad', subIntent: 'INCOME_ENTRY' },
    { label: 'Material sotish', subIntent: 'MATERIAL_SALE' },
    { label: 'Buyum', subIntent: 'ITEM_ENTRY' },
    { label: "Mijoz to'lovi", subIntent: 'PAYMENT_UPDATE' },
    { label: 'Qidiruv / savol', subIntent: 'SEARCH_QUERY' },
  ];
  const ordered = [
    ...base.filter((o) => o.subIntent === guess),
    ...base.filter((o) => o.subIntent !== guess),
  ];
  return ordered.slice(0, 3);
}

// CLARIFY holatini conversationga yozadi (tugma callback'i shu yerdan davom ettiradi).
async function startClarify({ clarify, understanding, rawText, conversation }) {
  const options = clarify.options;
  if (conversation) {
    conversation.pendingIntent = 'CLARIFY';
    conversation.collected = { rawText, fields: understanding.fields || {}, options };
    conversation.awaitingField = 'clarifyChoice';
    conversation.markModified('collected');
    await conversation.save();
  }
  return { text: clarify.question, keyboard: clarifyKeyboard(options) };
}

// ── Valyuta (dollar/so'm) aniqlash va avtomatik konvertatsiya ────────────────
// Qaysi maydon pul summasi (intent bo'yicha).
const AMOUNT_KEY = { SERVICE_ENTRY: 'price', PARTNER_CONTRACT: 'price', EXPENSE_ENTRY: 'amount', INCOME_ENTRY: 'amount', MATERIAL_SALE: 'amount', ITEM_ENTRY: 'estimatedPrice', ITEM_SALE: 'amount', DEBT_REMINDER: 'amount' };
const USD_RE = /(\$|dollar|dollor|\bdoll?ar\b|\busd\b)/i;

function detectUsd(text) {
  return USD_RE.test(String(text || ''));
}

// Bu xabar summasini dollarda berdimi? Gemini 'currency'/'hasDollar' yoki matndagi $/dollar.
function signalsUsd(fields = {}, rawText = '') {
  return fields?.currency === 'USD' || fields?.hasDollar === true || detectUsd(rawText);
}

// Summa kelgan xabarning valyutasini collected.currency ga yozadi (faqat summa shu turda
// o'zgargan/birinchi marta kelgan bo'lsa — keyingi som korreksiya USD'ni o'chiradi va aksincha).
function trackEntryCurrency(intent, collected, prevAmount, fields, rawText) {
  const key = AMOUNT_KEY[intent];
  if (!key) return collected;
  const amount = collected[key];
  if (typeof amount !== 'number' || amount <= 0) return collected;
  if (amount !== prevAmount || collected.currency === undefined) {
    collected.currency = signalsUsd(fields, rawText) ? 'USD' : 'UZS';
  }
  return collected;
}

// USD bo'lsa kurs orqali so'mga aylantiradi va asl qiymatni eslab qoladi. Kurs bo'lmasa
// { needSom } qaytaradi (chaqiruvchi foydalanuvchidan so'mda so'raydi). IDEMPOTENT:
// aylantirgach currency='UZS' bo'ladi, qayta chaqirilsa hech narsa qilmaydi.
async function applyCurrencyConversion(intent, collected) {
  const key = AMOUNT_KEY[intent];
  if (!key) return { collected };
  const amount = collected[key];
  if (collected.currency !== 'USD' || typeof amount !== 'number' || amount <= 0) return { collected };
  const rate = await getUsdToUzsRate();
  if (!rate) return { collected, needSom: true, usdAmount: amount };
  const uzs = convertUsdToUzs(amount, rate);
  const converted = {
    ...collected,
    [key]: uzs,
    currency: 'UZS',
    originalAmount: amount,
    originalCurrency: 'USD',
    exchangeRateUsed: rate,
    _conversion: { originalAmount: amount, rate, uzsAmount: uzs },
  };
  if (intent === 'MATERIAL_SALE' && typeof collected.pricePerKg === 'number' && collected.pricePerKg > 0) {
    const pricePerKgUzs = convertUsdToUzs(collected.pricePerKg, rate);
    if (pricePerKgUzs) {
      converted.originalPricePerKg = collected.pricePerKg;
      converted.pricePerKg = pricePerKgUzs;
    }
  }
  return {
    collected: converted,
  };
}

// Kurs yo'q paytidagi zaxira: summa maydonini bo'shatib, so'mda qayta so'raydi.
async function currencyFallback({ conversation, intent, collected, usdAmount }) {
  const key = AMOUNT_KEY[intent];
  const cleaned = { ...collected };
  if (key) delete cleaned[key];
  delete cleaned.currency;
  delete cleaned._conversion;
  if (conversation) {
    conversation.pendingIntent = intent;
    conversation.collected = cleaned;
    conversation.awaitingField = key;
    conversation.markModified('collected');
    await conversation.save();
  }
  return {
    text: `Hozir dollar kursini ololmadim oka 😕\n${usdAmount}$ taxminan qancha so'm bo'ladi — so'mda yozib bering.`,
  };
}

// Manba (ovoz/matn) biriktiriladigan yozuv turlari: buyum, material sotuvi VA xarajat/kirim —
// Mini App'da tegishli kategoriya ichida asl ovozni qayta eshitish/matnini o'qish uchun.
const SOURCE_ATTACH_INTENTS = new Set(['ITEM_ENTRY', 'MATERIAL_SALE', 'EXPENSE_ENTRY', 'INCOME_ENTRY']);

function attachEntrySource(intent, fields, rawText, sourceMeta) {
  if (!SOURCE_ATTACH_INTENTS.has(intent)) return fields;
  const out = { ...fields };
  out.sourceText = out.sourceText || rawText || '';
  if (sourceMeta?.type === 'voice') {
    out.sourceType = 'voice';
    out.voiceTelegramFileId = sourceMeta.telegramFileId || null;
    out.voiceMimeType = sourceMeta.mimeType || null;
    out.voiceDuration = sourceMeta.duration || null;
    out.voiceMessageId = sourceMeta.messageId || null;
  } else if (!out.sourceType) {
    out.sourceType = 'text';
  }
  return out;
}

// ── MULTI-ENTRY: bitta xabarda bir nechta ALOHIDA yozuv ─────────────────────
// Kirim/chiqim/xizmat/material/buyum ARALASH bo'lishi mumkin ("Sardorga bordim 200 oldim,
// benzinga 50 ketdi"). Gemini fields.entries (normalizeMultiEntries dan o'tgan) 2+ bo'lak
// bersa — multi rejim. Ishonch past bo'lsa odatiy CLARIFY oqimi ishlaydi.
function resolveMultiEntries(understanding) {
  if (!understanding || understanding.intent === 'CLARIFY') return null;
  if ((understanding.confidence ?? 0) < CONFIDENCE_THRESHOLD) return null;
  const action = resolveAction(understanding);
  if (!MULTI_ENTRY_INTENTS.has(action)) return null;
  const entries = understanding.fields?.entries;
  if (!Array.isArray(entries) || entries.length < 2) return null;
  return entries;
}

// Bo'lakni ko'rsatish/tahrir/bekor uchun yagona meta shaklga keltiradi.
function buildMultiRecord({ kind, intent, ref, collected, result }) {
  const rec = { kind, intent, ref, amount: 0, category: null, name: null, description: '', quantityKg: null };
  if (intent === 'EXPENSE_ENTRY' || intent === 'INCOME_ENTRY') {
    rec.amount = result?.amount ?? collected.amount ?? 0;
    rec.category = result?.category || collected.category || null;
    rec.description = result?.description || collected.description || '';
  } else if (intent === 'SERVICE_ENTRY') {
    rec.amount = result?.price ?? collected.price ?? 0;
    rec.name = result?.clientName || collected.clientName || '';
  } else if (intent === 'MATERIAL_SALE') {
    rec.amount = result?.amount ?? collected.amount ?? 0;
    rec.name = result?.materialName || collected.materialName || '';
    rec.quantityKg = result?.quantityKg ?? collected.quantityKg ?? null;
  } else if (intent === 'ITEM_SALE') {
    rec.amount = result?.transaction?.amount ?? collected.amount ?? 0;
    rec.name = result?.item?.name || collected.itemName || '';
  } else if (intent === 'ITEM_GIVEAWAY') {
    rec.name = result?.item?.name || collected.itemName || '';
  }
  return rec;
}

// Har bir bo'lakni XUDDI YAKKA kelgandek tayyorlab (sana korreksiyasi, ovoz-manba,
// defaults, hamkor standartlari, valyuta), alohida yozuv qilib DARHOL saqlaydi. So'ng
// bitta umumiy ro'yxat-xulosa + [Tahrirlash/Bekor/Ilova] tugmalari. Bekor — hammasini
// (yoki "2-sini bekor qil" — bittasini); tahrir — raqami/nomi bilan bittasini.
// Identifikatsiyasi yetmagan bo'lak boshqalarini TO'XTATMAYDI — saqlangach, birinchi
// chala bo'lak uchun odatiy so'rash oqimi boshlanadi.
async function handleMultiEntry({ conversation, entries, fields, rawText, mode, sourceMeta }) {
  // Dollar signali xabar darajasida — avval BARCHA bo'laklar tayyorlanadi (kurs yo'q
  // bo'lsa hech narsa saqlanmay so'mda so'raladi), keyin saqlash bosqichi boshlanadi.
  const usd = signalsUsd(fields, rawText);
  if (usd && !(await getUsdToUzsRate())) {
    return { text: "Hozir dollar kursini ololmadim oka 😕\nSummalarni so'mda yozib yuboring." };
  }

  // 1-bosqich: tayyorlash (hech narsa saqlanmaydi).
  const prepared = [];
  const incomplete = [];
  for (const entry of entries) {
    const intent = MULTI_ENTRY_KIND_TO_INTENT[entry.kind] || 'EXPENSE_ENTRY';
    const { kind, ...entryFields } = entry;
    let collected = applyDateTimeCorrection(intent, entryFields, rawText);
    collected = attachEntrySource(intent, mergeFields({}, collected), rawText, sourceMeta);
    collected = applyEntryDefaults(intent, collected);
    collected = await applyPartnerVisitDefaults(intent, collected);
    if (usd) {
      collected.currency = 'USD';
      const conv = await applyCurrencyConversion(intent, collected);
      if (conv.needSom) {
        return { text: "Hozir dollar kursini ololmadim oka 😕\nSummalarni so'mda yozib yuboring." };
      }
      collected = conv.collected;
    }
    if (!hasMinimumIdentity(intent, collected)) {
      incomplete.push({ intent, collected, kind });
      continue;
    }
    prepared.push({ intent, collected, kind });
  }

  // 2-bosqich: saqlash — har bo'lak mavjud deterministik quvur orqali (yakka oqim bilan bir xil).
  const saved = [];
  const failed = [];
  for (const item of prepared) {
    const res = await executeToolFlow({ intent: item.intent, fields: item.collected, rawText, mode, conversation: null });
    if (res?.error) {
      failed.push({ intent: item.intent, message: res.text || 'saqlash xatosi' });
      continue;
    }
    if (res?.result?.needsConfirmation) {
      // Buyum nomi noaniq (bir nechta nomzod) — multi ichida tanlov oqimini ochmaymiz.
      failed.push({ intent: item.intent, message: `"${item.collected.itemName || 'buyum'}" nomi noaniq — uni alohida kiritib yuboring` });
      continue;
    }
    const ref = savedRefFromResult(item.intent, res?.result);
    saved.push(buildMultiRecord({ kind: item.kind, intent: item.intent, ref, collected: item.collected, result: res?.result }));
  }

  if (!saved.length && !incomplete.length) {
    if (conversation) await conversation.reset();
    return {
      text: failed.length
        ? `Voy oka, yozuvlarni saqlay olmadim: ${failed.map((f) => f.message).join('; ')}`
        : "Voy oka, yozuvlarni saqlay olmadim. Qaytadan urinib ko'ring.",
      error: true,
    };
  }

  let summary = saved.length ? multiSavedSummaryText(saved) : '';
  if (failed.length) {
    summary += `${summary ? '\n' : ''}⚠️ ${failed.length} ta yozuv saqlanmadi: ${failed.map((f) => f.message).join('; ')}`;
  }

  // Chala bo'lak — birinchi bo'lak uchun odatiy slot-filling boshlanadi (saqlanganlar
  // allaqachon bazada; savol faqat chala bo'lakka tegishli).
  if (incomplete.length && conversation && mode === 'bot') {
    const first = incomplete[0];
    const ask = await startEntry({ conversation, intent: first.intent, fields: first.collected, rawText, mode, sourceMeta });
    const moreNote = incomplete.length > 1
      ? `❕ Yana ${incomplete.length - 1} ta bo'lak uchun ham ma'lumot yetarli emas — ularni alohida ayting.\n`
      : '';
    const text = `${summary ? `${summary}\n\n` : ''}${moreNote}${ask.text}`;
    return ask.keyboard ? { text, keyboard: ask.keyboard } : { text };
  }
  if (incomplete.length) {
    summary += `\n❕ ${incomplete.length} ta bo'lak uchun ma'lumot yetarli emas — ularni alohida kiritib yuboring.`;
  }

  // Post-save holati: Bekor — hammasi/bittasi; Tahrirlash — raqami/nomi bilan bittasi.
  // Yozuvlar ALLAQACHON bazada — holat saqlanmasa ham xulosa "saqlandi" bo'lib qaytadi
  // (faqat tugmalarsiz); sabab serverda loglanadi.
  if (conversation && mode === 'bot' && saved.length) {
    try {
      conversation.pendingIntent = 'ENTRY_SAVED';
      conversation.collected = {
        savedIntent: 'MULTI_ENTRY',
        saved: { type: 'multi', refs: saved.map((s) => s.ref).filter(Boolean) },
        entries: saved,
        rawText,
      };
      conversation.awaitingField = 'postSave';
      conversation.markModified('collected');
      await conversation.save();
      return { text: summary, keyboard: savedEntryKeyboard('EXPENSE_ENTRY'), tool: 'multi_entry', result: saved };
    } catch (err) {
      console.error('Multi-entry post-save holatida xato (yozuvlar saqlangan):', err?.stack || err?.message || err);
      return { text: summary, tool: 'multi_entry', result: saved };
    }
  }

  return { text: summary, tool: 'multi_entry', result: saved };
}

// SERVICE_ENTRY vaqtini to'g'rilaydi: model serviceDateTime ni UTC sifatida (xato mintaqada)
// bergan bo'lsa, foydalanuvchi aytgan aniq soatga qaytaramiz ("soat 11" -> 16:00 emas, 11:00).
function applyDateTimeCorrection(intent, fields, rawText) {
  if (intent !== 'SERVICE_ENTRY' || !fields?.serviceDateTime) return fields;
  const corrected = correctServiceDateTime(fields.serviceDateTime, rawText);
  if (corrected && corrected !== fields.serviceDateTime) {
    return { ...fields, serviceDateTime: corrected };
  }
  return fields;
}

// Foydalanuvchi TO'XTATDI ("boshqa so'rama", "shu yetadi" yoki Gemini stopAsking) —
// qolgan maydonlar so'ralmay, mavjud ma'lumot bilan DARHOL saqlanadi. Faqat kamida
// bitta identifikatsiya maydoni bo'lishi shart, aks holda nima saqlanishi noaniq.
function stopRequested(understandingFields, rawText) {
  return understandingFields?.stopAsking === true || detectStopSignal(rawText);
}

// Identifikatsiya yetishmasa: saqlamaymiz — sababi bilan birinchi identifikatsiya maydonini so'raymiz.
async function askMinimumIdentity({ conversation, intent, collected }) {
  const keys = ENTRY_MINIMUM[intent] || [];
  const field = keys[0] || nextMissing(intent, collected);
  if (conversation) {
    conversation.pendingIntent = intent;
    conversation.collected = collected;
    conversation.awaitingField = field;
    conversation.markModified('collected');
    await conversation.save();
  }
  const labels = keys.map((k) => FIELD_LABELS[k] || k).join(' yoki ');
  const ask = field ? askField(field, intent) : { text: '' };
  return { text: `Tushunarli oka, lekin saqlash uchun kamida ${labels} kerak.\n${ask.text}`.trim(), keyboard: ask.keyboard };
}

async function startEntry({ conversation, intent, fields, rawText, mode, sourceMeta = null }) {
  fields = applyDateTimeCorrection(intent, fields, rawText);
  let collected = applyEntryDefaults(intent, attachEntrySource(intent, mergeFields({}, fields), rawText, sourceMeta));
  trackEntryCurrency(intent, collected, undefined, fields, rawText);
  collected = await applyPartnerVisitDefaults(intent, collected);

  // Birinchi xabardayoq "boshqa so'rama" desa — bor ma'lumot bilan darhol saqlaymiz.
  if (stopRequested(fields, rawText)) {
    if (!hasMinimumIdentity(intent, collected)) {
      return askMinimumIdentity({ conversation, intent, collected });
    }
    return finalizeEntry({ conversation, intent, collected, rawText, mode, stopped: true });
  }

  const missing = entryNextMissing(intent, collected);

  if (missing) {
    if (conversation) {
      conversation.pendingIntent = intent;
      conversation.collected = collected;
      conversation.awaitingField = missing;
      conversation.markModified('collected');
      await conversation.save();
    }
    return askField(missing, intent);
  }
  const soft = await maybeAskSoft({ conversation, intent, collected, mode });
  if (soft) return soft;
  return finalizeEntry({ conversation, intent, collected, rawText, mode });
}

// ── Hamkor (shartnomaviy) mijoz tashrifi ─────────────────────────────────────
// "Salat sexga bordim/boraman" — mijoz hamkor bo'lsa, standart narx/manzil avtomatik
// to'ldiriladi, telefon so'ralmaydi. Bir marta tekshiriladi (_partnerChecked bayrog'i);
// keyin ism kelsa (avval bo'sh bo'lgan bo'lsa) continueEntry qayta chaqiradi.
async function applyPartnerVisitDefaults(intent, collected) {
  if (intent !== 'SERVICE_ENTRY') return collected;
  if (collected._partnerChecked || !collected.clientName) return collected;
  const out = { ...collected, _partnerChecked: true };
  let partner = null;
  try {
    partner = await findPartnerByName(out.clientName);
  } catch (err) {
    // Qidiruv xatosi oddiy mijoz oqimini to'xtatmasin.
    console.warn('Hamkor qidiruvida xato:', err.message);
    return out;
  }
  if (!partner) return out;

  out._partnerVisit = true;
  out.clientName = partner.name; // kanonik nom ("salat sexga" -> "Salat sex")
  const filled = {};
  if (!hasValue('clientPhone', out) && partner.phone) out.clientPhone = partner.phone;
  if (!hasValue('price', out) && partner.partnerPrice > 0) {
    out.price = partner.partnerPrice;
    filled.price = true;
  }
  const hasLocation = out.location && (typeof out.location === 'string' ? out.location.trim() : out.location.address);
  if (!hasLocation && partner.partnerLocation?.address) {
    out.location = {
      address: partner.partnerLocation.address,
      mapUrl: partner.partnerLocation.mapUrl || null,
      coordinates: partner.partnerLocation.coordinates || null,
    };
    filled.location = true;
  }
  out._partnerFilled = filled;
  // Tarixiy ("bordim") tashrifda sana aytilmagan bo'lsa — hozirgi vaqt (tashrif hozir bo'ldi).
  if (out.isHistorical && !hasValue('serviceDateTime', out)) {
    out.serviceDateTime = new Date().toISOString();
  }
  return out;
}

// Hamkor tashrifida qo'shimcha savol berilmaydi: faqat KELAJAK reja uchun sana/vaqt
// (eslatma jadvali uchun shart) va standart narx yo'q bo'lsa narx so'raladi.
function entryNextMissing(intent, collected) {
  if (intent === 'SERVICE_ENTRY' && collected._partnerVisit) {
    if (!collected.isHistorical && !hasValue('serviceDateTime', collected)) return 'serviceDateTime';
    if (!hasValue('price', collected)) return 'price';
    return null;
  }
  return nextMissing(intent, collected);
}

// Material sotuvida kilo narxi yumshoq (bir martalik) so'raladi: miqdor va umumiy summa bor,
// lekin kilo narxi yo'q bo'lsa "1 kg necha pul?" deb so'raymiz. Javob shart emas — keyingi
// xabarda raqam bo'lmasa ham, _softAsked bayrog'i tufayli oqim qistab so'ramay yakunlanadi.
async function maybeAskSoft({ conversation, intent, collected, mode }) {
  if (mode !== 'bot') return null;
  const field = nextSoftAsk(intent, collected);
  if (!field || collected._softAsked) return null;
  collected._softAsked = true;
  if (conversation) {
    conversation.pendingIntent = intent;
    conversation.collected = collected;
    conversation.awaitingField = field;
    conversation.markModified('collected');
    await conversation.save();
  }
  return askField(field, intent);
}

async function continueEntry({ conversation, understanding, rawText, mode }) {
  if (/^(bekor|otmen|cancel|to'xtat|toxtat)/i.test((rawText || '').trim())) {
    await conversation.reset();
    return { text: 'Bekor qilindi.' };
  }

  // Material yumshoq (ixtiyoriy) so'rovi — kilo narxi — javobini ALOHIDA hal qilamiz:
  // SUXBAT pivoti yoki niyat korreksiyasiga BERMAYMIZ. Raqam bo'lsa kilo narxini yozamiz;
  // bo'lmasa (foydalanuvchi rad etsa) mavjud ma'lumot bilan darhol yakunlaymiz — qistab
  // so'ramaymiz (spec talabi).
  if (conversation.awaitingField === 'pricePerKg' && conversation.collected?._softAsked) {
    const intent = conversation.pendingIntent;
    const collected = applyEntryDefaults(intent, applyRawValue('pricePerKg', rawText, conversation.collected || {}));
    return finalizeEntry({ conversation, intent, collected, rawText, mode });
  }

  // Foydalanuvchi to'xtatdimi? ("boshqa so'rama", "shu yetadi", Gemini stopAsking) —
  // pivot/korreksiyaga bermay, shu xabardagi maydonlarni olib DARHOL saqlaymiz.
  const stopped = stopRequested(understanding?.fields, rawText);

  if (!stopped) {
    // SUXBAT pivoti: maydon to'ldirish o'rtasida foydalanuvchi savol/qidiruv bersa —
    // javob beramiz, keyin to'xtagan maydonni qayta so'raymiz. Sessiya saqlanadi.
    const pivot = await maybePivot({ conversation, understanding, rawText, mode });
    if (pivot) return pivot;

    // Niyat korreksiyasi: AI avval xato tushunib, foydalanuvchi darhol boshqa aniq niyatni
    // bildirsa — eski sessiyani tashlab, yangi niyatni shu zahoti ishga tushiramiz.
    if (maybeCorrectIntent({ conversation, understanding, rawText })) {
      await conversation.reset();
      return runAgent({ understanding, rawText, conversation, mode });
    }
  }

  const intent = conversation.pendingIntent;
  const amountKey = AMOUNT_KEY[intent];
  const prevAmount = amountKey ? conversation.collected?.[amountKey] : undefined;
  // Model bu xabarda serviceDateTime bergan bo'lsa, mintaqa xatosini birlashtirishdan oldin tuzatamiz.
  const incoming = applyDateTimeCorrection(intent, understanding.fields || {}, rawText);
  let prior = conversation.collected || {};
  // Hamkor standartidan AVTO-to'ldirilgan narx/manzilni foydalanuvchining shu xabardagi
  // ANIQ qiymati almashtira oladi (mergeFields bo'sh bo'lmaganini yozmaydi — shuning
  // uchun avto qiymatni oldindan bo'shatamiz; yangi qiymat keyin standartni ham yangilaydi).
  if (prior._partnerFilled) {
    prior = { ...prior };
    const filled = { ...prior._partnerFilled };
    if (filled.price && typeof incoming.price === 'number' && incoming.price > 0) {
      delete prior.price;
      delete filled.price;
    }
    if (filled.location && incoming.location) {
      delete prior.location;
      delete filled.location;
    }
    prior._partnerFilled = filled;
  }
  let collected = mergeFields(prior, incoming);

  // To'xtash xabarining o'zi maydon qiymati emas — uni so'ralayotgan maydonga yozmaymiz
  // ("boshqa so'rama" manzilga aylanib qolmasin).
  if (!stopped && conversation.awaitingField && !hasValue(conversation.awaitingField, collected)) {
    collected = applyRawValue(conversation.awaitingField, rawText, collected);
  }
  collected = applyEntryDefaults(intent, collected);
  // Summa shu turda kelgan/o'zgargan bo'lsa — valyutasini (USD/UZS) belgilab qo'yamiz.
  trackEntryCurrency(intent, collected, prevAmount, understanding.fields || {}, rawText);
  // Mijoz ismi endi kelgan bo'lsa — hamkorlik standartlarini shu yerda qo'llaymiz.
  collected = await applyPartnerVisitDefaults(intent, collected);

  if (stopped) {
    if (!hasMinimumIdentity(intent, collected)) {
      return askMinimumIdentity({ conversation, intent, collected });
    }
    return finalizeEntry({ conversation, intent, collected, rawText, mode, stopped: true });
  }

  const missing = entryNextMissing(intent, collected);
  if (missing) {
    conversation.collected = collected;
    conversation.awaitingField = missing;
    conversation.markModified('collected');
    await conversation.save();
    return askField(missing, intent);
  }

  const soft = await maybeAskSoft({ conversation, intent, collected, mode });
  if (soft) return soft;

  return finalizeEntry({ conversation, intent, collected, rawText, mode });
}

// Saqlangan yozuvga ko'rsatkich (post-save tahrir/bekor uchun) — tool natijasidan.
// null qaytsa post-save bosqichi ko'rsatilmaydi (hech narsa saqlanmagan).
function savedRefFromResult(intent, toolResult) {
  if (!toolResult) return null;
  switch (intent) {
    case 'SERVICE_ENTRY':
      return toolResult.id ? { type: 'service', serviceId: String(toolResult.id) } : null;
    case 'PARTNER_CONTRACT':
      return toolResult.client?._id
        ? {
            type: 'partner',
            clientId: String(toolResult.client._id),
            created: !!toolResult.created,
            prev: toolResult.prev || null,
          }
        : null;
    case 'EXPENSE_ENTRY':
    case 'INCOME_ENTRY':
    case 'MATERIAL_SALE':
      return toolResult._id ? { type: 'transaction', transactionId: String(toolResult._id) } : null;
    case 'ITEM_ENTRY':
      return toolResult._id ? { type: 'item', itemId: String(toolResult._id) } : null;
    case 'ITEM_SALE':
      return toolResult.transaction?._id
        ? {
            type: 'item_sale',
            transactionId: String(toolResult.transaction._id),
            itemId: toolResult.item?._id ? String(toolResult.item._id) : null,
          }
        : null;
    case 'ITEM_GIVEAWAY':
      return toolResult.item?._id ? { type: 'item_giveaway', itemId: String(toolResult.item._id) } : null;
    case 'DEBT_REMINDER':
      return toolResult.reminder?._id
        ? {
            type: 'reminder',
            reminderId: String(toolResult.reminder._id),
            transactionId: toolResult.reminder.transactionId ? String(toolResult.reminder.transactionId) : null,
          }
        : null;
    default:
      return null;
  }
}

// Ma'lumot yig'ilgach (yoki foydalanuvchi to'xtatgach) — DARHOL saqlanadi (MongoDB'ga
// yoziladi, kirim bo'lsa balans avtomatik qamraydi). "Ha/Yo'q" tasdig'i YO'Q. Saqlangach
// xulosa + 3 tugma ko'rsatiladi: [✏️ Tahrirlash][❌ Bekor qilish][📱 Ilovaga o'tish].
async function finalizeEntry({ conversation, intent, collected, rawText, mode, stopped = false }) {
  // Dollar bo'lsa — so'mga aylantiramiz (yoki kurs yo'q bo'lsa so'mda qayta so'raymiz).
  const conv = await applyCurrencyConversion(intent, collected);
  if (conv.needSom) {
    if (intent === 'ITEM_ENTRY') {
      delete collected.estimatedPrice;
      delete collected.currency;
      conv.collected = collected;
    } else {
      return currencyFallback({ conversation, intent, collected, usdAmount: conv.usdAmount });
    }
  }
  collected = conv.collected;

  const result = await executeToolFlow({ intent, fields: collected, rawText, mode, conversation });

  // Buyum nomi noaniq (ITEM_MATCH_CONFIRM) — hali saqlanmadi; tanlovdan keyin
  // confirmPendingUsefulItemMatch post-save bosqichini o'zi ko'rsatadi.
  if (conversation?.pendingIntent === 'ITEM_MATCH_CONFIRM') return result;

  if (result?.error) {
    if (conversation) await conversation.reset();
    return result;
  }

  const saved = savedRefFromResult(intent, result?.result);
  if (conversation && mode === 'bot' && saved) {
    return enterPostSaveState({ conversation, intent, collected, saved, rawText, stopped, toolResult: result });
  }

  if (conversation) await conversation.reset();
  return result;
}

// Saqlangan yozuv uchun post-save holatini yozadi va xulosa + 3 tugma javobini quradi.
async function enterPostSaveState({ conversation, intent, collected, saved, rawText, stopped = false, edited = false, toolResult = null }) {
  // MUHIM: yozuv ALLAQACHON MongoDB'da. Post-save holatini saqlash yiqilsa ham
  // egaga "xatolik" demaymiz (yozuv saqlangan!) — faqat tahrir/bekor tugmalari
  // ishlamasligi mumkin; sababi serverda loglanadi.
  let stateSaved = true;
  try {
    conversation.pendingIntent = 'ENTRY_SAVED';
    conversation.collected = { savedIntent: intent, fields: collected, saved, rawText, stopped };
    conversation.awaitingField = 'postSave';
    conversation.markModified('collected');
    await conversation.save();
  } catch (err) {
    stateSaved = false;
    console.error('Post-save holatini saqlashda xato (yozuv o\'zi saqlangan):', err?.stack || err?.message || err);
  }

  let text = savedSummaryText(intent, collected, { stopped, edited });
  // Xizmat saqlanganda eslatma/tasdiq jadvali haqidagi ma'lumot xulosaga qo'shiladi.
  if (intent === 'SERVICE_ENTRY' && toolResult?.result) {
    const info = reminderInfoLine(toolResult.result);
    if (info) text = `${text}\n${info}`;
  }
  // Buyum sotuvida ogohlantirish bo'lsa ("ro'yxatda yo'q edi") — ko'rsatamiz.
  if (toolResult?.result?.warning) text = `${text}\n⚠️ ${toolResult.result.warning}`;
  // Qarz balansga ta'sir qilgan bo'lsa — joriy balansni ko'rsatamiz.
  if (intent === 'DEBT_REMINDER' && toolResult?.result?.affectsBalance) {
    text = `${text}\n${collected.direction === 'taken' ? '💰' : '💸'} Joriy balans: ${formatMoney(toolResult.result.balanceAfter)}`;
  }

  // Holat saqlanmagan bo'lsa tugmalar ishlamaydi — tugmasiz, lekin "saqlandi" xulosasi bilan.
  if (!stateSaved) {
    return { text, tool: toolResult?.tool || null, result: toolResult?.result || null };
  }
  return { text, keyboard: savedEntryKeyboard(intent), tool: toolResult?.tool || null, result: toolResult?.result || null };
}

// Foydalanuvchi aytadigan "tahrir maydoni" -> yozuv maydoni (yakuniy tasdiqdagi tuzatish uchun).
const ENTRY_FIELD_KEYS = [
  'clientName', 'clientPhone', 'location', 'serviceDateTime', 'price', 'paymentMethod',
  'notes', 'isHistorical', 'amount', 'category', 'description', 'date', 'incomeSource',
  'materialName', 'quantityKg', 'pricePerKg', 'itemName', 'estimatedPrice', 'recipient',
  'person', 'dueDate', 'eventDate', 'direction', 'skipBalance', 'note',
];
const EDIT_FIELD_TO_ENTRY = {
  narx: 'money', narxi: 'money', price: 'money', pul: 'money', puli: 'money', haq: 'money', haqi: 'money',
  summa: 'money', summasi: 'money', amount: 'money',
  sana: 'date', sanasi: 'date', vaqt: 'date', date: 'date',
  manzil: 'location', location: 'location', address: 'location',
  ism: 'clientName', name: 'clientName',
  telefon: 'clientPhone', tel: 'clientPhone', phone: 'clientPhone', raqam: 'clientPhone',
  izoh: 'note', note: 'note', notes: 'note', description: 'note',
  toifa: 'category', category: 'category',
  material: 'materialName', materialname: 'materialName',
  miqdor: 'quantityKg', miqdori: 'quantityKg', kg: 'quantityKg', kilo: 'quantityKg',
  buyum: 'itemName', item: 'itemName', itemname: 'itemName',
  oluvchi: 'recipient', xaridor: 'recipient', recipient: 'recipient',
  taxminiy: 'estimatedPrice', baho: 'estimatedPrice',
  kim: 'person', person: 'person',
};

function normalizeEditFieldName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`'\u2018\u2019\u02bb]/g, "'")
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function moneyFieldForIntent(intent) {
  if (intent === 'SERVICE_ENTRY' || intent === 'PARTNER_CONTRACT') return 'price';
  if (intent === 'ITEM_ENTRY') return 'estimatedPrice';
  if (['EXPENSE_ENTRY', 'INCOME_ENTRY', 'MATERIAL_SALE', 'ITEM_SALE', 'DEBT_REMINDER'].includes(intent)) return 'amount';
  return 'amount';
}

function dateFieldForIntent(intent) {
  if (intent === 'SERVICE_ENTRY') return 'serviceDateTime';
  if (intent === 'DEBT_REMINDER') return 'dueDate';
  return 'date';
}

function noteFieldForIntent(intent) {
  if (['SERVICE_ENTRY', 'ITEM_ENTRY', 'ITEM_GIVEAWAY'].includes(intent)) return 'notes';
  if (intent === 'DEBT_REMINDER') return 'note';
  return 'description';
}

function parseEditDateValue(value, key) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = parseHumanDateTime(text);
  if (parsed && !Number.isNaN(parsed.getTime())) return parsed.toISOString();
  if (key === 'dueDate') {
    const due = parseUzbekDate(text);
    if (due && !Number.isNaN(due.getTime())) return due.toISOString();
  }
  const direct = new Date(text.replace(' ', 'T'));
  return Number.isNaN(direct.getTime()) ? null : direct.toISOString();
}

function editFieldToEntry(intent, rawField) {
  const field = normalizeEditFieldName(rawField);
  if (!field) return null;
  if (/(kilo|kg).*(narx|price|pul|haq)|(narx|price|pul|haq).*(kilo|kg)/.test(field)) return 'pricePerKg';
  const mapped = EDIT_FIELD_TO_ENTRY[field];
  if (mapped === 'money') return moneyFieldForIntent(intent);
  if (mapped === 'date') return dateFieldForIntent(intent);
  if (mapped === 'note') return noteFieldForIntent(intent);
  return mapped || null;
}

function pickEntryFields(fields = {}) {
  const out = {};
  for (const key of ENTRY_FIELD_KEYS) {
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== '') out[key] = fields[key];
  }
  return out;
}

// AI ajratgan maydonlarni mavjud yozuv USTIGA yozadi (overwrite); editField+newValue ham qo'llaniladi.
function buildEditedFields(intent, current, understanding) {
  const u = understanding?.fields || {};
  let fields = mergeFields(current, pickEntryFields(u), { overwrite: true });

  if (u.editField && u.newValue !== undefined && u.newValue !== null && u.newValue !== '') {
    const key = editFieldToEntry(intent, u.editField);
    if (['serviceDateTime', 'date', 'dueDate', 'eventDate'].includes(key)) {
      const iso = parseEditDateValue(u.newValue, key);
      if (iso) fields = mergeFields(fields, { [key]: iso }, { overwrite: true });
    } else if (key) {
      fields = mergeFields(fields, { [key]: u.newValue }, { overwrite: true });
    }
  }
  return applyEntryDefaults(intent, fields);
}

// Post-save tahrir: foydalanuvchi aytgan maydon(lar) ALLAQACHON SAQLANGAN yozuv ustida
// joyida yangilanadi (yangi yozuv yaratilmaydi), so'ng yangilangan xulosa xuddi shu
// 3 tugma bilan qayta ko'rsatiladi. Aytilmagan maydonlarni ham shu yerda to'ldirsa bo'ladi.
export async function editSavedEntry({ conversation, understanding, rawText = '' }) {
  const pending = conversation?.collected || {};
  const intent = pending.savedIntent;
  const saved = pending.saved;
  if (!conversation || conversation.pendingIntent !== 'ENTRY_SAVED' || !intent || !saved) {
    throw new Error("Tahrirlanadigan yozuv topilmadi");
  }
  // Multi-entry (bitta xabarda bir nechta kirim/chiqim) — yozuv raqami/toifasi bo'yicha
  // ANIQ bittasi tahrirlanadi.
  if (intent === 'MULTI_ENTRY') {
    return editMultiSavedEntry({ conversation, understanding, rawText });
  }
  let updated = applyDateTimeCorrection(intent, buildEditedFields(intent, pending.fields || {}, understanding), rawText);

  // Summa tahrirlangan bo'lsa — valyutani shu tahrirdan qayta baholaymiz va eski
  // konvertatsiya izlarini tozalaymiz (dollar→so'm yoki so'm→so'm to'g'ri ko'rinsin).
  const amountKey = AMOUNT_KEY[intent];
  const u = understanding?.fields || {};
  const editedKey = u.editField ? EDIT_FIELD_TO_ENTRY[String(u.editField).toLowerCase()] : null;
  const touchedAmount = amountKey && (u[amountKey] !== undefined || editedKey === amountKey);
  if (touchedAmount) {
    updated = { ...updated, currency: signalsUsd(u, rawText) ? 'USD' : 'UZS' };
    delete updated.originalAmount;
    delete updated.originalCurrency;
    delete updated.exchangeRateUsed;
    delete updated._conversion;
    const conv = await applyCurrencyConversion(intent, updated);
    if (conv.needSom) {
      // Kurs yo'q — saqlangan yozuvga tegmaymiz, so'mda qayta so'raymiz (holat saqlanadi).
      return { text: `Hozir dollar kursini ololmadim oka 😕\n${conv.usdAmount}$ taxminan qancha so'm bo'ladi — so'mda yozib bering.` };
    }
    updated = conv.collected;
  }

  // O'zgarishlarni SAQLANGAN yozuvga qo'llaymiz (intentga qarab tegishli service funksiyasi).
  await applySavedEntryUpdate(intent, saved, updated, pending.fields || {});

  return enterPostSaveState({
    conversation,
    intent,
    collected: updated,
    saved,
    rawText: pending.rawText || rawText,
    stopped: false,
    edited: true,
  });
}

// ── Multi-entry tahriri / qisman bekor ───────────────────────────────────────
// Qaysi yozuv nazarda tutilganini topadi: (1) tartib raqami ("2-sini", "2-yozuvni",
// "ikkinchisini"), (2) toifa nomi ("benzinni ..."), (3) nom (mijoz/material/buyum),
// (4) izoh so'zi. Aniq BITTA moslik bo'lsagina qaytaradi.
const WORD_ORDINALS = {
  birinchi: 1, ikkinchi: 2, uchinchi: 3, tortinchi: 4, beshinchi: 5,
  oltinchi: 6, yettinchi: 7, sakkizinchi: 8, toqqizinchi: 9, oninchi: 10,
};

export function findMultiEntryTarget(records, understanding, rawText) {
  const text = String(rawText || '').toLowerCase().replace(/[`‘’ʻʼ]/g, "'");
  const plain = text.replace(/'/g, '');

  // 1) Tartib raqami: "2-sini", "2-yozuvni", "2 chi", "ikkinchisini".
  let idx = null;
  const hyph = text.match(/\b(\d{1,2})\s*[-–]\s*(?:si\w*|chi\w*|inchi\w*|nchi\w*|yozuv\w*)?/);
  if (hyph) idx = Number(hyph[1]) - 1;
  if (idx === null) {
    const spaced = text.match(/\b(\d{1,2})\s+(?:si\w*|chi\w*|yozuv\w*)/);
    if (spaced) idx = Number(spaced[1]) - 1;
  }
  if (idx === null) {
    for (const [word, n] of Object.entries(WORD_ORDINALS)) {
      if (plain.includes(word)) {
        idx = n - 1;
        break;
      }
    }
  }
  if (idx !== null) {
    // Raqam aniq aytilgan — ro'yxatdan tashqarida bo'lsa taxmin qilmaymiz (ro'yxat qayta so'raladi).
    return records[idx] ? { index: idx, record: records[idx] } : null;
  }

  // 2) Toifa nomi (chiqim yozuvlari).
  const uCat = understanding?.fields?.category;
  const byCategory = [];
  records.forEach((r, i) => {
    const key = expenseKey(r.category || '');
    if (!key) return;
    if ((uCat && expenseKey(uCat) === key) || (key.length >= 3 && plain.includes(key))) {
      byCategory.push(i);
    }
  });
  if (byCategory.length === 1) return { index: byCategory[0], record: records[byCategory[0]] };

  // 3) Nom: mijoz / material / buyum ("Sardornikini ...", "televizorni ...").
  const uName = understanding?.fields?.itemName || understanding?.fields?.materialName
    || understanding?.fields?.clientName || understanding?.fields?.targetClientName || null;
  const byName = [];
  records.forEach((r, i) => {
    const key = String(r.name || '').toLowerCase().replace(/[`‘’ʻʼ']/g, '');
    if (!key || key.length < 3) return;
    const uKey = String(uName || '').toLowerCase().replace(/[`‘’ʻʼ']/g, '');
    if ((uKey && (uKey.includes(key) || key.includes(uKey))) || plain.includes(key)) byName.push(i);
  });
  if (byName.length === 1) return { index: byName[0], record: records[byName[0]] };

  // 4) Izoh so'zi.
  const byDescription = [];
  records.forEach((r, i) => {
    const words = String(r.description || '').toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
    if (words.some((w) => text.includes(w))) byDescription.push(i);
  });
  if (byDescription.length === 1) return { index: byDescription[0], record: records[byDescription[0]] };

  return null;
}

// Bo'lak turiga mos emoji + qisqa nom (tanlov ro'yxati uchun).
function multiEntryPickList(records) {
  return records
    .map((r, i) => {
      const emoji = r.kind === 'income' ? '💰' : r.kind === 'service' ? '👤' : r.kind === 'material_sale' ? '♻️' : r.kind === 'item_sale' || r.kind === 'item_giveaway' ? '📦' : '💸';
      const label = r.name || (r.kind === 'income' ? 'Kirim' : CATEGORY_LABEL[r.category] || r.category || 'Boshqa');
      return `${i + 1}) ${emoji} ${formatMoney(r.amount || 0)} | ${label}`;
    })
    .join('\n');
}

// Multi-entry post-save tahriri: ko'rsatilgan yozuv ustida summa/toifa/izoh yangilanadi
// (yozuv turi bo'yicha to'g'ri service funksiyasi orqali — applySavedEntryUpdate), so'ng
// yangilangan umumiy xulosa qaytadi. Yozuv aniqlanmasa — raqamli ro'yxat bilan so'raydi.
async function editMultiSavedEntry({ conversation, understanding, rawText }) {
  const pending = conversation.collected || {};
  const records = Array.isArray(pending.entries) ? pending.entries : [];
  if (!records.length) throw new Error('Tahrirlanadigan yozuvlar topilmadi');

  const target = findMultiEntryTarget(records, understanding, rawText);
  if (!target) {
    return {
      text: `Oka, qaysi yozuvni o'zgartirishni aniq ayting (raqami yoki nomi bilan):\n${multiEntryPickList(records)}\nMasalan: "2-sini 120 ming qil" yoki "benzinni 120 ming qil".`,
      keyboard: savedEntryKeyboard('EXPENSE_ENTRY'),
    };
  }
  const rec = target.record;
  if (!rec.ref) {
    return { text: "Bu yozuvni bu yerda tahrirlab bo'lmaydi oka — Mini App orqali o'zgartiring." };
  }

  const u = understanding?.fields || {};
  let newAmount = [u.amount, u.price, u.paymentAmount].find((v) => typeof v === 'number' && v > 0) || null;
  if (!newAmount) {
    // "2-sini 120 ming qil" — model summani newValue'ga qo'yishi ham mumkin.
    const m = parseMoney(u.newValue);
    if (m > 0) newAmount = m;
  }
  if (newAmount && signalsUsd(u, rawText)) {
    const rate = await getUsdToUzsRate();
    if (!rate) return { text: "Hozir dollar kursini ololmadim oka 😕 Summani so'mda ayting." };
    newAmount = convertUsdToUzs(newAmount, rate);
  }

  const moneyKey = moneyFieldForIntent(rec.intent);
  const data = {};
  if (newAmount > 0 && newAmount !== rec.amount) data[moneyKey] = newAmount;
  // Toifa faqat MAQSADLI yozuvdan farq qilsa yangilanadi (toifa nomi ko'pincha yozuvni
  // TOPISH uchun aytiladi — uni o'zgartirish deb tushunmaymiz).
  if (
    (rec.intent === 'EXPENSE_ENTRY' || rec.intent === 'INCOME_ENTRY') &&
    u.category &&
    expenseKey(u.category) !== expenseKey(rec.category || '')
  ) {
    data.category = u.category;
  }
  if (u.description && u.description !== rec.description) data.description = u.description;
  if (rec.intent === 'MATERIAL_SALE') {
    if (typeof u.quantityKg === 'number' && u.quantityKg > 0) data.quantityKg = u.quantityKg;
    if (typeof u.pricePerKg === 'number' && u.pricePerKg > 0) data.pricePerKg = u.pricePerKg;
  }

  if (!Object.keys(data).length) {
    return {
      text: `${target.index + 1}-yozuvda nimani o'zgartirishni tushunmadim oka. Masalan: "${target.index + 1}-sini 120 ming qil".`,
      keyboard: savedEntryKeyboard('EXPENSE_ENTRY'),
    };
  }

  await applySavedEntryUpdate(rec.intent, rec.ref, data, {});
  records[target.index] = {
    ...rec,
    amount: data[moneyKey] ?? rec.amount,
    category: data.category
      ? rec.intent === 'INCOME_ENTRY'
        ? normalizeIncomeCategory(data.category)
        : normalizeExpenseCategory(data.category)
      : rec.category,
    description: data.description ?? rec.description,
    quantityKg: data.quantityKg ?? rec.quantityKg,
  };
  conversation.collected = { ...pending, entries: records };
  conversation.awaitingField = 'postSave';
  conversation.markModified('collected');
  await conversation.save();

  return {
    text: `Bo'ldi oka, ${target.index + 1}-yozuvni yangiladim ✅\n\n${multiSavedSummaryText(records)}`,
    keyboard: savedEntryKeyboard('EXPENSE_ENTRY'),
  };
}

// Multi-entry post-save matni: "2-sini bekor qil" / "benzinni o'chir" / "hammasini bekor" —
// bekor fe'li bo'lsa mos yozuv(lar) o'chiriladi. Bekor fe'li bo'lmasa null (odatiy routing).
const MULTI_CANCEL_VERB_RE = /(bekor|o'?chir|olib\s+tashla|отмен|удал)/i;
const MULTI_CANCEL_ALL_RE = /(hammasi|barchasi|\bhamma\b|всё|все)/i;

export async function handleMultiSavedText({ conversation, text }) {
  const pending = conversation?.collected || {};
  if (conversation?.pendingIntent !== 'ENTRY_SAVED' || pending.savedIntent !== 'MULTI_ENTRY') return null;
  const raw = String(text || '');
  if (!MULTI_CANCEL_VERB_RE.test(raw)) return null;

  const records = Array.isArray(pending.entries) ? pending.entries : [];
  if (MULTI_CANCEL_ALL_RE.test(raw) || !records.length) {
    return cancelSavedEntry({ conversation });
  }
  const target = findMultiEntryTarget(records, null, raw);
  if (!target) {
    return {
      text: `Qaysi birini bekor qilay oka?\n${multiEntryPickList(records)}\n"2-sini bekor qil" yoki "hammasini bekor qil" deng.`,
      keyboard: savedEntryKeyboard('EXPENSE_ENTRY'),
    };
  }
  if (target.record.ref) await undoSavedEntry(target.record.ref);
  records.splice(target.index, 1);
  if (!records.length) {
    await conversation.reset();
    return { text: "Bo'ldi oka, yozuvlarni o'chirdim ✅" };
  }
  conversation.collected = {
    ...pending,
    entries: records,
    saved: { type: 'multi', refs: records.map((r) => r.ref).filter(Boolean) },
  };
  conversation.awaitingField = 'postSave';
  conversation.markModified('collected');
  await conversation.save();
  return {
    text: `Bo'ldi oka, o'chirdim ✅\n\n${multiSavedSummaryText(records)}`,
    keyboard: savedEntryKeyboard('EXPENSE_ENTRY'),
  };
}

// Tahrirlangan maydonlarni saqlangan yozuvga o'tkazadi. Faqat QIYMATI BOR maydonlar
// yuboriladi — bo'sh qolganlari yozuvda ham bo'sh qoladi (majburlanmaydi).
async function applySavedEntryUpdate(intent, saved, fields, prevFields = {}) {
  if (intent === 'PARTNER_CONTRACT') {
    // Saqlangan shartnoma tahriri: hamkorning standart qiymatlari yangilanadi.
    const data = { isPartner: true };
    if (fields.clientName && fields.clientName !== prevFields.clientName) data.name = fields.clientName;
    if (hasValue('clientPhone', fields)) data.phone = fields.clientPhone;
    if (hasValue('price', fields)) data.partnerPrice = fields.price;
    const address = fields.location?.address || fields.location;
    if (address && address !== (prevFields.location?.address || prevFields.location)) {
      data.partnerLocation = fields.location;
    }
    await updateClient(saved.clientId, data);
    return;
  }
  if (intent === 'SERVICE_ENTRY') {
    const data = {};
    if (fields.clientName) data.clientName = fields.clientName;
    if (hasValue('clientPhone', fields)) data.clientPhone = fields.clientPhone;
    const address = fields.location?.address || fields.location;
    if (address) data.location = fields.location;
    if (hasValue('serviceDateTime', fields)) data.serviceDateTime = fields.serviceDateTime;
    if (hasValue('price', fields)) data.price = fields.price;
    if (fields.notes !== undefined && fields.notes !== prevFields.notes) data.notes = fields.notes;
    if (fields.isHistorical !== undefined && fields.isHistorical !== prevFields.isHistorical) data.isHistorical = fields.isHistorical;
    await editService(saved.serviceId, data);
    return;
  }
  if (intent === 'EXPENSE_ENTRY' || intent === 'INCOME_ENTRY' || intent === 'MATERIAL_SALE') {
    const data = {};
    if (hasValue('amount', fields)) data.amount = fields.amount;
    if (fields.date) data.date = fields.date;
    if ((intent === 'EXPENSE_ENTRY' || intent === 'INCOME_ENTRY') && fields.category) data.category = fields.category;
    const desc = fields.description ?? fields.notes;
    if (desc !== undefined && desc !== (prevFields.description ?? prevFields.notes)) data.description = desc;
    if (intent === 'MATERIAL_SALE') {
      if (fields.materialName && fields.materialName !== prevFields.materialName) data.materialName = fields.materialName;
      if (hasValue('quantityKg', fields) && fields.quantityKg !== prevFields.quantityKg) data.quantityKg = fields.quantityKg;
      if (hasValue('pricePerKg', fields) && fields.pricePerKg !== prevFields.pricePerKg) data.pricePerKg = fields.pricePerKg;
    }
    await updateTransaction(saved.transactionId, data);
    return;
  }
  if (intent === 'ITEM_ENTRY') {
    await updateUsefulItem(saved.itemId, {
      itemName: fields.itemName !== prevFields.itemName ? fields.itemName : undefined,
      estimatedPrice: hasValue('estimatedPrice', fields) ? fields.estimatedPrice : undefined,
      notes: fields.notes !== prevFields.notes ? fields.notes : undefined,
      acquiredAt: fields.date !== prevFields.date ? fields.date : undefined,
    });
    return;
  }
  if (intent === 'ITEM_SALE') {
    await updateItemSale(saved, {
      itemName: fields.itemName !== prevFields.itemName ? fields.itemName : undefined,
      amount: hasValue('amount', fields) ? fields.amount : undefined,
      recipient: fields.recipient !== prevFields.recipient ? fields.recipient : undefined,
      date: fields.date !== prevFields.date ? fields.date : undefined,
    });
    return;
  }
  if (intent === 'ITEM_GIVEAWAY') {
    if (saved.itemId) {
      await updateUsefulItem(saved.itemId, {
        itemName: fields.itemName !== prevFields.itemName ? fields.itemName : undefined,
        recipient: fields.recipient !== prevFields.recipient ? fields.recipient : undefined,
        notes: fields.notes !== prevFields.notes ? fields.notes : undefined,
        closedAt: fields.date !== prevFields.date ? fields.date : undefined,
      });
    }
    return;
  }
  if (intent === 'DEBT_REMINDER') {
    const result = await updateDebtReminder(saved.reminderId, {
      person: fields.person !== prevFields.person ? fields.person : undefined,
      amount: hasValue('amount', fields) ? fields.amount : undefined,
      dueDate: hasValue('dueDate', fields) ? fields.dueDate : undefined,
      direction: fields.direction !== prevFields.direction ? fields.direction : undefined,
      note: fields.note !== prevFields.note ? fields.note : undefined,
      affectsBalance: hasValue('amount', fields) ? fields.skipBalance !== true : undefined,
    });
    // Balans tranzaksiyasi keyin yaratilgan/bekor qilingan bo'lishi mumkin — ref yangilanadi.
    if (result?.reminder) saved.transactionId = result.reminder.transactionId ? String(result.reminder.transactionId) : null;
    return;
  }
  throw new Error("Bu yozuv turini tahrirlab bo'lmaydi");
}

// Post-save "Bekor qilish": ALLAQACHON saqlangan yozuv o'chiriladi (soft delete).
// 1990-kod SO'RALMAYDI — bu hozirgina kiritilgan, hali hech kim ko'rmagan yozuv.
export async function cancelSavedEntry({ conversation }) {
  const pending = conversation?.collected || {};
  const saved = pending.saved;
  if (!conversation || conversation.pendingIntent !== 'ENTRY_SAVED' || !saved) {
    throw new Error("Bekor qilinadigan yozuv topilmadi");
  }
  await undoSavedEntry(saved);
  await conversation.reset();
  return {
    text: saved.type === 'multi'
      ? "Bo'ldi oka, hammasini o'chirdim — hech narsa saqlanmadi ✅"
      : "Bo'ldi oka, yozuvni o'chirdim — hech narsa saqlanmadi ✅",
  };
}

async function undoSavedEntry(saved) {
  switch (saved.type) {
    case 'service':
      await softDeleteServiceCascade(saved.serviceId);
      return;
    case 'partner':
      // Yangi yaratilgan hamkor o'chiriladi; mavjud mijoz oldingi holatiga qaytariladi.
      await revertPartnerContract(saved);
      return;
    case 'transaction':
      await softDeleteTransaction(saved.transactionId);
      return;
    case 'multi':
      // Bitta xabarda saqlangan BARCHA yozuvlar bekor qilinadi — har bir ref o'z turi
      // bo'yicha (xizmat kaskadi, tranzaksiya, buyum sotuvi revert...) qaytariladi.
      for (const ref of saved.refs || []) {
        try {
          await undoSavedEntry(ref);
        } catch {
          /* allaqachon o'chirilgan bo'lishi mumkin — qolganlarini davom ettiramiz */
        }
      }
      return;
    case 'item':
      await softDeleteUsefulItem(saved.itemId);
      return;
    case 'item_sale':
      await revertItemSale(saved);
      return;
    case 'item_giveaway':
      await revertItemGiveaway(saved.itemId);
      return;
    case 'reminder':
      await deleteReminder(saved.reminderId);
      return;
    default:
      throw new Error("Bu yozuv turini bekor qilib bo'lmaydi");
  }
}

// Tahrir/tuzatish ohangini bildiradigan so'zlar — bular bo'lsa xabar SAQLANGAN yozuv
// tuzatishi, yangi yozuv emas ("650 emas 700 edi", "narxini o'zgartir", "xato yozibsan").
const CORRECTION_RE = /(\bemas\b|xato|noto'?g'?ri|to'?g'?irla|to'?g'?rila|o'?zgartir|almashtir|tahrir|aslida|adash|\bqil\b)/i;

// Shu intentning o'zi bilan kelgan xabar O'ZI TO'LIQ yangi yozuvmi? (summa bor — bu
// hasConcreteSignal'da tekshirilgan; xarajat/kirimda qo'shimcha ravishda o'z mazmuni —
// toifa yoki izoh — ham bo'lishi shart, aks holda "700 ming" kabi yalang'och summa
// saqlangan yozuv tuzatishi deb qoladi.)
function isSelfContainedEntry(action, f = {}) {
  if (action === 'EXPENSE_ENTRY') return Boolean(f.category || f.description);
  if (action === 'INCOME_ENTRY') return Boolean(f.category || f.description);
  return true;
}

// Post-save holatda kelgan yangi xabar TAHRIRMI yoki YANGI BUYRUQMI?
//  - SUXBAT (qidiruv/tahlil savoli) — yangi buyruq.
//  - Boshqa aniq WRITE amal (konkret maydonlari bilan) — yangi buyruq.
//  - XUDDI SHU intent, lekin o'zi to'liq yangi gap (summa + mazmun, tuzatish so'zisiz) —
//    yangi buyruq. (Avval bu holat tahrir deb olinib, ketma-ket aytilgan har bir xarajat
//    bitta yozuvni qayta-qayta yangilab yuborardi — foydalanuvchi ko'rgan asosiy bug.)
//  - SERVICE_EDIT/CLIENT_EDIT yoki qiymat maydonlari — tahrir.
export function classifyPostSaveMessage(understanding, savedIntent, rawText = '') {
  const action = resolveAction(understanding);
  const conf = understanding?.confidence ?? 0;
  const fields = understanding?.fields || {};
  // Multi-entry saqlangan bo'lsa, "shu intent" testi multi qamrovidagi barcha turlarga tegishli.
  const sameIntent = savedIntent === 'MULTI_ENTRY'
    ? MULTI_ENTRY_INTENTS.has(action)
    : action === savedIntent;
  if (PIVOT_SUBS.has(action) && conf >= CONFIDENCE_THRESHOLD) return 'new';
  // Shartnoma saqlangach darhol "X ga bordim/boraman" deyilishi tabiiy — bu tahrir emas,
  // YANGI tashrif (hasConcreteSignal talab qiladigan narx/sana/tel bu iborada bo'lmaydi).
  if (
    savedIntent === 'PARTNER_CONTRACT' &&
    action === 'SERVICE_ENTRY' &&
    fields.clientName &&
    conf >= CONFIDENCE_THRESHOLD
  ) {
    return 'new';
  }
  if (action === 'SERVICE_EDIT' || action === 'CLIENT_EDIT') return 'edit';
  if (
    WRITE_ACTIONS.has(action) &&
    !sameIntent &&
    conf >= CONFIDENCE_THRESHOLD &&
    hasConcreteSignal(action, fields)
  ) {
    return 'new';
  }
  if (
    sameIntent &&
    conf >= CONFIDENCE_THRESHOLD &&
    !fields.editField &&
    !CORRECTION_RE.test(String(rawText || '')) &&
    hasConcreteSignal(action, fields) &&
    isSelfContainedEntry(action, fields)
  ) {
    return 'new';
  }
  return 'edit';
}

async function handleStatusUpdate({ fields, rawText, conversation, mode }) {
  const identifier = fields.targetPhone || fields.clientPhone || fields.targetClientName || fields.clientName || fields.searchText;
  if (!identifier) {
    return { text: "Qaysi mijozning xizmati, oka? Ism yoki telefon raqamini yuboring." };
  }
  const disambiguation = await maybeDisambiguate({ fields, conversation, intent: 'STATUS_UPDATE' });
  if (disambiguation) return disambiguation;
  return executeToolFlow({ intent: 'STATUS_UPDATE', fields, rawText, mode });
}

async function handlePaymentUpdate({ fields, rawText, conversation, mode }) {
  const identifier = fields.targetPhone || fields.clientPhone || fields.targetClientName || fields.clientName;
  if (!identifier) return { text: "Qaysi mijoz to'lov qildi, oka? Ism yoki telefon raqamini yuboring." };
  if (!(fields.paymentAmount || fields.amount)) return { text: "Qancha to'lov qildi, oka?" };
  // To'lov dollarda aytilgan bo'lsa — so'mga aylantiramiz (kurs yo'q bo'lsa so'mda so'raymiz).
  if (signalsUsd(fields, rawText)) {
    const usd = fields.paymentAmount || fields.amount;
    const rate = await getUsdToUzsRate();
    if (!rate) return { text: `Hozir dollar kursini ololmadim oka 😕\n${usd}$ taxminan qancha so'm — so'mda ayting.` };
    const uzs = convertUsdToUzs(usd, rate);
    fields = { ...fields, paymentAmount: uzs, amount: uzs };
  }
  const disambiguation = await maybeDisambiguate({ fields, conversation, intent: 'PAYMENT_UPDATE' });
  if (disambiguation) return disambiguation;
  return executeToolFlow({ intent: 'PAYMENT_UPDATE', fields, rawText, mode });
}

// Bir xil ismli mijozlar bo'lsa, jimgina birinchisini olмay, tanlash so'raydi.
// Telefon berilgan bo'lsa (noyob) — aniqlik shart emas. Tanlov conversation'da
// saqlanadi; foydalanuvchi tugmani bossa, amal o'sha mijoz bilan davom etadi.
async function maybeDisambiguate({ fields, conversation, intent }) {
  const phone = fields.targetPhone || fields.clientPhone;
  if (phone) {
    const norm = normalizePhone(phone);
    if (norm && /^\+998\d{9}$/.test(norm)) return null;
  }
  const name = fields.targetClientName || fields.clientName || fields.targetIdentifier || fields.searchText;
  // Ism yo'q yoki telefonga o'xshasa (raqamli) — oddiy oqim hal qiladi.
  if (!name || /\d{5,}/.test(String(name))) return null;

  const candidates = await findClientsByName(name);
  if (candidates.length <= 1) return null;

  if (conversation) {
    conversation.pendingIntent = 'CLIENT_DISAMBIGUATION';
    conversation.collected = {
      disambIntent: intent,
      disambFields: fields,
      candidateIds: candidates.map((c) => String(c._id)),
    };
    conversation.awaitingField = 'chooseClient';
    conversation.markModified('collected');
    await conversation.save();
  }
  return {
    text: `Oka, "${name}" ismli bir nechta mijoz bor ekan. Qaysi biri?`,
    keyboard: clientPickKeyboard(candidates),
  };
}

// Mavjud xizmatni tahrirlash — topib, tasdiq so'raydi (Ha/Yo'q), keyin callback ijro etadi.
async function handleServiceEdit({ fields, rawText, conversation, mode }) {
  if (mode === 'query') return { text: "Tahrirlashni bot orqali qilamiz oka. Bu yer faqat qidiruv va tahlil uchun." };

  const identifier = fields.targetIdentifier || rawText;
  const fieldKey = SERVICE_EDIT_FIELD[String(fields.editField || '').toLowerCase()];
  if (!fieldKey) return { text: "Nimasini o'zgartiramiz oka? Narx, sana yoki manzilni ayting." };
  if (fields.newValue === null || fields.newValue === undefined || fields.newValue === '') {
    return { text: "Yangi qiymatni yozib bering, oka." };
  }

  const service = await findServiceByIdentifier(identifier);
  if (!service) return { text: "Bunaqa xizmatni topolmadim oka. Mijoz ismi, telefoni yoki sanasini aniqroq ayting." };

  // Narx dollarda aytilgan bo'lsa — so'mga aylantiramiz (kurs yo'q bo'lsa so'mda so'raymiz).
  let newValue = fields.newValue;
  if (fieldKey === 'price' && signalsUsd(fields, rawText)) {
    const usd = parseMoney(newValue);
    const rate = await getUsdToUzsRate();
    if (!rate) return { text: `Hozir dollar kursini ololmadim oka 😕\n${usd}$ qancha so'm — so'mda ayting.` };
    newValue = convertUsdToUzs(usd, rate);
  }

  const { data, display } = buildServiceEditData(fieldKey, newValue);
  if (data === null) return { text: "Yangi qiymatni tushunmadim oka, aniqroq yozing." };

  if (conversation) {
    conversation.pendingIntent = 'EDIT_CONFIRM';
    conversation.collected = { editType: 'service', targetId: String(service._id), data };
    conversation.awaitingField = 'confirmEdit';
    conversation.markModified('collected');
    await conversation.save();
  }

  const label = SERVICE_EDIT_LABEL[fieldKey] || fieldKey;
  const when = formatDateTime(service.serviceDateTime);
  return {
    text: `Oka, ${service.clientName} [${when}] xizmatining ${label}ini ${display} ga o'zgartiraymi?`,
    keyboard: editConfirmKeyboard(),
  };
}

async function handleClientEdit({ fields, rawText, conversation, mode }) {
  if (mode === 'query') return { text: "Tahrirlashni bot orqali qilamiz oka. Bu yer faqat qidiruv va tahlil uchun." };

  const identifier = fields.targetIdentifier || rawText;
  const fieldKey = CLIENT_EDIT_FIELD[String(fields.editField || '').toLowerCase()];
  if (!fieldKey) return { text: "Nimasini o'zgartiramiz oka? Ism yoki telefonni ayting." };
  if (fields.newValue === null || fields.newValue === undefined || fields.newValue === '') {
    return { text: "Yangi qiymatni yozib bering, oka." };
  }

  const disambiguation = await maybeDisambiguate({
    fields: { ...fields, targetIdentifier: identifier },
    conversation,
    intent: 'CLIENT_EDIT',
  });
  if (disambiguation) return disambiguation;

  const phone = normalizePhone(identifier);
  const client = await findClient({ name: phone === identifier ? '' : identifier, phone });
  if (!client) return { text: "Mijozni topolmadim oka. Ismi yoki telefonini aniqroq ayting." };

  let value = fields.newValue;
  if (fieldKey === 'phone') {
    value = normalizePhone(value);
    if (!value) return { text: "Telefon raqamini to'g'ri yozib bering oka. Masalan: 90 123 45 67" };
  }
  const data = { [fieldKey]: value };

  if (conversation) {
    conversation.pendingIntent = 'EDIT_CONFIRM';
    conversation.collected = { editType: 'client', targetId: String(client._id), data };
    conversation.awaitingField = 'confirmEdit';
    conversation.markModified('collected');
    await conversation.save();
  }

  const label = fieldKey === 'phone' ? 'telefon raqamini' : 'ismini';
  const display = fieldKey === 'phone' ? formatPhone(value) || value : value;
  return {
    text: `Oka, ${client.name} mijozning ${label} ${display} ga o'zgartiraymi?`,
    keyboard: editConfirmKeyboard(),
  };
}

const SERVICE_EDIT_LABEL = {
  price: 'narx',
  serviceDateTime: 'sana',
  location: 'manzil',
};

// Tahrir maydoni qiymatini normallashtiradi va ko'rsatish matnini qaytaradi.
function buildServiceEditData(fieldKey, rawValue) {
  if (fieldKey === 'price') {
    const num = parseMoney(rawValue);
    if (!num || num <= 0) return { data: null, display: '' };
    return { data: { price: num }, display: formatMoney(num) };
  }
  if (fieldKey === 'serviceDateTime') {
    const date = parseHumanDateTime(rawValue);
    if (!date || Number.isNaN(date.getTime())) return { data: null, display: '' };
    return { data: { serviceDateTime: date.toISOString() }, display: formatDateTime(date) };
  }
  // location
  const text = typeof rawValue === 'object' ? rawValue.address || '' : String(rawValue).trim();
  if (!text) return { data: null, display: '' };
  return { data: { location: text }, display: text };
}

// Tasdiqdan keyin (callback) tahrirni ijro etadi.
export async function applyConfirmedEdit({ editType, targetId, data }) {
  if (editType === 'service') {
    const service = await editService(targetId, data);
    return { editType, service: serializeService(service) };
  }
  if (editType === 'client') {
    const client = await updateClient(targetId, data);
    return { editType, client: serializeDoc(client) };
  }
  throw new Error('Noma\'lum tahrir turi');
}

// Tabiiy (LLM) javob faqat O'QISH so'rovlari uchun qiymatli — qidiruv/tahlil natijasini
// jonli xulosa qiladi. Yozuv amallari (create/update/...) shablon javob oladi: tez va aniq.
const LLM_RESPONSE_TOOLS = new Set([
  'search_data',
  'get_analytics',
  'get_balance',
  'get_services_by_identifier',
]);

async function executeToolFlow({ intent, fields, rawText, mode, conversation = null }) {
  // Niyat allaqachon tasniflangan, maydonlar normallashtirilgan — qaysi tool va qanday
  // argument kerakligini DETERMINISTIK aniqlaymiz. Avval qo'shimcha `chooseAgentTool`
  // Gemini chaqiruvi bor edi, lekin uning natijasi baribir faqat shu deterministik
  // tanlovga mos kelganda ishlatilardi (mos kelmasa tashlanardi) — ya'ni ortiqcha
  // kechikish edi. Olib tashladik: har amalda bitta to'liq Gemini chaqiruvi tejaldi.
  const toolCall = fallbackToolCall(intent, fields, rawText);

  let toolResult;
  try {
    toolResult = await executeAgentTool(toolCall.name, toolCall.args);
  } catch (err) {
    // Sabab serverda DOIM loglanadi (stack bilan) — "nega saqlanmadi" izsiz qolmasin.
    // Biznes xatosi (mas. "xizmat topilmadi") uchun status bor; texnik xatoda (DB uzildi,
    // validatsiya) ham egaga aniq xabar qaytadi.
    console.error(`Agent tool xatosi [${toolCall.name}]:`, err?.stack || err?.message || err);
    return { text: err?.message || "Voy oka, bir narsa chappa ketdi. Qaytadan urinib ko'ring.", tool: toolCall.name, error: true };
  }

  if (toolResult?.needsConfirmation && conversation && mode === 'bot') {
    conversation.pendingIntent = 'ITEM_MATCH_CONFIRM';
    conversation.collected = {
      action: toolResult.action,
      payload: toolResult.payload,
      candidates: toolResult.candidates,
    };
    conversation.awaitingField = 'itemMatch';
    conversation.markModified('collected');
    await conversation.save();
  }

  const fallbackText = fallbackResponse(toolCall.name, toolResult);

  // Yozuv amali — shablon javob (qo'shimcha Gemini chaqiruvisiz, tez). Faqat o'qish
  // so'rovida jonli xulosa uchun Gemini chaqiramiz; xato bo'lsa shablonga tushamiz.
  if (!LLM_RESPONSE_TOOLS.has(toolCall.name)) {
    return { text: fallbackText, tool: toolCall.name, result: toolResult };
  }

  try {
    const text = await formulateToolResponse({
      toolName: toolCall.name,
      toolArgs: toolCall.args,
      toolResult,
      rawText,
    });
    return { text: text || fallbackText, tool: toolCall.name, result: toolResult };
  } catch (err) {
    console.warn('Gemini response fallback:', err.message);
    return { text: fallbackText, tool: toolCall.name, result: toolResult };
  }
}

async function executeAgentTool(name, args) {
  switch (name) {
    case 'create_service':
      return serializeService(await createService(args));

    case 'upsert_partner_contract': {
      const { client, created, prev } = await upsertPartnerContract(args);
      return { client: serializeDoc(client), created, prev };
    }

    case 'update_service_status':
      return updateServiceStatus(args);

    case 'complete_service':
      return completeAgentService(args);

    case 'cancel_service':
      return cancelAgentService(args);

    case 'reschedule_service':
      return rescheduleAgentService(args);

    case 'edit_service':
      return editAgentService(args);

    case 'edit_client':
      return editAgentClient(args);

    case 'create_transaction':
      return createAgentTransaction(args);

    case 'create_useful_item':
      return serializeDoc(await createUsefulItem(args));

    case 'sell_useful_item':
      return sellUsefulItem(args);

    case 'give_useful_item':
      return giveAwayUsefulItem(args);

    case 'record_payment':
      return recordAgentPayment(args);

    case 'create_debt_reminder':
      return createDebtReminder(args);

    case 'search_data':
      return searchAgentData(args);

    case 'get_services_by_identifier':
      return getServicesByIdentifier(args);

    case 'get_analytics':
      return getAgentAnalytics(args);

    case 'get_balance':
      return getAgentBalance(args);

    default:
      throw new Error(`Noma'lum agent tool: ${name}`);
  }
}

async function updateServiceStatus(args) {
  const identifier = args.serviceIdentifier || '';
  const service = await findServiceByIdentifier(identifier);
  if (!service) throw new Error("Bunaqa xizmatni topolmadim oka. Mijoz ismini yoki telefonini aniqroq ayting.");

  if (args.status === SERVICE_STATUS.CANCELLED || args.status === 'cancelled') {
    return serializeService(await cancelService(service._id));
  }
  return serializeService(await completeService(service._id, { markPaid: true }));
}

async function completeAgentService(args) {
  const service = await findServiceByIdentifier(args.serviceIdentifier || '');
  if (!service) throw new Error("Bunaqa xizmatni topolmadim oka. Mijoz ismi, telefoni yoki sanasini aniqroq ayting.");
  return serializeService(await completeService(service._id, { markPaid: true }));
}

async function cancelAgentService(args) {
  const service = await findServiceByIdentifier(args.serviceIdentifier || '');
  if (!service) throw new Error("Bunaqa xizmatni topolmadim oka. Mijoz ismi, telefoni yoki sanasini aniqroq ayting.");
  return serializeService(await cancelService(service._id, args.reason || null));
}

async function rescheduleAgentService(args) {
  const service = await findServiceByIdentifier(args.serviceIdentifier || '');
  if (!service) throw new Error("Bunaqa xizmatni topolmadim oka. Mijoz ismi, telefoni yoki sanasini aniqroq ayting.");
  const date = parseHumanDateTime(args.newDateTime || '');
  if (!date || Number.isNaN(date.getTime())) throw new Error("Yangi vaqtni tushunmadim oka, aniqroq ayting.");
  return serializeService(await rescheduleService(service._id, date.toISOString()));
}

async function editAgentService(args) {
  const service = await findServiceByIdentifier(args.serviceIdentifier || '');
  if (!service) throw new Error("Bunaqa xizmatni topolmadim oka. Mijoz ismi, telefoni yoki sanasini aniqroq ayting.");
  const fieldKey = SERVICE_EDIT_FIELD[String(args.field || '').toLowerCase()];
  if (!fieldKey) throw new Error("Qaysi maydonni oka? Narx, sana yoki manzil.");
  let value = args.value;
  if (fieldKey === 'price' && signalsUsd(args, String(args.value ?? ''))) {
    const rate = await getUsdToUzsRate();
    if (!rate) throw new Error("Hozir dollar kursini ololmadim oka. So'mda ayting.");
    value = convertUsdToUzs(parseMoney(value), rate);
  }
  const { data } = buildServiceEditData(fieldKey, value);
  if (!data) throw new Error("Yangi qiymatni tushunmadim oka.");
  return serializeService(await editService(service._id, data));
}

async function editAgentClient(args) {
  const identifier = args.clientIdentifier || '';
  const phone = normalizePhone(identifier);
  const client = await findClient({ name: phone === identifier ? '' : identifier, phone });
  if (!client) throw new Error("Mijozni topolmadim oka.");
  const fieldKey = CLIENT_EDIT_FIELD[String(args.field || '').toLowerCase()];
  if (!fieldKey) throw new Error("Qaysi maydonni oka? Ism yoki telefon.");
  let value = args.value;
  if (fieldKey === 'phone') {
    value = normalizePhone(value);
    if (!value) throw new Error("Telefon raqami noto'g'ri oka.");
  }
  return serializeDoc(await updateClient(client._id, { [fieldKey]: value }));
}

async function getServicesByIdentifier(args) {
  const identifier = String(args.identifier || '').trim();
  const date = new Date(identifier);
  if (identifier && !Number.isNaN(date.getTime()) && /\d{4}-\d{2}-\d{2}/.test(identifier)) {
    const from = new Date(date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(date);
    to.setHours(23, 59, 59, 999);
    const services = await searchServices({ dateFrom: from, dateTo: to, limit: 20 });
    return { services: services.map(serializeService) };
  }
  const phone = normalizePhone(identifier);
  const services = await searchServices({ text: phone === identifier ? identifier : identifier, limit: 20 });
  return { services: services.map(serializeService) };
}

async function getAgentBalance(args) {
  const period = normalizePeriod(args.period);
  return { metric: 'balance', ...(await getSummary(period)) };
}

async function findServiceByIdentifier(identifier) {
  const text = String(identifier || '').trim();
  const date = new Date(text);
  if (text && !Number.isNaN(date.getTime())) {
    const from = new Date(date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(date);
    to.setHours(23, 59, 59, 999);
    const pending = await Service.findOne({
      isDeleted: { $ne: true },
      status: SERVICE_STATUS.PENDING,
      serviceDateTime: { $gte: from, $lte: to },
    }).sort({ serviceDateTime: 1 });
    if (pending) return pending;
    return Service.findOne({
      isDeleted: { $ne: true },
      serviceDateTime: { $gte: from, $lte: to },
    }).sort({ serviceDateTime: -1 });
  }

  const phone = normalizePhone(text);
  return findServiceForUpdate({
    name: phone === text ? '' : text,
    phone,
  });
}

async function createAgentTransaction(args) {
  const type = args.type === 'income' ? TX_TYPES.INCOME : TX_TYPES.EXPENSE;
  const isMaterial = type === TX_TYPES.INCOME && args.category === 'material';
  // Faqat aniq berilgan toifa normallashtiriladi — izohni toifaga aylantirmaymiz
  // (bo'sh bo'lsa createTransaction izoh kalit so'zlaridan taxmin qiladi yoki 'boshqa_chiqim').
  const category = isMaterial
    ? 'material'
    : type === TX_TYPES.EXPENSE && args.category
    ? normalizeExpenseCategoryForDb(args.category)
    : type === TX_TYPES.INCOME && args.category
    ? normalizeIncomeCategoryForDb(args.category)
    : null;
  const tx = await createTransaction({
    type,
    amount: args.amount,
    category,
    description: args.description || args.note || '',
    // Material sotuvi maydonlari (createTransaction kanonik nom + izohni quradi).
    materialName: isMaterial ? args.materialName : null,
    quantityKg: isMaterial ? args.quantityKg : null,
    pricePerKg: isMaterial ? args.pricePerKg : null,
    // Ovoz/manba har qanday tranzaksiyaga biriktiriladi (kategoriya ichida qayta eshitiladi).
    voiceTelegramFileId: args.voiceTelegramFileId || null,
    voiceMimeType: args.voiceMimeType || null,
    voiceDuration: args.voiceDuration || null,
    voiceMessageId: args.voiceMessageId || null,
    sourceText: args.sourceText || null,
    date: args.date || null,
    serviceId: args.serviceId || null,
    originalAmount: args.originalAmount ?? null,
    originalCurrency: args.originalCurrency ?? null,
    exchangeRateUsed: args.exchangeRateUsed ?? null,
  });
  return serializeDoc(tx);
}

async function recordAgentPayment(args) {
  const identifier = args.clientIdentifier || '';
  const phone = normalizePhone(identifier);
  const client = await findClient({
    name: phone === identifier ? '' : identifier,
    phone,
  });
  if (!client) throw new Error("Mijozni topolmadim oka. Ismini yoki telefonini aniqroq ayting.");

  const result = await recordServicePayment({
    clientId: client._id,
    amount: args.amount,
    note: args.note || '',
  });
  return {
    client: serializeDoc(client),
    service: serializeService(result.service),
    amountApplied: result.amountApplied,
  };
}

// Service funksiyalari sahifa bilan {items} obyekti yoki massiv qaytarishi mumkin —
// doim massivga keltirib, .filter/.slice xatosining oldini olamiz.
export async function confirmPendingUsefulItemMatch({ conversation, choiceText = '' }) {
  const state = conversation?.collected || {};
  const candidates = Array.isArray(state.candidates) ? state.candidates : [];
  if (!candidates.length || !state.action || !state.payload) throw new Error('Tasdiqlanadigan buyum topilmadi.');

  const normalized = String(choiceText || '').trim().toLowerCase();
  if (/^(yo'q|yoq|no|n|bekor|cancel)/i.test(normalized)) {
    await conversation.reset();
    return { text: 'Mayli oka, buyumga tegmadim.' };
  }

  let selected = null;
  const numberMatch = normalized.match(/\d+/);
  if (numberMatch) selected = candidates[Number(numberMatch[0]) - 1] || null;
  if (!selected && candidates.length === 1 && /^(ha|xa|yes|y|ok|mayli|shu)/i.test(normalized)) {
    selected = candidates[0];
  }
  if (!selected) {
    selected = candidates.find((item) => normalized && String(item.name || '').toLowerCase().includes(normalized));
  }
  if (!selected) return { text: itemMatchQuestion(candidates), keepPending: true };

  const result = await confirmUsefulItemAction({
    action: state.action,
    payload: state.payload,
    itemId: selected.id,
  });
  const intent = state.action === 'sell' ? 'ITEM_SALE' : 'ITEM_GIVEAWAY';
  // Endi haqiqatan saqlandi — post-save bosqichi (xulosa + Tahrirlash/Bekor/Ilova tugmalari).
  const saved = savedRefFromResult(intent, result);
  if (saved) {
    const collected = applyEntryDefaults(intent, mergeFields({}, state.payload || {}));
    return enterPostSaveState({
      conversation,
      intent,
      collected,
      saved,
      rawText: '',
      toolResult: { tool: state.action === 'sell' ? 'sell_useful_item' : 'give_useful_item', result },
    });
  }
  await conversation.reset();
  return { text: fallbackResponse(state.action === 'sell' ? 'sell_useful_item' : 'give_useful_item', result), result };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value?.items) ? value.items : [];
}

async function searchAgentData(args) {
  const query = args.query || '';
  const filters = args.filters || {};
  const services = asArray(await searchServices({
    text: query,
    dateFrom: filters.dateFrom || null,
    dateTo: filters.dateTo || null,
    limit: 20,
  }));
  // listClients/listTransactions sahifa bilan {items} obyekti, sahifasiz massiv qaytarishi
  // mumkin — bu yerda hammasini massivga keltiramiz, aks holda .filter/.slice "is not a function".
  const clients = asArray(await listClients({ search: query }));
  const transactions = asArray(await listTransactions({ period: 'all', limit: 50 }));
  const q = query.trim().toLowerCase();
  const filteredServices = filters.status
    ? services.filter((service) => service.status === filters.status)
    : services;
  const filteredTransactions = transactions.filter((tx) => {
    if (filters.type && tx.type !== filters.type) return false;
    if (!q) return true;
    return [tx.type, tx.category, tx.description, tx.clientName]
      .filter(Boolean)
      .some((value) => String(value).toLowerCase().includes(q));
  });

  return {
    services: filteredServices.slice(0, 20).map(serializeService),
    clients: clients.slice(0, 20).map(serializeDoc),
    transactions: filteredTransactions.slice(0, 20).map(serializeDoc),
  };
}

async function getAgentAnalytics(args) {
  const period = normalizePeriod(args.period);
  return { metric: args.metric || 'profit', ...(await getSummary(period)) };
}

function fallbackToolCall(intent, fields, rawText) {
  const name = TOOL_BY_INTENT[intent] || 'search_data';
  switch (name) {
    case 'create_service':
      return { name, args: serviceArgs(fields) };
    case 'upsert_partner_contract':
      return {
        name,
        args: {
          clientName: fields.clientName,
          clientPhone: fields.clientPhone || null,
          price: fields.price ?? null, // allaqachon so'mda (USD bo'lsa oldindan aylantirilgan)
          location: fields.location || null,
          notes: fields.notes || '',
        },
      };
    case 'update_service_status':
      return {
        name,
        args: {
          serviceIdentifier:
            fields.targetPhone || fields.clientPhone || fields.targetClientName || fields.clientName || fields.searchText || rawText,
          status: fields.newStatus || SERVICE_STATUS.DONE,
        },
      };
    case 'create_useful_item':
      return {
        name,
        args: {
          itemName: fields.itemName,
          estimatedPrice: fields.estimatedPrice ?? null,
          acquiredAt: fields.date || null,
          notes: fields.notes || '',
          sourceType: fields.sourceType || 'text',
          sourceText: fields.sourceText || rawText || '',
          voiceTelegramFileId: fields.voiceTelegramFileId || null,
          voiceMimeType: fields.voiceMimeType || null,
          voiceDuration: fields.voiceDuration || null,
          voiceMessageId: fields.voiceMessageId || null,
          originalAmount: fields.originalAmount ?? null,
          originalCurrency: fields.originalCurrency ?? null,
          exchangeRateUsed: fields.exchangeRateUsed ?? null,
        },
      };
    case 'sell_useful_item':
      return {
        name,
        args: {
          itemName: fields.itemName,
          amount: fields.amount,
          recipient: fields.recipient || null,
          date: fields.date || null,
          originalAmount: fields.originalAmount ?? null,
          originalCurrency: fields.originalCurrency ?? null,
          exchangeRateUsed: fields.exchangeRateUsed ?? null,
        },
      };
    case 'give_useful_item':
      return {
        name,
        args: {
          itemName: fields.itemName,
          recipient: fields.recipient || null,
          date: fields.date || null,
          notes: fields.notes || '',
        },
      };
    case 'create_transaction': {
      const isMaterial = intent === 'MATERIAL_SALE';
      return {
        name,
        args: {
          type: intent === 'INCOME_ENTRY' || isMaterial ? 'income' : 'expense',
          amount: fields.amount, // allaqachon so'mda
          category: isMaterial ? 'material' : fields.category,
          // Material izohi createTransaction'da toza qilib quriladi (nom · kg) — bu yerda bo'sh.
          description: isMaterial ? '' : (fields.description || fields.notes || fields.incomeSource || rawText),
          materialName: isMaterial ? fields.materialName || null : null,
          quantityKg: isMaterial ? fields.quantityKg ?? null : null,
          pricePerKg: isMaterial ? fields.pricePerKg ?? null : null,
          // Ovozli aytilgan bo'lsa — asl ovozni yozuvga biriktiramiz (material, xarajat, kirim).
          voiceTelegramFileId: fields.voiceTelegramFileId || null,
          voiceMimeType: fields.voiceMimeType || null,
          voiceDuration: fields.voiceDuration || null,
          voiceMessageId: fields.voiceMessageId || null,
          sourceText: fields.sourceText || rawText || '',
          date: fields.date || null,
          serviceId: fields.serviceId || null,
          originalAmount: fields.originalAmount ?? null,
          originalCurrency: fields.originalCurrency ?? null,
          exchangeRateUsed: fields.exchangeRateUsed ?? null,
        },
      };
    }
    case 'record_payment':
      return {
        name,
        args: {
          clientIdentifier: fields.targetPhone || fields.clientPhone || fields.targetClientName || fields.clientName || rawText,
          amount: fields.paymentAmount || fields.amount,
          note: fields.notes || '',
          date: fields.date || null,
        },
      };
    case 'create_debt_reminder':
      return {
        name,
        args: {
          type: 'debt',
          direction: fields.direction === 'taken' ? 'taken' : 'given',
          person: fields.person || fields.recipient || fields.clientName || '',
          amount: fields.amount, // allaqachon so'mda (kerak bo'lsa konvertatsiya qilingan)
          dueDate: fields.dueDate || null,
          eventDate: fields.eventDate || fields.date || null,
          // skipBalance true bo'lsa balansga tegmaymiz (egasi "balansdan minus qilma" dedi).
          affectsBalance: fields.skipBalance === true ? false : true,
          note: fields.note || fields.notes || '',
          originalAmount: fields.originalAmount ?? null,
          originalCurrency: fields.originalCurrency ?? null,
          exchangeRateUsed: fields.exchangeRateUsed ?? null,
        },
      };
    case 'get_analytics':
      return {
        name,
        args: {
          period: fields.analyticsPeriod || 'month',
          metric: fields.analyticsMetric || 'profit',
        },
      };
    case 'search_data':
    default:
      return {
        name: 'search_data',
        args: {
          query: fields.searchText || rawText || '',
          filters: {
            dateFrom: fields.dateFrom || null,
            dateTo: fields.dateTo || null,
          },
        },
      };
  }
}

function serviceArgs(fields) {
  return {
    clientName: fields.clientName,
    clientPhone: fields.clientPhone,
    location: fields.location,
    serviceDateTime: fields.serviceDateTime,
    price: fields.price, // allaqachon so'mda (kerak bo'lsa konvertatsiya qilingan)
    paymentMethod: fields.paymentMethod,
    notes: fields.notes || '',
    isHistorical: !!fields.isHistorical,
    images: fields.images || [],
    imageFileId: fields.imageFileId || null,
    // Asl valyuta (dollarda kelishilgan bo'lsa) — eslab qolish uchun.
    originalAmount: fields.originalAmount ?? null,
    originalCurrency: fields.originalCurrency ?? null,
    exchangeRateUsed: fields.exchangeRateUsed ?? null,
  };
}

function applyEntryDefaults(intent, fields) {
  const out = { ...fields };
  if (intent === 'EXPENSE_ENTRY') {
    if (!out.date) out.date = new Date().toISOString();
    if (out.category) out.category = normalizeExpenseCategoryForDb(out.category);
  }
  if (intent === 'INCOME_ENTRY') {
    if (!out.date) out.date = new Date().toISOString();
    if (out.category) out.category = normalizeIncomeCategoryForDb(out.category);
  }
  if (intent === 'MATERIAL_SALE') {
    if (!out.date) out.date = new Date().toISOString();
    // Foydalanuvchi aytgan UMUMIY summa ustun. Aytilmagan bo'lsa — miqdor*kilo narxidan
    // hisoblab qo'yamiz, shunda majburiy 'amount' to'ladi (qistab so'ramaymiz).
    if (
      !(typeof out.amount === 'number' && out.amount > 0) &&
      typeof out.quantityKg === 'number' && out.quantityKg > 0 &&
      typeof out.pricePerKg === 'number' && out.pricePerKg > 0
    ) {
      out.amount = Math.round(out.quantityKg * out.pricePerKg);
    }
  }
  if (intent === 'ITEM_ENTRY') {
    if (!out.date) out.date = new Date().toISOString();
    if (!out.sourceType) out.sourceType = 'text';
  }
  if (intent === 'ITEM_SALE' || intent === 'ITEM_GIVEAWAY') {
    if (!out.date) out.date = new Date().toISOString();
  }
  if (intent === 'DEBT_REMINDER') {
    // Qarz berish/olish voqea sanasi (balans tranzaksiyasi shu sanaga) — odatda bugun.
    if (!out.eventDate) out.eventDate = out.date || new Date().toISOString();
    if (out.direction !== 'taken') out.direction = 'given';
  }
  return out;
}

function normalizeExpenseCategoryForDb(value) {
  const normalized = normalizeExpenseCategory(value);
  if (normalized) return normalized;
  return 'boshqa_chiqim';
}

function normalizeIncomeCategoryForDb(value) {
  const normalized = normalizeIncomeCategory(value);
  if (normalized) return normalized;
  return 'boshqa_kirim';
}

function normalizePeriod(period) {
  if (['today', 'week', 'month', 'last_month', 'year', 'all'].includes(period)) return period;
  return 'month';
}

function serializeDoc(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return JSON.parse(JSON.stringify(obj));
}

function serializeService(service) {
  const s = serializeDoc(service);
  if (!s) return null;
  return {
    id: s._id,
    clientName: s.clientName,
    clientPhone: s.clientPhone,
    location: s.location,
    serviceDateTime: s.serviceDateTime,
    price: s.price,
    paymentMethod: s.paymentMethod,
    paymentStatus: s.paymentStatus,
    status: s.status,
    isHistorical: s.isHistorical,
    reminderAt: s.reminderAt,
    confirmAt: s.confirmAt,
    notes: s.notes,
    originalAmount: s.originalAmount ?? null,
    originalCurrency: s.originalCurrency ?? null,
    exchangeRateUsed: s.exchangeRateUsed ?? null,
  };
}

// Xarajat toifasi -> ko'rsatiladigan o'zbekcha nom (tasdiqlash xabari uchun).
const CATEGORY_LABEL = {
  yoqilgi: "Yoqilg'i",
  tamirlash: "Ta'mirlash",
  'oziq-ovqat': 'Oziq-ovqat',
  svalka: 'Svalka',
  boshqa_chiqim: 'Boshqa',
  boshqa_kirim: 'Boshqa kirim',
};

function itemMatchQuestion(candidates = []) {
  const lines = ["Oka, qaysi buyum nazarda tutilganini aniqlashtiring:"];
  candidates.slice(0, 3).forEach((item, index) => {
    lines.push(`${index + 1}. ${item.name}`);
  });
  lines.push("Raqamini yozing yoki 'yo'q' deb bekor qiling.");
  return lines.join('\n');
}

function fallbackResponse(toolName, result) {
  switch (toolName) {
    case 'create_service':
      return serviceSummary(result);
    case 'upsert_partner_contract': {
      const client = result.client || {};
      const lines = [
        `🤝 Bo'ldi oka, ${client.name || 'hamkor'} bilan hamkorlik ${result.created ? 'boshlandi' : 'yangilandi'} ✅`,
      ];
      if (client.partnerPrice > 0) lines.push(`💰 Standart narx: ${formatMoney(client.partnerPrice)}`);
      if (client.partnerLocation?.address) lines.push(`📍 Standart manzil: ${client.partnerLocation.address}`);
      lines.push(`Endi "${client.name || 'hamkor'}ga bordim" desangiz — darhol yozib qo'yaman.`);
      return lines.join('\n');
    }
    case 'update_service_status':
    case 'complete_service':
    case 'cancel_service':
      return result.status === SERVICE_STATUS.DONE
        ? `Boldi oka, ${result.clientName} xizmatini bajarildi deb belgiladim ✅`
        : `Boldi oka, ${result.clientName} xizmatini bekor qildim.`;
    case 'reschedule_service':
      return `Boldi oka, ${result.clientName} xizmatini ${formatDateTime(result.serviceDateTime)} ga ko'chirdim ✅`;
    case 'edit_service':
      return `Boldi oka, ${result.clientName} xizmatini yangiladim ✅`;
    case 'edit_client':
      return `Boldi oka, ${result.name || 'mijoz'} ma'lumotini yangiladim ✅`;
    case 'get_balance':
      return analyticsSummary(result);
    case 'get_services_by_identifier':
      return searchSummary(result);
    case 'create_useful_item':
      return `${result.name || 'Buyum'}ni kerakli buyumlar kategoriyasiga kiritib qo'ydim oka ✅`;
    case 'sell_useful_item': {
      if (result.needsConfirmation) return itemMatchQuestion(result.candidates);
      const name = result.item?.name || result.transaction?.itemName || 'Buyum';
      const lines = [`Bo'ldi oka, ${name} sotildi - ${formatMoney(result.transaction?.amount || 0)} balansga qo'shildi ✅`];
      if (result.warning) lines.push(`⚠️ ${result.warning}`);
      return lines.join('\n');
    }
    case 'give_useful_item':
      if (result.needsConfirmation) return itemMatchQuestion(result.candidates);
      if (result.item) return `Bo'ldi oka, ${result.item.name || 'buyum'} ro'yxatdan chiqarildi. Balansga pul qo'shilmadi.`;
      return result.warning || "Buyumni ro'yxatda topolmadim oka.";
    case 'create_transaction':
      if (result.category === 'material') {
        const qty = result.quantityKg > 0 ? `${formatKg(result.quantityKg)} kg ` : '';
        return `Bo'ldi oka, ${qty}${result.materialName || 'material'} — ${formatMoney(result.amount)}ga sotilgani yozildi ✅`;
      }
      if (result.type === 'income') {
        return `Boldi oka, ${formatMoney(result.amount)} kirim qo'shdim ✅\nToifa: ${CATEGORY_LABEL[result.category] || result.category || 'Boshqa kirim'}`;
      }
      return `Boldi oka, ${formatMoney(result.amount)} chiqim qo'shdim ✅\nToifa: ${CATEGORY_LABEL[result.category] || result.category || 'Boshqa'}`;
    case 'record_payment':
      return `Boldi oka, ${formatMoney(result.amountApplied)} to'lovni yozib qo'ydim ✅`;
    case 'create_debt_reminder':
      return debtReminderSummary(result);
    case 'search_data':
      return searchSummary(result);
    case 'get_analytics':
      return analyticsSummary(result);
    default:
      return 'Boldi oka, bajardim ✅';
  }
}

// Qarz eslatmasi saqlangach egaga javob: summa, balans ta'siri (yangi balans) va eslatma sanasi.
function debtReminderSummary(result) {
  const r = result?.reminder || {};
  const taken = r.direction === 'taken';
  const who = r.person || 'kimdir';
  const when = formatDateTime(r.dueDate);
  const lines = [
    taken
      ? `Boldi oka, ${who}dan ${formatMoney(r.amount)} qarz olganingizni yozib qo'ydim 🔔`
      : `Boldi oka, ${who}ga ${formatMoney(r.amount)} qarz berganingizni yozib qo'ydim 🔔`,
  ];
  if (result?.affectsBalance) {
    lines.push(
      taken
        ? `💰 Balansga qo'shdim — joriy balans: ${formatMoney(result.balanceAfter)}`
        : `💸 Balansdan ayirdim — joriy balans: ${formatMoney(result.balanceAfter)}`
    );
  } else {
    lines.push('⚖️ Balansga tegmadim (so\'raganingizdek).');
  }
  lines.push(`📅 ${when} da eslatib qo'yaman.`);
  return lines.join('\n');
}

function serviceSummary(service) {
  return [
    "Boldi oka, yozib qo'ydim ✅",
    `👤 ${service.clientName}`,
    `📞 ${formatPhone(service.clientPhone)}`,
    `📍 ${service.location?.address || service.location || '-'}`,
    `📅 ${formatDateTime(service.serviceDateTime)}`,
    `💰 ${formatMoney(service.price)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function searchSummary(result) {
  const count = (result.services?.length || 0) + (result.clients?.length || 0) + (result.transactions?.length || 0);
  if (!count) return "Oka, bunga mos hech narsa topolmadim.";
  const serviceLines = (result.services || [])
    .slice(0, 10)
    .map((s, i) => `${i + 1}. ${formatDateTime(s.serviceDateTime)} - ${s.clientName}, ${s.location?.address || '-'}, ${formatMoney(s.price)}`);
  return `Mana topdim oka, ${count} ta:\n${serviceLines.join('\n')}`;
}

function analyticsSummary(result) {
  return [
    `Mana hisob, oka (${result.period}):`,
    `💰 Kirim: ${formatMoney(result.income || 0)}`,
    `💸 Chiqim: ${formatMoney(result.expense || 0)}`,
    `⚖️ Sof balans: ${formatMoney(result.balance || 0)}`,
  ].join('\n');
}

export default { runAgent };
