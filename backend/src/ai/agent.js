// Gemini AI Agent executor.
// Flow: classified intent -> missing-field guard -> Gemini action tool call ->
// MongoDB service operation -> Gemini Uzbek response.
import {
  isEntryIntent,
  mergeFields,
  applyRawValue,
  hasValue,
  nextMissing,
  QUESTIONS,
  normalizeExpenseCategory,
} from '../bot/flow.js';
import {
  SUB_INTENTS,
  SUB_TO_HIGH,
  HIGH_DEFAULT_SUB,
  CONFIDENCE_THRESHOLD,
} from './intents.js';
import { chooseAgentTool, formulateToolResponse } from './gemini.js';
import {
  createService,
  completeService,
  cancelService,
  recordServicePayment,
  editService,
  rescheduleService,
} from '../services/serviceService.js';
import { createTransaction, getSummary, listTransactions } from '../services/financeService.js';
import { listClients, updateClient } from '../services/clientService.js';
import { searchServices, findServiceForUpdate, findClient, findClientsByName } from '../services/searchService.js';
import { TX_TYPES } from '../models/Transaction.js';
import Service, { SERVICE_STATUS } from '../models/Service.js';
import { formatMoney, parseMoney } from '../utils/money.js';
import { formatDateTime, formatDate, parseHumanDateTime } from '../utils/dates.js';
import { formatPhone, normalizePhone } from '../utils/phone.js';
import { editConfirmKeyboard, paymentMethodKeyboard, clientPickKeyboard, clarifyKeyboard } from '../bot/ui.js';

// Yetishmayotgan maydonni so'rash — paymentMethod uchun tugmalar bilan.
function askField(field) {
  if (field === 'paymentMethod') {
    return { text: QUESTIONS[field], keyboard: paymentMethodKeyboard() };
  }
  return { text: QUESTIONS[field] };
}

