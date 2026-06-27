// Kerakli buyumlar: dona inventar + sotilganda moliyaga kirim yozish.
import mongoose from 'mongoose';
import UsefulItem, { USEFUL_ITEM_STATUS } from '../models/UsefulItem.js';
import Transaction, { TX_TYPES, USEFUL_ITEM_CATEGORY } from '../models/Transaction.js';
import { parseMoney } from '../utils/money.js';

const notDeleted = { isDeleted: { $ne: true } };

const ITEM_ALIASES = [
  ['televizor', ['televizor', 'tv', 'telik', 'telek', 'televizorni']],
  ['muzlatgich', ['muzlatgich', 'sovutgich', 'holodilnik', 'xolodilnik', 'haladelnik', 'xaladelnik', 'холодильник']],
  ['divan', ['divan', 'sofa', 'kushetka']],
  ['kir yuvish mashinasi', ['kir yuvish mashinasi', 'stiralka', 'stiralniy', 'kir mashina']],
  ['konditsioner', ['konditsioner', 'kondisioner', 'konditsaner', 'konder']],
  ['gaz plita', ['gaz plita', 'plita', 'gaz pech', 'pechka']],
  ['kompyuter', ['kompyuter', 'computer', 'pc', 'protsessor']],
  ['noutbuk', ['noutbuk', 'notebook', 'laptop', 'lap top']],
  ['shkaf', ['shkaf', 'javon', 'kiyim shkafi']],
  ['stol', ['stol', 'table']],
  ['stul', ['stul', 'kursi']],
  ['kreslo', ['kreslo']],
  ['gilam', ['gilam', 'palos', 'kovyor', 'kover']],
];

const ALIAS_TO_CANONICAL = new Map();
for (const [canonical, aliases] of ITEM_ALIASES) {
  for (const alias of aliases) ALIAS_TO_CANONICAL.set(itemKey(alias), canonical);
}

