// Google Gemini API wrapper.
// Step 1: voice transcription and notebook OCR.
// Step 2: intent classification with Gemini function calling enabled.
import { FunctionCallingMode, GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import env from '../config/env.js';
import {
  TRANSCRIBE_PROMPT,
  BOT_PERSONA,
  buildAnswerPrompt,
  buildClassificationPrompt,
  buildImagePrompt,
} from './prompts.js';
import {
  HIGH_LEVEL_INTENTS,
  SUB_INTENTS,
  SUB_TO_HIGH,
  HIGH_DEFAULT_SUB,
} from './intents.js';
import { parseMoney } from '../utils/money.js';
import { normalizePhone } from '../utils/phone.js';
import { normalizePaymentMethod } from '../bot/flow.js';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

const classifyTool = {
  functionDeclarations: [
    {
      name: 'classify_business_input',
      description:
        'Understand one Uzbek trash-collection business message: pick the high-level intent, the precise subIntent, and extract visible fields. No commands or symbols are used; infer from meaning.',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          intent: {
            type: SchemaType.STRING,
            enum: HIGH_LEVEL_INTENTS,
            description: 'High-level intent: MOLIYA | MIJOZ | SUXBAT, or CLARIFY when unsure/ambiguous.',
          },
          subIntent: {
            type: SchemaType.STRING,
            enum: SUB_INTENTS,
            description: 'Precise action inside the high-level intent (drives execution).',
          },
          confidence: {
            type: SchemaType.NUMBER,
            description: 'Confidence from 0.0 to 1.0. If < 0.7 or two intents fit equally, use intent=CLARIFY.',
          },
          reason: {
            type: SchemaType.STRING,
            description: 'Short reason for the choice.',
          },
          clarifyingQuestion: {
            type: SchemaType.STRING,
            description: 'When intent=CLARIFY: one short Uzbek question to disambiguate.',
          },
          clarifyOptions: {
            type: SchemaType.ARRAY,
            description: 'When intent=CLARIFY: 2-3 quick-reply choices.',
            items: {
              type: SchemaType.OBJECT,
              properties: {
                label: { type: SchemaType.STRING, description: 'Short Uzbek button text.' },
                intent: { type: SchemaType.STRING, enum: SUB_INTENTS, description: 'subIntent this choice resolves to.' },
              },
              required: ['label', 'intent'],
            },
          },
          reply: {
            type: SchemaType.STRING,
            description: 'Optional short Uzbek note, otherwise empty string.',
          },
          fields: {
            type: SchemaType.OBJECT,
            description: 'Only extracted fields. Do not invent missing values.',
            properties: {
              clientName: { type: SchemaType.STRING },
              clientPhone: { type: SchemaType.STRING },
              location: { type: SchemaType.STRING },
              serviceDateTime: { type: SchemaType.STRING },
              price: { type: SchemaType.NUMBER },
              paymentMethod: { type: SchemaType.STRING, enum: ['naqd', 'karta', 'otkazma'] },
              notes: { type: SchemaType.STRING },
              isHistorical: { type: SchemaType.BOOLEAN },
              hasDollar: { type: SchemaType.BOOLEAN, description: 'true if amount was given in USD.' },
              currency: { type: SchemaType.STRING, enum: ['USD', 'UZS'], description: "Currency of the money amount: 'USD' if $/dollar/dollor/usd, else 'UZS'. Still fill price/amount with the number." },
              amount: { type: SchemaType.NUMBER },
              category: {
                type: SchemaType.STRING,
                enum: ['yoqilgi', 'tamirlash', 'oziq-ovqat', 'boshqa_chiqim'],
              },
              description: { type: SchemaType.STRING },
              date: { type: SchemaType.STRING },
              incomeSource: { type: SchemaType.STRING },
              materialName: { type: SchemaType.STRING, description: 'MATERIAL_SALE: the sold material, base form (e.g. "Paxta", "Mis", "chyorniy taxta").' },
              quantityKg: { type: SchemaType.NUMBER, description: 'MATERIAL_SALE: quantity in kilograms, if stated.' },
              pricePerKg: { type: SchemaType.NUMBER, description: 'MATERIAL_SALE: price per kilogram, if stated.' },
              itemName: { type: SchemaType.STRING, description: 'ITEM_*: useful piece item name, base form (e.g. "muzlatgich", "televizor", "divan").' },
              estimatedPrice: { type: SchemaType.NUMBER, description: 'ITEM_ENTRY: optional estimated value if explicitly stated.' },
              recipient: { type: SchemaType.STRING, description: 'ITEM_SALE/ITEM_GIVEAWAY: who received or bought the item, if stated.' },
              targetClientName: { type: SchemaType.STRING },
              targetPhone: { type: SchemaType.STRING },
              newStatus: { type: SchemaType.STRING, enum: ['bajarildi', 'bekor_qilindi'] },
              paymentAmount: { type: SchemaType.NUMBER },
              targetIdentifier: { type: SchemaType.STRING, description: 'Name/phone/date pointing to the record to edit.' },
              editField: { type: SchemaType.STRING, description: 'narx|sana|manzil for service; ism|telefon for client.' },
              newValue: { type: SchemaType.STRING, description: 'New value for the edited field (already normalized).' },
              searchText: { type: SchemaType.STRING },
              dateFrom: { type: SchemaType.STRING },
              dateTo: { type: SchemaType.STRING },
              analyticsPeriod: {
                type: SchemaType.STRING,
                enum: ['today', 'month', 'last_month', 'year', 'all'],
              },
              analyticsMetric: {
                type: SchemaType.STRING,
                enum: ['income', 'expense', 'profit', 'count'],
              },
            },
          },
        },
        required: ['intent', 'confidence', 'reason', 'fields'],
      },
    },
  ],
};

