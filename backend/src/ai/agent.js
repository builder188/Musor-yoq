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
import { editConfirmKeyboard, paymentMethodKeyboard, clientPickKeyboard } from '../bot/ui.js';

// Yetishmayotgan maydonni so'rash — paymentMethod uchun tugmalar bilan.
function askField(field) {
  if (field === 'paymentMethod') {
    return { text: QUESTIONS[field], keyboard: paymentMethodKeyboard() };
  }
  return { text: QUESTIONS[field] };
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
  if (requiresSomConfirmation(understanding, rawText)) {
    return {
      text: "Dollar saqlanmaydi. Summani so'mga aylantiring, taxminan qancha so'm deb yozaman?",
    };
  }

  if (conversation?.pendingIntent && isEntryIntent(conversation.pendingIntent)) {
    return continueEntry({ conversation, understanding, rawText, mode });
  }

  switch (understanding.intent) {
    case 'SERVICE_ENTRY':
    case 'EXPENSE_ENTRY':
    case 'INCOME_ENTRY':
      if (mode === 'query') return { text: "Bu amalni botda bajaring. Mini App chat faqat qidiruv va tahlil uchun." };
      return startEntry({ conversation, intent: understanding.intent, fields: understanding.fields || {}, rawText, mode });

    case 'STATUS_UPDATE':
      return handleStatusUpdate({ fields: understanding.fields || {}, rawText, conversation, mode });

    case 'SERVICE_EDIT':
      return handleServiceEdit({ fields: understanding.fields || {}, rawText, conversation, mode });

    case 'CLIENT_EDIT':
      return handleClientEdit({ fields: understanding.fields || {}, rawText, conversation, mode });

    case 'PAYMENT_UPDATE':
      return handlePaymentUpdate({ fields: understanding.fields || {}, rawText, conversation, mode });

    case 'SEARCH_QUERY':
      return executeToolFlow({ intent: 'SEARCH_QUERY', fields: understanding.fields || {}, rawText, mode });

    case 'ANALYTICS_QUERY':
      return executeToolFlow({ intent: 'ANALYTICS_QUERY', fields: understanding.fields || {}, rawText, mode });

    default:
      return {
        text:
          understanding.reply ||
          'Tushunmadim. Mijoz, xizmat, xarajat, tolov, qidiruv yoki hisobot haqida aniqroq yozing.',
      };
  }
}

function requiresSomConfirmation(understanding, rawText) {
  if (!['SERVICE_ENTRY', 'EXPENSE_ENTRY', 'INCOME_ENTRY', 'SERVICE_EDIT'].includes(understanding?.intent)) return false;
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
    return { text: 'Qaysi mijoz yoki qaysi xizmat? Ism yoki telefonni yuboring.' };
  }
  const disambiguation = await maybeDisambiguate({ fields, conversation, intent: 'STATUS_UPDATE' });
  if (disambiguation) return disambiguation;
  return executeToolFlow({ intent: 'STATUS_UPDATE', fields, rawText, mode });
}

async function handlePaymentUpdate({ fields, rawText, conversation, mode }) {
  const identifier = fields.targetPhone || fields.clientPhone || fields.targetClientName || fields.clientName;
  if (!identifier) return { text: 'Qaysi mijoz tolov qildi? Ism yoki telefonni yuboring.' };
  if (!(fields.paymentAmount || fields.amount)) return { text: 'Tolov summasi qancha?' };
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
    text: `Bir nechta "${name}" ismli mijoz bor. Qaysi biri?`,
    keyboard: clientPickKeyboard(candidates),
  };
}