export function itemKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[`'’‘ʼ´]/g, '')
    .replace(/[.,!?;:()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripUzbekSuffixes(value) {
  return itemKey(value)
    .split(' ')
    .map((word) => word.replace(/(ni|ga|da|dan|lar|im|ingiz|niyam)$/i, ''))
    .join(' ')
    .trim();
}

export function canonicalItemName(rawName) {
  const key = stripUzbekSuffixes(rawName);
  if (!key) return '';
  if (ALIAS_TO_CANONICAL.has(key)) return cleanDisplayName(ALIAS_TO_CANONICAL.get(key));
  for (const [alias, canonical] of ALIAS_TO_CANONICAL.entries()) {
    if (key === alias || key.includes(alias) || alias.includes(key)) return cleanDisplayName(canonical);
  }
  return cleanDisplayName(rawName);
}

function cleanDisplayName(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function normalizePayloadPrice(value) {
  const parsed = parseMoney(value);
  return typeof parsed === 'number' && parsed > 0 ? parsed : null;
}

function serialize(doc) {
  if (!doc) return null;
  const obj = typeof doc.toObject === 'function' ? doc.toObject() : doc;
  return JSON.parse(JSON.stringify(obj));
}

function levenshtein(a, b) {
  const left = itemKey(a);
  const right = itemKey(b);
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;
  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev.splice(0, prev.length, ...curr);
  }
  return prev[right.length];
}

function similarity(a, b) {
  const max = Math.max(itemKey(a).length, itemKey(b).length, 1);
  return 1 - levenshtein(a, b) / max;
}

async function matchAvailableItem(rawName) {
  const canonical = canonicalItemName(rawName);
  const key = itemKey(canonical || rawName);
  const available = await UsefulItem.find({ ...notDeleted, status: USEFUL_ITEM_STATUS.AVAILABLE })
    .sort({ acquiredAt: 1, createdAt: 1 })
    .lean();
  if (!available.length) return { item: null, candidates: [], confidence: 0 };

  const exact = available.filter((item) => item.normalizedName === key);
  if (exact.length === 1) return { item: exact[0], candidates: exact, confidence: 1, method: 'exact' };
  if (exact.length > 1) return { item: null, candidates: exact.slice(0, 3), confidence: 0.72, ambiguous: true };

  const scored = available
    .map((item) => ({
      item,
      score: Math.max(similarity(key, item.normalizedName), similarity(rawName, item.name)),
    }))
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.7) return { item: null, candidates: [], confidence: best?.score || 0 };
  const close = scored.filter((row) => row.score >= Math.max(0.7, best.score - 0.06)).map((row) => row.item);
  if (close.length > 1 || best.score < 0.84) {
    return { item: null, candidates: close.slice(0, 3), confidence: best.score, ambiguous: true };
  }
  return { item: best.item, candidates: [best.item], confidence: best.score, method: 'fuzzy' };
}

export async function listUsefulItems({ status = USEFUL_ITEM_STATUS.AVAILABLE, search = '', limit = 200 } = {}) {
  const filter = { ...notDeleted };
  if (status && status !== 'all') filter.status = status;
  const q = itemKey(search);
  if (q) {
    filter.$or = [
      { name: { $regex: q, $options: 'i' } },
      { normalizedName: { $regex: q, $options: 'i' } },
      { notes: { $regex: q, $options: 'i' } },
      { sourceText: { $regex: q, $options: 'i' } },
    ];
  }
  return UsefulItem.find(filter).sort({ status: 1, acquiredAt: -1, createdAt: -1 }).limit(Number(limit) || 200).lean();
}

export async function getUsefulItemById(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;
  return UsefulItem.findOne({ _id: id, ...notDeleted }).lean();
}

export async function createUsefulItem(data = {}) {
  const canonical = canonicalItemName(data.itemName || data.name);
  if (!canonical) throw new Error('Buyum nomini ayting oka.');
  const sourceType = data.sourceType === 'voice' ? 'voice' : data.sourceType === 'miniapp' ? 'miniapp' : 'text';
  return UsefulItem.create({
    name: canonical,
    normalizedName: itemKey(canonical),
    estimatedPrice: normalizePayloadPrice(data.estimatedPrice ?? data.amount),
    acquiredAt: data.acquiredAt ? new Date(data.acquiredAt) : new Date(),
    notes: data.notes || '',
    sourceType,
    sourceText: data.sourceText || data.rawText || '',
    voice: data.voiceTelegramFileId
      ? {
          telegramFileId: data.voiceTelegramFileId,
          mimeType: data.voiceMimeType || null,
          duration: data.voiceDuration || null,
          messageId: data.voiceMessageId || null,
        }
      : null,
  });
}

function itemSaleDescription(name, recipient) {
  return `${name || 'Buyum'} sotildi${recipient ? ` (${recipient})` : ''}`;
}

async function createItemIncomeTransaction({ itemName, usefulItemId, amount, recipient, date, originalAmount, originalCurrency, exchangeRateUsed }) {
  return Transaction.create({
    type: TX_TYPES.INCOME,
    amount,
    category: USEFUL_ITEM_CATEGORY,
    description: itemSaleDescription(itemName, recipient),
    itemName,
    usefulItemId: usefulItemId || null,
    date: date ? new Date(date) : new Date(),
    originalAmount: originalAmount ?? null,
    originalCurrency: originalCurrency ?? null,
    exchangeRateUsed: exchangeRateUsed ?? null,
  });
}

function confirmationPayload(action, payload, candidates) {
  return {
    needsConfirmation: true,
    action,
    payload,
    candidates: candidates.map((item, index) => ({
      index: index + 1,
      id: String(item._id),
      name: item.name,
      acquiredAt: item.acquiredAt,
    })),
  };
}

export async function sellUsefulItem(data = {}, options = {}) {
  const amount = normalizePayloadPrice(data.amount);
  if (!amount) throw new Error('Sotilgan summani ayting oka.');
  const canonical = canonicalItemName(data.itemName || data.name);
  if (!canonical) throw new Error('Qaysi buyum sotilganini ayting oka.');

  let item = null;
  if (options.confirmedItemId) {
    item = await UsefulItem.findOne({ _id: options.confirmedItemId, ...notDeleted, status: USEFUL_ITEM_STATUS.AVAILABLE });
    if (!item) throw new Error('Tasdiqlangan buyum topilmadi yoki allaqachon ro\'yxatdan chiqqan.');
  } else {
    const match = await matchAvailableItem(canonical);
    if (match.ambiguous) return confirmationPayload('sell', data, match.candidates);
    item = match.item ? await UsefulItem.findById(match.item._id) : null;
  }

  const tx = await createItemIncomeTransaction({
    itemName: item?.name || canonical,
    usefulItemId: item?._id || null,
    amount,
    recipient: data.recipient,
    date: data.date,
    originalAmount: data.originalAmount,
    originalCurrency: data.originalCurrency,
    exchangeRateUsed: data.exchangeRateUsed,
  });

  if (item) {
    item.status = USEFUL_ITEM_STATUS.SOLD;
    item.closedAt = new Date();
    item.closedReason = 'sold';
    item.recipient = data.recipient || null;
    item.soldAmount = amount;
    item.saleTransactionId = tx._id;
    await item.save();
  }

  return {
    item: serialize(item),
    transaction: serialize(tx),
    warning: item ? null : `Sotilgan ${canonical} kerakli buyumlar bo'limiga yozilmagan ekan! Keyingi safar yozib qo'yishni unutmang.`,
  };
}

export async function giveAwayUsefulItem(data = {}, options = {}) {
  const canonical = canonicalItemName(data.itemName || data.name);
  if (!canonical) throw new Error('Qaysi buyumni berganingizni ayting oka.');

  let item = null;
  if (options.confirmedItemId) {
    item = await UsefulItem.findOne({ _id: options.confirmedItemId, ...notDeleted, status: USEFUL_ITEM_STATUS.AVAILABLE });
    if (!item) throw new Error('Tasdiqlangan buyum topilmadi yoki allaqachon ro\'yxatdan chiqqan.');
  } else {
    const match = await matchAvailableItem(canonical);
    if (match.ambiguous) return confirmationPayload('give', data, match.candidates);
    item = match.item ? await UsefulItem.findById(match.item._id) : null;
  }

  if (!item) {
    return {
      item: null,
      warning: `${canonical} kerakli buyumlar ro'yxatida topilmadi, balansga hech narsa yozilmadi.`,
    };
  }

  item.status = USEFUL_ITEM_STATUS.GIVEN_AWAY;
  item.closedAt = data.date ? new Date(data.date) : new Date();
  item.closedReason = 'given_away';
  item.recipient = data.recipient || null;
  if (data.notes) item.notes = [item.notes, data.notes].filter(Boolean).join('\n');
  await item.save();
  return { item: serialize(item), warning: null };
}

export async function discardUsefulItem(id) {
  const item = await UsefulItem.findOne({ _id: id, ...notDeleted });
  if (!item) throw new Error('Buyum topilmadi.');
  item.status = USEFUL_ITEM_STATUS.DISCARDED;
  item.closedAt = new Date();
  item.closedReason = 'discarded';
  item.isDeleted = true;
  item.deletedAt = new Date();
  await item.save();
  return item;
}

export async function confirmUsefulItemAction({ action, payload, itemId }) {
  if (action === 'sell') return sellUsefulItem(payload, { confirmedItemId: itemId });
  if (action === 'give') return giveAwayUsefulItem(payload, { confirmedItemId: itemId });
  throw new Error("Noto'g'ri buyum amali.");
}

export default {
  USEFUL_ITEM_STATUS,
  itemKey,
  canonicalItemName,
  listUsefulItems,
  getUsefulItemById,
  createUsefulItem,
  sellUsefulItem,
  giveAwayUsefulItem,
  discardUsefulItem,
  confirmUsefulItemAction,
};