const AGENT_TOOL_NAMES = [
  'create_service',
  'update_service_status',
  'edit_service',
  'edit_client',
  'complete_service',
  'cancel_service',
  'reschedule_service',
  'create_transaction',
  'record_payment',
  'search_data',
  'get_analytics',
  'get_balance',
  'get_services_by_identifier',
];

const agentTools = {
  functionDeclarations: [
    {
      name: 'create_service',
      description: 'Save a new trash collection service/job',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          clientName: { type: SchemaType.STRING },
          clientPhone: { type: SchemaType.STRING },
          location: { type: SchemaType.STRING },
          serviceDateTime: { type: SchemaType.STRING },
          price: { type: SchemaType.NUMBER },
          paymentMethod: { type: SchemaType.STRING, enum: ['naqd', 'karta', 'otkazma'] },
          notes: { type: SchemaType.STRING },
          isHistorical: { type: SchemaType.BOOLEAN },
        },
        required: ['clientName', 'clientPhone', 'location', 'serviceDateTime', 'price'],
      },
    },
    {
      name: 'update_service_status',
      description: 'Mark a service as completed or cancelled',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceIdentifier: { type: SchemaType.STRING, description: 'clientName, clientPhone, date, or short description' },
          status: { type: SchemaType.STRING, enum: ['bajarildi', 'bekor_qilindi'] },
        },
        required: ['serviceIdentifier', 'status'],
      },
    },
    {
      name: 'edit_service',
      description: 'Edit a field (price/date/location) of an existing service found by identifier',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceIdentifier: { type: SchemaType.STRING, description: 'clientName, clientPhone, or date' },
          field: { type: SchemaType.STRING, enum: ['narx', 'sana', 'manzil'] },
          value: { type: SchemaType.STRING },
        },
        required: ['serviceIdentifier', 'field', 'value'],
      },
    },
    {
      name: 'edit_client',
      description: 'Edit a client own field (name/phone) found by identifier',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          clientIdentifier: { type: SchemaType.STRING, description: 'current clientName or clientPhone' },
          field: { type: SchemaType.STRING, enum: ['ism', 'telefon'] },
          value: { type: SchemaType.STRING },
        },
        required: ['clientIdentifier', 'field', 'value'],
      },
    },
    {
      name: 'complete_service',
      description: 'Mark an existing service as completed (creates income)',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceIdentifier: { type: SchemaType.STRING },
        },
        required: ['serviceIdentifier'],
      },
    },
    {
      name: 'cancel_service',
      description: 'Cancel an existing service',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceIdentifier: { type: SchemaType.STRING },
          reason: { type: SchemaType.STRING },
        },
        required: ['serviceIdentifier'],
      },
    },
    {
      name: 'reschedule_service',
      description: 'Change the date/time of an existing pending service',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          serviceIdentifier: { type: SchemaType.STRING },
          newDateTime: { type: SchemaType.STRING, description: 'ISO 8601 date/time' },
        },
        required: ['serviceIdentifier', 'newDateTime'],
      },
    },
    {
      name: 'create_transaction',
      description: 'Record income or expense',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          type: { type: SchemaType.STRING, enum: ['income', 'expense'] },
          amount: { type: SchemaType.NUMBER },
          category: {
            type: SchemaType.STRING,
            enum: ['yoqilgi', 'tamirlash', 'oziq-ovqat', 'boshqa_chiqim'],
          },
          description: { type: SchemaType.STRING },
          date: { type: SchemaType.STRING },
          serviceId: { type: SchemaType.STRING },
        },
        required: ['type', 'amount'],
      },
    },
    {
      name: 'record_payment',
      description: 'Update payment status for an existing client service without creating a finance transaction',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          clientIdentifier: { type: SchemaType.STRING, description: 'clientName or clientPhone' },
          amount: { type: SchemaType.NUMBER },
          note: { type: SchemaType.STRING },
          date: { type: SchemaType.STRING },
        },
        required: ['clientIdentifier', 'amount'],
      },
    },
    {
      name: 'search_data',
      description: 'Search services, clients, transactions',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          query: { type: SchemaType.STRING },
          filters: {
            type: SchemaType.OBJECT,
            properties: {
              dateFrom: { type: SchemaType.STRING },
              dateTo: { type: SchemaType.STRING },
              type: { type: SchemaType.STRING },
              status: { type: SchemaType.STRING },
            },
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_analytics',
      description: 'Get financial summary',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          period: { type: SchemaType.STRING, enum: ['today', 'week', 'month', 'year', 'all'] },
          metric: { type: SchemaType.STRING, enum: ['income', 'expense', 'profit', 'count'] },
        },
        required: ['period'],
      },
    },
    {
      name: 'get_balance',
      description: 'Get income/expense/balance summary for a period',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          period: { type: SchemaType.STRING, enum: ['today', 'week', 'month', 'last_month', 'year', 'all'] },
        },
      },
    },
    {
      name: 'get_services_by_identifier',
      description: 'Find services by client name, phone, or a date',
      parameters: {
        type: SchemaType.OBJECT,
        properties: {
          identifier: { type: SchemaType.STRING },
        },
        required: ['identifier'],
      },
    },
  ],
};