// Mavjud xizmatni tahrirlash — topib, tasdiq so'raydi (Ha/Yo'q), keyin callback ijro etadi.
async function handleServiceEdit({ fields, rawText, conversation, mode }) {
  if (mode === 'query') return { text: 'Tahrirlashni botda bajaring. Mini App chat faqat qidiruv va tahlil uchun.' };

  const identifier = fields.targetIdentifier || rawText;
  const fieldKey = SERVICE_EDIT_FIELD[String(fields.editField || '').toLowerCase()];
  if (!fieldKey) return { text: "Nimani o'zgartiramiz? Narx, sana yoki manzilni ayting." };
  if (fields.newValue === null || fields.newValue === undefined || fields.newValue === '') {
    return { text: 'Yangi qiymatni yozing.' };
  }

  const service = await findServiceByIdentifier(identifier);
  if (!service) return { text: 'Mos xizmat topilmadi. Mijoz ismi, telefoni yoki sanasini aniqroq ayting.' };

  const { data, display } = buildServiceEditData(fieldKey, fields.newValue);
  if (data === null) return { text: 'Yangi qiymatni tushunmadim. Aniqroq yozing.' };

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
    text: `${service.clientName} [${when}] xizmatining ${label}ini ${display} ga o'zgartiraymi?`,
    keyboard: editConfirmKeyboard(),
  };
}