const PIVOT_SUBS = new Set(['SEARCH_QUERY', 'ANALYTICS_QUERY']);
// Erkin matnli maydonlar har qanday matnni "yutadi" — bu yerda pivot faqat aniq savolda.
const FREE_TEXT_FIELDS = new Set(['clientName', 'location', 'notes', 'description']);
// Slot-filling o'rtasida niyat korreksiyasi faqat shu aniq yozuv amallari uchun.
const WRITE_ACTIONS = new Set([
  'SERVICE_ENTRY', 'EXPENSE_ENTRY', 'INCOME_ENTRY', 'STATUS_UPDATE',
  'SERVICE_EDIT', 'CLIENT_EDIT', 'PAYMENT_UPDATE',
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
  const reAsk = askField(field);
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
    case 'SERVICE_ENTRY':
      // Shunchaki ism emas — to'liqroq yangi ish (sana/narx/tel ham bor).
      return Boolean(f.clientName && (f.serviceDateTime || f.price || f.clientPhone));
    case 'STATUS_UPDATE':
      return Boolean(f.newStatus);
    case 'PAYMENT_UPDATE':
      return Boolean(f.paymentAmount || f.amount);
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
  EXPENSE_ENTRY: 'create_transaction',
  INCOME_ENTRY: 'create_transaction',
  STATUS_UPDATE: 'update_service_status',
  SERVICE_EDIT: 'edit_service',
  CLIENT_EDIT: 'edit_client',
  PAYMENT_UPDATE: 'record_payment',
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

export async function runAgent({ understanding, rawText = '', conversation = null, mode = 'bot' }) {
  // 1) Davom etayotgan slot-filling ustuvor — SUXBAT pivoti shu ichida hal bo'ladi.
  if (conversation?.pendingIntent && isEntryIntent(conversation.pendingIntent)) {
    return continueEntry({ conversation, understanding, rawText, mode });
  }

  // 2) CLARIFY: ishonch past yoki 2 niyatga teng mos — taxmin qilmay, tugmali savol beramiz.
  const clarify = resolveClarify(understanding);
  if (clarify) return startClarify({ clarify, understanding, rawText, conversation });

  // 3) Aniq amal (sub-action) — MongoDB operatsiyasi shu darajada bajariladi.
  const action = resolveAction(understanding);

  if (requiresSomConfirmation(action, understanding, rawText)) {
    return {
      text: "Oka, dollarni saqlay olmayman. Taxminan qancha so'm bo'ladi — so'mda aytib bering.",
    };
  }

  switch (action) {
    case 'SERVICE_ENTRY':
    case 'EXPENSE_ENTRY':
    case 'INCOME_ENTRY':
      if (mode === 'query') return { text: "Buni bot orqali bajaramiz oka. Bu yer faqat qidiruv va tahlil uchun." };
      return startEntry({ conversation, intent: action, fields: understanding.fields || {}, rawText, mode });

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
      const suxbat =
        action === 'ANALYTICS_QUERY' || hasAnalyticsSignal(understanding.fields)
          ? 'ANALYTICS_QUERY'
          : 'SEARCH_QUERY';
      return executeToolFlow({ intent: suxbat, fields: understanding.fields || {}, rawText, mode });
    }

    default:
      return {
        text:
          understanding.clarifyingQuestion ||
          understanding.reply ||
          "Tushunmadim oka, birozroq ochiqroq aytib bersangiz? Mijoz, xizmat, xarajat, to'lov yoki hisobot bo'lishi mumkin.",
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

function requiresSomConfirmation(action, understanding, rawText) {
  if (!['SERVICE_ENTRY', 'EXPENSE_ENTRY', 'INCOME_ENTRY', 'SERVICE_EDIT'].includes(action)) return false;
  if (understanding?.fields?.hasDollar === true) return true;
  const text = `${rawText || ''} ${JSON.stringify(understanding?.fields || {})}`.toLowerCase();
  return /(\$|dollar|usd)/i.test(text);
}

async function startEntry({ conversation, intent, fields, rawText, mode }) {
  const collected = applyEntryDefaults(intent, mergeFields({}, fields));
  const missing = nextMissing(intent, collected);

  if (missing) {
    if (conversation) {
      conversation.pendingIntent = intent;
      conversation.collected = collected;
      conversation.awaitingField = missing;
      conversation.markModified('collected');
      await conversation.save();
    }
    return askField(missing);
  }
  return finalizeEntry({ conversation, intent, collected, rawText, mode });
}

async function continueEntry({ conversation, understanding, rawText, mode }) {
  if (/^(bekor|otmen|cancel|to'xtat|toxtat)/i.test((rawText || '').trim())) {
    await conversation.reset();
    return { text: 'Bekor qilindi.' };
  }

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

  const intent = conversation.pendingIntent;
  let collected = mergeFields(conversation.collected || {}, understanding.fields || {});

  if (conversation.awaitingField && !hasValue(conversation.awaitingField, collected)) {
    collected = applyRawValue(conversation.awaitingField, rawText, collected);
  }
  collected = applyEntryDefaults(intent, collected);

  const missing = nextMissing(intent, collected);
  if (missing) {
    conversation.collected = collected;
    conversation.awaitingField = missing;
    conversation.markModified('collected');
    await conversation.save();
    return askField(missing);
  }

  return finalizeEntry({ conversation, intent, collected, rawText, mode });
}

async function finalizeEntry({ conversation, intent, collected, rawText, mode }) {
  const result = await executeToolFlow({ intent, fields: collected, rawText, mode });
  if (conversation) await conversation.reset();
  return result;
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

  const { data, display } = buildServiceEditData(fieldKey, fields.newValue);
  if (data === null) return { text: "Yangi qiymatni tushunmadim oka, aniqroq yozing." };

  if (conversation) {
    conversation.pendingIntent = 'EDIT_CONFIRM';
    conversation.collected = { editType: 'service', targetId: String(service._id), data };
    conversation.awaitingField = 'confirmEdit';
    conversation.markModified('collected');
    await conversation.save();
  }

  const label = SERVICE_EDIT_LABEL[fieldKey] || fieldKey;
  const when = formatDate(service.serviceDateTime);
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

async function executeToolFlow({ intent, fields, rawText, mode }) {
  const fallback = fallbackToolCall(intent, fields, rawText);
  let toolCall = fallback;

  try {
    const geminiToolCall = await chooseAgentTool({ intent, fields, rawText, mode });
    if (geminiToolCall?.name) {
      const expectedTool = TOOL_BY_INTENT[intent] || fallback.name;
      if (geminiToolCall.name === expectedTool) {
        toolCall = {
          name: geminiToolCall.name,
          args: mergeToolArgs(geminiToolCall.name, fallback.args, geminiToolCall.args || {}),
        };
      }
    }
  } catch (err) {
    console.warn('Gemini tool planner fallback:', err.message);
  }

  let toolResult;
  try {
    toolResult = await executeAgentTool(toolCall.name, toolCall.args);
  } catch (err) {
    // Biznes xatosi (mas. "xizmat topilmadi") — bu AI/ulanish xatosi emas. Egaga aniq,
    // samimiy xabar qaytaramiz (umumiy "AI xato" o'rniga).
    return { text: err?.message || "Voy oka, bir narsa chappa ketdi. Qaytadan urinib ko'ring.", tool: toolCall.name, error: true };
  }
  const fallbackText = fallbackResponse(toolCall.name, toolResult);

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

    case 'record_payment':
      return recordAgentPayment(args);

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
  const { data } = buildServiceEditData(fieldKey, args.value);
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
  const tx = await createTransaction({
    type,
    amount: args.amount,
    category: type === TX_TYPES.EXPENSE ? normalizeCategoryForDb(args.category || args.description) : null,
    description: args.description || args.note || '',
    date: args.date || null,
    serviceId: args.serviceId || null,
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
    case 'update_service_status':
      return {
        name,
        args: {
          serviceIdentifier:
            fields.targetPhone || fields.clientPhone || fields.targetClientName || fields.clientName || fields.searchText || rawText,
          status: fields.newStatus || SERVICE_STATUS.DONE,
        },
      };
    case 'create_transaction':
      return {
        name,
        args: {
          type: intent === 'INCOME_ENTRY' ? 'income' : 'expense',
          amount: fields.amount,
          category: fields.category,
          description: fields.description || fields.notes || fields.incomeSource || rawText,
          date: fields.date || null,
          serviceId: fields.serviceId || null,
        },
      };
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

function mergeToolArgs(toolName, fallbackArgs, geminiArgs) {
  const merged = { ...fallbackArgs, ...cleanArgs(geminiArgs) };
  if (toolName === 'create_service') return serviceArgs(merged);
  if (toolName === 'create_transaction') {
    return {
      ...merged,
      category: normalizeCategoryForDb(merged.category || merged.description),
    };
  }
  return merged;
}

function serviceArgs(fields) {
  return {
    clientName: fields.clientName,
    clientPhone: fields.clientPhone,
    location: fields.location,
    serviceDateTime: fields.serviceDateTime,
    price: fields.price,
    paymentMethod: fields.paymentMethod,
    notes: fields.notes || '',
    isHistorical: !!fields.isHistorical,
    images: fields.images || [],
    imageFileId: fields.imageFileId || null,
  };
}

function applyEntryDefaults(intent, fields) {
  const out = { ...fields };
  if (intent === 'EXPENSE_ENTRY') {
    if (!out.date) out.date = new Date().toISOString();
    if (out.category) out.category = normalizeCategoryForDb(out.category);
  }
  return out;
}

function normalizeCategoryForDb(value) {
  const normalized = normalizeExpenseCategory(value);
  if (normalized) return normalized;
  return 'boshqa_chiqim';
}

function normalizePeriod(period) {
  if (['today', 'week', 'month', 'last_month', 'year', 'all'].includes(period)) return period;
  return 'month';
}

function cleanArgs(args = {}) {
  const out = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined || value === '') continue;
    out[key] = value;
  }
  return out;
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
  };
}

// Xarajat toifasi -> ko'rsatiladigan o'zbekcha nom (tasdiqlash xabari uchun).
const CATEGORY_LABEL = {
  yoqilgi: "Yoqilg'i",
  tamirlash: "Ta'mirlash",
  'oziq-ovqat': 'Oziq-ovqat',
  boshqa_chiqim: 'Boshqa',
};

function fallbackResponse(toolName, result) {
  switch (toolName) {
    case 'create_service':
      return serviceSummary(result);
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
    case 'create_transaction':
      if (result.type === 'income') {
        return `Boldi oka, ${formatMoney(result.amount)} kirim qo'shdim ✅`;
      }
      return `Boldi oka, ${formatMoney(result.amount)} chiqim qo'shdim ✅\nToifa: ${CATEGORY_LABEL[result.category] || 'Boshqa'}`;
    case 'record_payment':
      return `Boldi oka, ${formatMoney(result.amountApplied)} to'lovni yozib qo'ydim ✅`;
    case 'search_data':
      return searchSummary(result);
    case 'get_analytics':
      return analyticsSummary(result);
    default:
      return 'Boldi oka, bajardim ✅';
  }
}

function serviceSummary(service) {
  return [
    "Boldi oka, yozib qo'ydim ✅",
    `👤 ${service.clientName}`,
    `📞 ${formatPhone(service.clientPhone)}`,
    `📍 ${service.location?.address || service.location || '-'}`,
    `📅 ${formatDateTime(service.serviceDateTime)}`,
    `💰 ${formatMoney(service.price)}`,
    `💳 ${service.paymentMethod}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function searchSummary(result) {
  const count = (result.services?.length || 0) + (result.clients?.length || 0) + (result.transactions?.length || 0);
  if (!count) return "Oka, bunga mos hech narsa topolmadim.";
  const serviceLines = (result.services || [])
    .slice(0, 10)
    .map((s, i) => `${i + 1}. ${formatDate(s.serviceDateTime)} - ${s.clientName}, ${s.location?.address || '-'}, ${formatMoney(s.price)}`);
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