function model(modelName, options = {}) {
  return genAI.getGenerativeModel({
    model: modelName,
    ...options,
  });
}

function jsonModel(modelName) {
  return model(modelName, {
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
    },
  });
}

function textModel(modelName) {
  return model(modelName, {
    generationConfig: {
      temperature: 0.1,
    },
  });
}

function functionCallingModel(modelName) {
  return model(modelName, {
    tools: [classifyTool],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: ['classify_business_input'],
      },
    },
    generationConfig: {
      temperature: 0.05,
    },
  });
}

function agentToolModel(modelName) {
  return model(modelName, {
    tools: [agentTools],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingMode.ANY,
        allowedFunctionNames: AGENT_TOOL_NAMES,
      },
    },
    generationConfig: {
      temperature: 0.05,
    },
  });
}

// Asosiy model + zaxira modellar. Asosiysi vaqtinchalik 503 (high demand) bersa,
// boshqa model (alohida quvvat puli) ko'pincha ishlaydi — shu sabab fallback zanjiri.
// flash-lite zaxirada qoldi: asosiy flash band bo'lsa, lite tez (past kechikishli)
// muqobil sifatida javob beradi.
const PRIMARY_MODEL = env.GEMINI_MODEL || 'gemini-2.5-flash';
const CANDIDATE_MODELS = [
  ...new Set([PRIMARY_MODEL, 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-flash-latest']),
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Bitta Gemini chaqiruvi uchun qattiq vaqt chegarasi (ms). Gemini ba'zan javob
// qaytarmay osilib qoladi — chegarasiz chaqiruv webhook timeout'iga, u esa eski kodda
// process crash'iga olib kelardi. Bu yerda uzib, zaxira modelga o'tamiz (yoki xatoni
// handler ushlaydi). 15s tanlandi: asosiy model osilsa ham webhook oynasida (25s)
// zaxira modelni sinashga vaqt qoladi.
const GEMINI_REQUEST_TIMEOUT_MS = 15_000;

// Gemini xato turini aniqlaydi:
//  'fatal'       — 4xx (429'dan tashqari): kalit/ruxsat/noto'g'ri so'rov — qayta urinish behuda.
//  'retry'       — 429/5xx: o'tkinchi server xatosi — qisqa backoff bilan SHU modelda qayta.
//  'fallthrough' — timeout/abort/tarmoq (HTTP status yo'q): SHU model osilgan, keyingi zaxira modelga o't.
// MUHIM: "This operation was aborted" (bizning timeout) status'siz keladi — eski kodda u
// darhol throw bo'lib egaga xato chiqarar edi; endi zaxira modelni sinab ko'ramiz.
function classifyGeminiError(err) {
  const msg = String(err?.message || '').toLowerCase();
  if (
    err?.name === 'AbortError' ||
    /abort|timed?\s*out|fetch failed|network|socket|econn|etimedout|terminated/.test(msg)
  ) {
    return 'fallthrough';
  }
  const status = Number(err?.status);
  if (Number.isFinite(status) && status > 0) {
    if (status === 429 || status >= 500) return 'retry';
    if (status >= 400) return 'fatal';
  }
  // Status yo'q va abort/tarmoq belgisi ham aniq emas — ehtiyot shart zaxira modelni sinaymiz.
  return 'fallthrough';
}

// Har bir modelda qisqa backoff bilan qayta uriniladi; o'tkinchi xato/osilish bo'lsa —
// keyingi zaxira modelga o'tadi. Kalit/so'rov xatolari (4xx) darhol uzatiladi (qayta urinish
// foydasiz, egaga aniq sabab ko'rsatiladi). buildModel(modelName) -> instance.
async function generate(buildModel, request, { retriesPerModel = 1, baseDelayMs = 600 } = {}) {
  let lastErr;
  for (const modelName of CANDIDATE_MODELS) {
    for (let attempt = 0; attempt <= retriesPerModel; attempt += 1) {
      try {
        return await buildModel(modelName).generateContent(request, {
          timeout: GEMINI_REQUEST_TIMEOUT_MS,
        });
      } catch (err) {
        lastErr = err;
        const kind = classifyGeminiError(err);
        if (kind === 'fatal') throw err; // kalit/so'rov xatosi — qayta urinish behuda
        if (kind === 'fallthrough') {
          // Timeout/abort/tarmoq: shu modelni tashlab, keyingi zaxiraga o'tamiz.
          console.warn(`Gemini "${modelName}" javob bermadi (${err?.message || 'abort'}); zaxira modelga o'tilmoqda`);
          break;
        }
        // kind === 'retry': o'tkinchi 429/5xx — qisqa backoff bilan shu modelda qayta.
        if (attempt < retriesPerModel) await sleep(baseDelayMs * (attempt + 1));
      }
    }
  }
  throw lastErr;
}

function safeParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const objectMatch = text.match(/\{[\s\S]*\}/);
    if (objectMatch) {
      try {
        return JSON.parse(objectMatch[0]);
      } catch {
        return null;
      }
    }
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      try {
        return JSON.parse(arrayMatch[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function functionArgs(response) {
  const directCalls = response.functionCalls?.();
  if (directCalls?.length) return directCalls[0].args;

  const parts = response.candidates?.[0]?.content?.parts || [];
  const part = parts.find((p) => p.functionCall?.name === 'classify_business_input');
  return part?.functionCall?.args || null;
}

function namedFunctionCall(response, allowedNames) {
  const directCalls = response.functionCalls?.();
  if (directCalls?.length) {
    const call = directCalls.find((c) => allowedNames.includes(c.name)) || directCalls[0];
    return { name: call.name, args: call.args || {} };
  }

  const parts = response.candidates?.[0]?.content?.parts || [];
  const part = parts.find((p) => allowedNames.includes(p.functionCall?.name));
  if (!part?.functionCall) return null;
  return { name: part.functionCall.name, args: part.functionCall.args || {} };
}

function normalizeHighLevel(value) {
  return HIGH_LEVEL_INTENTS.includes(value) ? value : null;
}

// High-level intent va subIntentni izchil (consistent) qilib hal qiladi:
// subIntent aniq bo'lsa, high-level undan olinadi; faqat SUXBAT high bo'lsa, SEARCH_QUERY;
// write high-level subIntent bermasa — CLARIFY, hech narsa to'g'ri bo'lmasa — xavfsiz SUXBAT/SEARCH_QUERY.
function resolveIntentPair(data) {
  const high = normalizeHighLevel(data.intent);
  const sub = SUB_INTENTS.includes(data.subIntent) ? data.subIntent : null;

  if (high === 'CLARIFY') return { intent: 'CLARIFY', subIntent: sub };
  if (sub) return { intent: SUB_TO_HIGH[sub], subIntent: sub };
  if (high === 'SUXBAT') return { intent: high, subIntent: HIGH_DEFAULT_SUB[high] };
  if (high) return { intent: 'CLARIFY', subIntent: HIGH_DEFAULT_SUB[high] };
  return { intent: 'SUXBAT', subIntent: 'SEARCH_QUERY' };
}

function normalizeClarifyOptions(options) {
  if (!Array.isArray(options)) return [];
  return options
    .map((opt) => {
      const sub = SUB_INTENTS.includes(opt?.intent)
        ? opt.intent
        : SUB_INTENTS.includes(opt?.subIntent)
        ? opt.subIntent
        : null;
      return { label: textOrNull(opt?.label), subIntent: sub };
    })
    .filter((opt) => opt.label && opt.subIntent)
    .slice(0, 3);
}

function cleanObject(obj = {}) {
  const out = {};
  for (const [key, value] of Object.entries(obj || {})) {
    if (value === null || value === undefined || value === '') continue;
    if (typeof value === 'number' && !Number.isFinite(value)) continue;
    if (typeof value === 'number' && value === 0) continue;
    out[key] = value;
  }
  return out;
}

function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = typeof value === 'string' ? value.trim() : String(value).trim();
  return text ? text : null;
}

function numberOrNull(value) {
  const parsed = parseMoney(value);
  return typeof parsed === 'number' && parsed > 0 ? parsed : null;
}

function isoOrNull(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function normalizeExpenseCategoryForExtraction(value) {
  if (!value) return 'boshqa_chiqim';
  const v = String(value).toLowerCase().replace(/[`'‘’]/g, '');
  if (/(yoqilgi|yoqilg|benzin|dizel|gaz|yakit|salyarka|propan|metan)/.test(v)) return 'yoqilgi';
  if (/(tamir|tamirlash|remont|shina|balon|moy|maslo|ehtiyot|zapchast|akkumulyator)/.test(v)) {
    return 'tamirlash';
  }
  if (/(oziq|ovqat|non|tushlik|choy|kafe|osh|somsa|suv)/.test(v)) return 'oziq-ovqat';
  return 'boshqa_chiqim';
}

// Valyutani aniqlaydi: Gemini 'currency' yoki eski 'hasDollar' belgisidan.
function resolveCurrency(clean = {}) {
  if (clean.currency === 'USD' || clean.hasDollar === true) return 'USD';
  if (clean.currency === 'UZS') return 'UZS';
  return undefined;
}

export function normalizeExtractedFields(intent, fields = {}) {
  const clean = cleanObject(fields);

  if (intent === 'SERVICE_ENTRY') {
    const phone = clean.clientPhone ? normalizePhone(clean.clientPhone) : null;
    return {
      clientName: textOrNull(clean.clientName),
      clientPhone: phone && /^\+998\d{9}$/.test(phone) ? phone : phone,
      location:
        typeof clean.location === 'object'
          ? textOrNull(clean.location.address || clean.location.text)
          : textOrNull(clean.location),
      serviceDateTime: isoOrNull(clean.serviceDateTime),
      price: numberOrNull(clean.price),
      paymentMethod: normalizePaymentMethod(clean.paymentMethod),
      notes: textOrNull(clean.notes),
      isHistorical: clean.isHistorical === true,
      hasDollar: clean.hasDollar === true,
      currency: resolveCurrency(clean),
    };
  }

  if (intent === 'SERVICE_EDIT' || intent === 'CLIENT_EDIT') {
    return {
      targetIdentifier: textOrNull(clean.targetIdentifier || clean.targetClientName || clean.clientName || clean.clientPhone),
      editField: textOrNull(clean.editField || clean.field),
      newValue: clean.newValue ?? clean.value ?? null,
    };
  }

  if (intent === 'EXPENSE_ENTRY') {
    return {
      amount: numberOrNull(clean.amount),
      category: normalizeExpenseCategoryForExtraction(clean.category || clean.description),
      description: textOrNull(clean.description || clean.notes),
      date: isoOrNull(clean.date) || new Date().toISOString(),
      currency: resolveCurrency(clean),
    };
  }

  if (intent === 'INCOME_ENTRY') {
    return {
      amount: numberOrNull(clean.amount),
      description: textOrNull(clean.description || clean.notes || clean.incomeSource),
      date: isoOrNull(clean.date) || new Date().toISOString(),
      currency: resolveCurrency(clean),
    };
  }

  if (intent === 'MATERIAL_SALE') {
    return {
      materialName: textOrNull(clean.materialName || clean.incomeSource),
      quantityKg: numberOrNull(clean.quantityKg),
      pricePerKg: numberOrNull(clean.pricePerKg),
      amount: numberOrNull(clean.amount),
      date: isoOrNull(clean.date) || new Date().toISOString(),
      currency: resolveCurrency(clean),
    };
  }

  if (intent === 'ITEM_ENTRY') {
    return {
      itemName: textOrNull(clean.itemName || clean.incomeSource || clean.description),
      estimatedPrice: numberOrNull(clean.estimatedPrice || clean.amount || clean.price),
      notes: textOrNull(clean.notes || clean.description),
      date: isoOrNull(clean.date) || new Date().toISOString(),
      currency: resolveCurrency(clean),
    };
  }

  if (intent === 'ITEM_SALE') {
    return {
      itemName: textOrNull(clean.itemName || clean.incomeSource || clean.description),
      amount: numberOrNull(clean.amount || clean.price),
      recipient: textOrNull(clean.recipient || clean.targetClientName || clean.clientName),
      date: isoOrNull(clean.date) || new Date().toISOString(),
      currency: resolveCurrency(clean),
    };
  }

  if (intent === 'ITEM_GIVEAWAY') {
    return {
      itemName: textOrNull(clean.itemName || clean.incomeSource || clean.description),
      recipient: textOrNull(clean.recipient || clean.targetClientName || clean.clientName),
      notes: textOrNull(clean.notes || clean.description),
      date: isoOrNull(clean.date) || new Date().toISOString(),
    };
  }

  return clean;
}

function normalizeUnderstanding(parsed) {
  const data = parsed && typeof parsed === 'object' ? parsed : {};
  const { intent, subIntent } = resolveIntentPair(data);
  // Maydon ajratish kontrakti sub-action bo'yicha ishlaydi.
  const extractionIntent = subIntent || 'SEARCH_QUERY';
  return {
    intent,
    subIntent,
    fields: normalizeExtractedFields(extractionIntent, data.fields || {}),
    confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
    reason: data.reason || '',
    reply: data.reply || '',
    clarifyingQuestion: textOrNull(data.clarifyingQuestion) || '',
    clarifyOptions: normalizeClarifyOptions(data.clarifyOptions),
  };
}

function normalizeRecords(parsed) {
  const records = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.records) ? parsed.records : [];
  return records
    .filter((record) => record && typeof record === 'object')
    .map((record) => normalizeExtractedFields('SERVICE_ENTRY', record))
    .filter(hasMeaningfulServiceRecord);
}

function hasMeaningfulServiceRecord(record) {
  return Boolean(
    record.clientName ||
      record.clientPhone ||
      record.location ||
      record.serviceDateTime ||
      record.price ||
      record.paymentMethod ||
      record.notes
  );
}

// STEP 1: VOICE input. Returns exact Uzbek transcription only.
export async function transcribeAudio(audioBuffer, mime = 'audio/ogg') {
  const res = await generate(textModel,[
    { text: TRANSCRIBE_PROMPT },
    {
      inlineData: {
        mimeType: mime,
        data: audioBuffer.toString('base64'),
      },
    },
  ]);
  return res.response.text().trim().replace(/^["']|["']$/g, '');
}

// STEP 1: IMAGE input OCR. Returns notebook records only; does not save them.
export async function extractNotebookRecords(imageBuffer, mime = 'image/jpeg', caption = '') {
  const res = await generate(jsonModel, [
    { text: buildImagePrompt(caption) },
    {
      inlineData: {
        mimeType: mime,
        data: imageBuffer.toString('base64'),
      },
    },
  ]);
  return normalizeRecords(safeParseJson(res.response.text()));
}

// ── Deterministik xavfsizlik to'ri: SOTUV hech qachon xarajat emas ─────────────
// Gemini ba'zan uzun/erkin gapni ("eski muzlatgich bor edi, kecha Sardorga sotdim")
// xato EXPENSE/INCOME deb tasniflaydi. Agar matnda aniq SOTISH/BERIB YUBORISH fe'li +
// tanilgan tovar (buyum yoki material) bo'lsa — niyatni to'g'rilaymiz. Bu LLM xatosidan
// qat'i nazar to'g'ri natija beradi (foydalanuvchi shikoyat qilgan asosiy bug).
// "sotib oldim" (sotib olish=xarajat) sotuvga ALMASHTIRILMAYDI.
// SOTISH fe'llari (o'zbek + rus). "sotdim/sotildi/sotib yubordim/pulladim/продал". "sotib
// oldim/xarid/купил" — bu XARID (xarajat), sotuv emas — alohida ushlanadi.
const SOLD_RE = /(\bsot(d|t)\w*|\bsotil\w*|\bsotvor\w*|\bsotib\s+(yubor|ber)\w*|\bpullad\w*|\bsotdik\b|\bprodal\w*|\bprodan\w*|продал\w*|продан\w*|сот(д|т|и)\w*|пуллад\w*)/i;
const GIVEN_FREE_RE = /(tekin\w*|bepul|sovg'a\w*|sovga\w*|hadya|hediya|berib\s+yubor\w*|podaril\w*|otdal\w*|подарил\w*|отдал\w*|бесплатно|даром|текин\w*|бепул|бериб\s+юбор\w*)/i;
const BOUGHT_RE = /(sotib\s*ol\w*|xarid\s*qil\w*|\bkupil\w*|купил\w*|сотиб\s*ол\w*|харид\w*)/i; // sotib oldim = xarid (sale emas)
// Buyum (dona texnika/mebel) — o'zbek imlo variantlari (x/h, l/r) + rus/kirill.
const ITEM_NOUN_RE = /(muzlatgich\w*|sovutgich\w*|sovitgich\w*|музлатгич\w*|совутгич\w*|совитгич\w*|xolodil\w*|holodil\w*|halodel\w*|haladel\w*|xalodel\w*|xaladel\w*|холодильник\w*|халадел\w*|televizor\w*|televizr\w*|telivizor\w*|\btelik\b|\btv\b|телевизор\w*|телик\w*|divan\w*|диван\w*|kreslo\w*|кресло\w*|\bstul\w*|стул\w*|\bstol\w*|стол\w*|shkaf\w*|шкаф\w*|javon\w*|жавон\w*|krovat\w*|karavot\w*|кроват\w*|каравот\w*|kir\s*(yuvish\s*)?mashina\w*|кир\s*мошина\w*|стиральн\w*|stiral\w*|стирал\w*|kondi\w*|konder\w*|кондиционер\w*|кондиц\w*|gaz\s*plita\w*|\bplita\w*|плита\w*|pech(ka)?\w*|печ\w*|kompyuter\w*|компьютер\w*|компютер\w*|noutbuk\w*|ноутбук\w*|laptop\w*|gilam\w*|гилам\w*|kovyor\w*|\bkover\b|ковер\w*|ковёр\w*|changyutgich\w*|чангютгич\w*|pilesos\w*|пылесос\w*|dazmol\w*|дазмол\w*|ventilyator\w*|вентилятор\w*|mikroto'lqin\w*|mikrovolnov\w*|velosiped\w*|велосипед\w*|mebel\w*|мебель\w*|мебел\w*)/i;
// Material (kg bilan o'lchanadigan xom-ashyo) — o'zbek (lotin/kirill) + rus.
const MATERIAL_NOUN_RE = /(paxta\w*|пахта\w*|хлопок\w*|taxta\w*|тахта\w*|доск\w*|temir\w*|темир\w*|железо\w*|metall\w*|metal\w*|металл\w*|plastik\w*|пластик\w*|plassmas\w*|пластмасс\w*|salafan\w*|салафан\w*|целлофан\w*|alyumin\w*|алюмин\w*|\bmis\b|\bмис\b|медь\w*|g'isht\w*|gisht\w*|гишт\w*|кирпич\w*|qog'oz\w*|qogoz\w*|қоғоз\w*|бумаг\w*|karton\w*|картон\w*|rezina\w*|резин\w*|latun\w*|латун\w*|bronza\w*|бронз\w*|choyan\w*|чуян\w*|чугун\w*)/i;

function firstMatch(text, re) {
  const m = String(text || '').match(re);
  return m ? m[0].trim() : null;
}

// SUXBAT/savol belgisi — "muzlatgichni qachon sotdim?" kabi savolni sotuvga aylantirib
// yubormaslik uchun (savol bo'lsa to'g'rilamaymiz).
const QUESTION_RE = /(\?|\bqachon\b|\bqaysi\b|\bnecha\b|\bnechta\b|\bqancha\b|\bqayer|\bkim\b|\bnima(ni|ga)?\b|\bbormi\b)/i;
// Sotuv emas — bu niyatlarga TEGMAYMIZ.
const PROTECTED_SUBS = new Set(['SERVICE_ENTRY', 'SERVICE_EDIT', 'CLIENT_EDIT', 'STATUS_UPDATE', 'PAYMENT_UPDATE', 'SEARCH_QUERY', 'ANALYTICS_QUERY']);
// Faqat shu YOZUV niyatlari noto'g'ri bo'lsa to'g'rilanadi (xarajat/kirim/buyum yoki noto'g'ri sotuv turi).
const CORRECTABLE_SUBS = new Set(['EXPENSE_ENTRY', 'INCOME_ENTRY', 'ITEM_ENTRY', 'MATERIAL_SALE', 'ITEM_SALE', 'ITEM_GIVEAWAY']);

// Niyatni matn asosida to'g'rilaydi: aniq SOTISH/BERIB-YUBORISH fe'li + tanilgan tovar bo'lsa,
// to'g'ri sotuv niyatini (ITEM_SALE / MATERIAL_SALE / ITEM_GIVEAWAY) qo'yamiz. Gemini xato
// EXPENSE deb tasniflagan holatni ham, noto'g'ri sotuv TURINI (sotilgan vs tekinga) ham tuzatadi.
export function correctSaleClassification(understanding, rawText) {
  const text = String(rawText || '');
  const u = understanding || {};
  const sub = u.subIntent;

  // Mijoz xizmati/to'lovi yoki SAVOL — tegmaymiz.
  if (PROTECTED_SUBS.has(sub)) return u;
  if (QUESTION_RE.test(text)) return u;

  const sold = SOLD_RE.test(text) && !BOUGHT_RE.test(text);
  const givenFree = GIVEN_FREE_RE.test(text);
  if (!sold && !givenFree) return u;

  const itemNoun = firstMatch(text, ITEM_NOUN_RE);
  const materialNoun = firstMatch(text, MATERIAL_NOUN_RE);
  if (!itemNoun && !materialNoun) return u; // tanilgan tovar yo'q — tegmaymiz

  // To'g'ri niyatni aniqlaymiz (buyum sotish/tekinga berish materialdan ustun).
  let target = null;
  if (givenFree && !sold && itemNoun) target = 'ITEM_GIVEAWAY';
  else if (sold && itemNoun) target = 'ITEM_SALE';
  else if (sold && materialNoun) target = 'MATERIAL_SALE';
  if (!target) return u;

  if (!CORRECTABLE_SUBS.has(sub)) return u; // null/CLARIFY-bo'sh/boshqa — taxmin qilmaymiz
  if (sub === target) return u; // allaqachon to'g'ri

  const fields = { ...(u.fields || {}) };
  delete fields.category; // eski xato xarajat toifasi (mas. 'oziq-ovqat') qolmasin
  const out = { ...u, intent: 'MOLIYA', subIntent: target, confidence: Math.max(u.confidence || 0, 0.9), clarifyOptions: [], clarifyingQuestion: '' };
  if (target === 'MATERIAL_SALE') {
    out.fields = { ...fields, materialName: fields.materialName || materialNoun };
  } else {
    out.fields = { ...fields, itemName: fields.itemName || itemNoun };
  }
  return out;
}

// STEP 2: intent classification with Gemini function calling enabled.
// `history` — oxirgi ~10 xabar ([{role, text}]); qisqa javoblarni botning oldingi
// savoli kontekstida talqin qilish uchun prompt'ga qo'shiladi (ixtiyoriy).
export async function classifyIntent(text, history = []) {
  const prompt = buildClassificationPrompt(text, history);
  const res = await generate(functionCallingModel, prompt);
  const args = functionArgs(res.response);
  const understanding = args
    ? normalizeUnderstanding(args)
    // Fallback for SDK/runtime modes that return JSON text instead of a tool call.
    : normalizeUnderstanding(safeParseJson(res.response.text()));

  // Determinstik xavfsizlik to'ri — sotuvni xarajat deb tasniflashni tuzatadi.
  return correctSaleClassification(understanding, text);
}

export async function chooseAgentTool({ intent, fields = {}, rawText = '', mode = 'bot' }) {
  const res = await generate(agentToolModel, `You are the action planner for Musir Yo'q.
Choose exactly one function tool to execute for this already classified request.

Intent: ${intent}
Mode: ${mode}
Extracted fields JSON:
${JSON.stringify(fields, null, 2)}

Original user text:
${rawText}

Rules:
- SERVICE_ENTRY => create_service.
- EXPENSE_ENTRY => create_transaction with type="expense".
- INCOME_ENTRY => create_transaction with type="income".
- STATUS_UPDATE => update_service_status.
- PAYMENT_UPDATE => record_payment (service payment status only, no balance transaction).
- SEARCH_QUERY => search_data.
- ANALYTICS_QUERY => get_analytics.
- Preserve normalized values from extracted fields. Do not invent missing required data.
- If category is yoqilgi/tamirlash/boshqa_chiqim, keep that value; the server will map it to DB enums.`);

  return namedFunctionCall(res.response, AGENT_TOOL_NAMES);
}

export async function formulateToolResponse({ toolName, toolArgs, toolResult, rawText = '' }) {
  const res = await generate(textModel,`${BOT_PERSONA}

The requested MongoDB operation has ALREADY been executed by the server.
Write a short Uzbek confirmation in that warm "oka" tone for the business owner.
Do not invent data. Mention only important saved/updated/found values, and keep every
number, date, phone and address exact and tidy. Summalarni "so'm" bilan yoz.

Original user text:
${rawText}

Tool called:
${toolName}

Tool args:
${JSON.stringify(toolArgs, null, 2)}

Tool result:
${JSON.stringify(toolResult, null, 2)}

Uzbek response (samimiy "oka" ohangida, qisqa):`);
  return res.response.text().trim();
}

// Backward-compatible NLU entry point used by bot and Mini App.
// `history` ixtiyoriy — bot suhbat kontekstini beradi; Mini App bo'sh yuboradi.
export async function understandText(text, history = []) {
  return classifyIntent(text, history);
}

// Backward-compatible audio entry point: transcribe first, then classify text.
export async function understandAudio(audioBuffer, mime = 'audio/ogg') {
  const transcription = await transcribeAudio(audioBuffer, mime);
  const understanding = await classifyIntent(transcription);
  return { ...understanding, transcription };
}

// Backward-compatible image entry point. For a single record, classify the JSON
// representation as a service entry; for multiple records, return OCR metadata
// so the bot can ask for confirmation before any save logic is added.
export async function understandImage(imageBuffer, mime = 'image/jpeg', caption = '') {
  const records = await extractNotebookRecords(imageBuffer, mime, caption);
  if (records.length === 1) {
    const understanding = await classifyIntent(
      `Notebook OCR service record: ${JSON.stringify(records[0])}${caption ? `\nCaption: ${caption}` : ''}`
    );
    return { ...understanding, fields: { ...records[0], ...understanding.fields }, ocrRecords: records };
  }
  return {
    intent: 'MIJOZ',
    subIntent: 'SERVICE_ENTRY',
    fields: {},
    reply: '',
    confidence: records.length > 0 ? 0.85 : 0.2,
    reason: `notebook OCR found ${records.length} records`,
    ocrRecords: records,
    needsImageRecordConfirmation: records.length > 1,
  };
}

export async function answerFromData(question, data) {
  const res = await generate(textModel,buildAnswerPrompt(question, data));
  return res.response.text().trim();
}

// Spec helper aliases — robust wrappers around the same multimodal pipeline.
// geminiTranscribeAudio: Telegram ovoz buffer -> aniq o'zbekcha transkripsiya.
export async function geminiTranscribeAudio(audioBuffer, mime = 'audio/ogg') {
  return transcribeAudio(audioBuffer, mime);
}

// geminiOCR: daftar rasmidan yozuvlar massivi. Buffer yoki base64 string qabul qiladi;
// JSON ni xavfsiz parse qiladi (xom JSON.parse o'rniga) va normallashtirilgan recordlarni qaytaradi.
export async function geminiOCR(image, mime = 'image/jpeg') {
  const buffer = Buffer.isBuffer(image) ? image : Buffer.from(String(image || ''), 'base64');
  return extractNotebookRecords(buffer, mime, '');
}

export default {
  transcribeAudio,
  geminiTranscribeAudio,
  extractNotebookRecords,
  geminiOCR,
  classifyIntent,
  chooseAgentTool,
  formulateToolResponse,
  understandText,
  understandAudio,
  understandImage,
  answerFromData,
};