async function handleClientEdit({ fields, rawText, conversation, mode }) {
  if (mode === 'query') return { text: 'Tahrirlashni botda bajaring. Mini App chat faqat qidiruv va tahlil uchun.' };

  const identifier = fields.targetIdentifier || rawText;
  const fieldKey = CLIENT_EDIT_FIELD[String(fields.editField || '').toLowerCase()];
  if (!fieldKey) return { text: "Nimani o'zgartiramiz? Ism yoki telefonni ayting." };
  if (fields.newValue === null || fields.newValue === undefined || fields.newValue === '') {
    return { text: 'Yangi qiymatni yozing.' };
  }

  const disambiguation = await maybeDisambiguate({
    fields: { ...fields, targetIdentifier: identifier },
    conversation,
    intent: 'CLIENT_EDIT',
  });
  if (disambiguation) return disambiguation;

  const phone = normalizePhone(identifier);
  const client = await findClient({ name: phone === identifier ? '' : identifier, phone });
  if (!client) return { text: 'Mijoz topilmadi. Ismi yoki telefonini aniqroq ayting.' };

  let value = fields.newValue;
  if (fieldKey === 'phone') {
    value = normalizePhone(value);
    if (!value) return { text: "Telefon raqamini to'g'ri yozing. Masalan: 90 123 45 67" };
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
    text: `${client.name} mijozning ${label} ${display} ga o'zgartiraymi?`,
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

  const toolResult = await executeAgentTool(toolCall.name, toolCall.args);
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
  if (!service) throw new Error('Mos xizmat topilmadi. Mijoz ismi yoki telefonini aniqroq ayting.');

  if (args.status === SERVICE_STATUS.CANCELLED || args.status === 'cancelled') {
    return serializeService(await cancelService(service._id));
  }
  return serializeService(await completeService(service._id, { markPaid: true }));
}

async function completeAgentService(args) {
  const service = await findServiceByIdentifier(args.serviceIdentifier || '');
  if (!service) throw new Error('Mos xizmat topilmadi.');
  return serializeService(await completeService(service._id, { markPaid: true }));
}

async function cancelAgentService(args) {
  const service = await findServiceByIdentifier(args.serviceIdentifier || '');
  if (!service) throw new Error('Mos xizmat topilmadi.');
  return serializeService(await cancelService(service._id, args.reason || null));
}

async function rescheduleAgentService(args) {
  const service = await findServiceByIdentifier(args.serviceIdentifier || '');
  if (!service) throw new Error('Mos xizmat topilmadi.');
  const date = parseHumanDateTime(args.newDateTime || '');
  if (!date || Number.isNaN(date.getTime())) throw new Error('Yangi vaqt notogri.');
  return serializeService(await rescheduleService(service._id, date.toISOString()));
}

async function editAgentService(args) {
  const service = await findServiceByIdentifier(args.serviceIdentifier || '');
  if (!service) throw new Error('Mos xizmat topilmadi.');
  const fieldKey = SERVICE_EDIT_FIELD[String(args.field || '').toLowerCase()];
  if (!fieldKey) throw new Error('Qaysi maydon? narx, sana yoki manzil.');
  const { data } = buildServiceEditData(fieldKey, args.value);
  if (!data) throw new Error('Yangi qiymat notogri.');
  return serializeService(await editService(service._id, data));
}

async function editAgentClient(args) {
  const identifier = args.clientIdentifier || '';
  const phone = normalizePhone(identifier);
  const client = await findClient({ name: phone === identifier ? '' : identifier, phone });
  if (!client) throw new Error('Mijoz topilmadi.');
  const fieldKey = CLIENT_EDIT_FIELD[String(args.field || '').toLowerCase()];
  if (!fieldKey) throw new Error('Qaysi maydon? ism yoki telefon.');
  let value = args.value;
  if (fieldKey === 'phone') {
    value = normalizePhone(value);
    if (!value) throw new Error('Telefon notogri.');
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
  if (!client) throw new Error('Mijoz topilmadi. Ismi yoki telefonini aniqroq ayting.');

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
    reminderOffsetMinutes: fields.reminderOffsetMinutes,
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
    notes: s.notes,
  };
}

function fallbackResponse(toolName, result) {
  switch (toolName) {
    case 'create_service':
      return serviceSummary(result);
    case 'update_service_status':
    case 'complete_service':
    case 'cancel_service':
      return `Xizmat holati yangilandi: ${result.clientName} - ${result.status}.`;
    case 'reschedule_service':
      return `Xizmat vaqti o'zgartirildi: ${result.clientName} - ${formatDateTime(result.serviceDateTime)}.`;
    case 'edit_service':
      return `Xizmat tahrirlandi: ${result.clientName}.`;
    case 'edit_client':
      return `Mijoz ma'lumoti yangilandi: ${result.name || ''}.`;
    case 'get_balance':
      return analyticsSummary(result);
    case 'get_services_by_identifier':
      return searchSummary(result);
    case 'create_transaction':
      return `${result.type === 'income' ? 'Daromad' : 'Xarajat'} saqlandi: ${formatMoney(result.amount)}.`;
    case 'record_payment':
      return `To'lov holati yangilandi: ${formatMoney(result.amountApplied)}.`;
    case 'search_data':
      return searchSummary(result);
    case 'get_analytics':
      return analyticsSummary(result);
    default:
      return 'Amal bajarildi.';
  }
}

function serviceSummary(service) {
  return [
    'Xizmat saqlandi:',
    `Mijoz: ${service.clientName}`,
    `Tel: ${formatPhone(service.clientPhone)}`,
    `Manzil: ${service.location?.address || service.location || '-'}`,
    `Vaqt: ${formatDateTime(service.serviceDateTime)}`,
    `Narx: ${formatMoney(service.price)}`,
    `Tolov: ${service.paymentMethod}`,
    `Holat: ${service.status}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function searchSummary(result) {
  const count = (result.services?.length || 0) + (result.clients?.length || 0) + (result.transactions?.length || 0);
  if (!count) return 'Hech narsa topilmadi.';
  const serviceLines = (result.services || [])
    .slice(0, 10)
    .map((s, i) => `${i + 1}. ${formatDate(s.serviceDateTime)} - ${s.clientName}, ${s.location?.address || '-'}, ${formatMoney(s.price)}`);
  return `Topildi: ${count} ta.\n${serviceLines.join('\n')}`;
}

function analyticsSummary(result) {
  return [
    `Davr: ${result.period}`,
    `Daromad: ${formatMoney(result.income || 0)}`,
    `Xarajat: ${formatMoney(result.expense || 0)}`,
    `Sof balans: ${formatMoney(result.balance || 0)}`,
  ].join('\n');
}

export default { runAgent };
