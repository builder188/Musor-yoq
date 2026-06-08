// AI agent — niyatni amalga oshiradi: ma'lumotni saqlaydi, holatni yangilaydi,
// qidiradi va o'zbekcha javob qaytaradi. Bot va Mini App AI chat shu yerdan foydalanadi.
import {
  isEntryIntent,
  mergeFields,
  applyRawValue,
  nextMissing,
  QUESTIONS,
} from '../bot/flow.js';
import { createService, completeService, cancelService } from '../services/serviceService.js';
import { createTransaction, getSummary, recordPayment, listDebts } from '../services/financeService.js';
import { searchServices, findServiceForUpdate, findClient } from '../services/searchService.js';
import { TX_TYPES } from '../models/Transaction.js';
import { SERVICE_STATUS } from '../models/Service.js';
import { formatMoney } from '../utils/money.js';
import { formatDateTime, formatDate } from '../utils/dates.js';
import { formatPhone } from '../utils/phone.js';

// Xizmat yozuvi tasdiq matni.
function serviceSummary(service) {
  const lines = [
    '✅ Xizmat saqlandi:',
    `👤 Mijoz: ${service.clientName}`,
    `📞 Tel: ${formatPhone(service.clientPhone)}`,
    `📍 Manzil: ${service.location?.text || '—'}`,
    `🗓 Vaqt: ${formatDateTime(service.serviceDateTime)}`,
    `💵 Narx: ${formatMoney(service.price)}`,
    `💳 To'lov: ${service.paymentMethod}`,
  ];
  if (service.status === SERVICE_STATUS.DONE) lines.push('🟢 Holat: Bajarildi (daromad yozildi)');
  else lines.push('🟡 Holat: Kutilmoqda');
  if (service.notes) lines.push(`📝 Izoh: ${service.notes}`);
  return lines.join('\n');
}

function serviceListLine(s, i) {
  const status =
    s.status === SERVICE_STATUS.DONE ? '🟢' : s.status === SERVICE_STATUS.CANCELLED ? '🔴' : '🟡';
  return `${i + 1}. ${status} ${formatDate(s.serviceDateTime)} — ${s.clientName}, ${
    s.location?.text || '—'
  }, ${formatMoney(s.price)}`;
}

// Asosiy agent funksiyasi.
// kirish: { understanding, rawText, conversation, mode }
// mode: 'bot' (default) yoki 'query' (Mini App chat — faqat qidiruv/analitika)
// qaytaradi: { text }
export async function runAgent({ understanding, rawText = '', conversation = null, mode = 'bot' }) {
  const intent = conversation?.pendingIntent || understanding.intent;
  const fields = understanding.fields || {};

  // --- Davom etayotgan kiritish (slot-filling) ---
  if (conversation?.pendingIntent && isEntryIntent(conversation.pendingIntent)) {
    return continueEntry({ conversation, understanding, rawText });
  }

  // --- Yangi niyat ---
  switch (understanding.intent) {
    case 'SERVICE_ENTRY':
    case 'EXPENSE_ENTRY':
    case 'INCOME_ENTRY':
      if (mode === 'query') return { text: 'Bu so\'rovni botda bajaring.' };
      return startEntry({ conversation, intent: understanding.intent, fields });

    case 'STATUS_UPDATE':
      return handleStatusUpdate(fields);

    case 'PAYMENT_UPDATE':
      return handlePaymentUpdate(fields);

    case 'SEARCH_QUERY':
      return handleSearch({ fields, question: rawText });

    case 'ANALYTICS_QUERY':
      return handleAnalytics({ fields, question: rawText });

    default:
      return {
        text:
          understanding.reply ||
          'Tushunmadim 🤔. Mijoz, xizmat, xarajat yoki to\'lov haqida yozing — yoki "15 mart kuni qayerga borganman" kabi savol bering.',
      };
  }
}

// Kiritishni boshlash.
async function startEntry({ conversation, intent, fields }) {
  const collected = mergeFields({}, fields);
  const missing = nextMissing(intent, collected);

  if (missing) {
    if (conversation) {
      conversation.pendingIntent = intent;
      conversation.collected = collected;
      conversation.awaitingField = missing;
      await conversation.save();
    }
    return { text: QUESTIONS[missing] };
  }
  return finalizeEntry({ conversation, intent, collected });
}

// Kiritishni davom ettirish (oldingi savolga javob).
async function continueEntry({ conversation, understanding, rawText }) {
  // Bekor qilish.
  if (/^(bekor|otmen|cancel|to'xtat|toxtat)/i.test((rawText || '').trim())) {
    await conversation.reset();
    return { text: '❌ Bekor qilindi.' };
  }

  const intent = conversation.pendingIntent;
  let collected = mergeFields(conversation.collected || {}, understanding.fields || {});

  // NLU kutilgan maydonni topa olmagan bo'lsa — xom matnni qo'llaymiz.
  const awaiting = conversation.awaitingField;
  if (awaiting) {
    collected = applyRawValue(awaiting, rawText, collected);
  }

  const missing = nextMissing(intent, collected);
  if (missing) {
    conversation.collected = collected;
    conversation.awaitingField = missing;
    conversation.markModified('collected');
    await conversation.save();
    return { text: QUESTIONS[missing] };
  }

  return finalizeEntry({ conversation, intent, collected });
}

// Barcha maydonlar to'plangach — saqlash.
async function finalizeEntry({ conversation, intent, collected }) {
  let text;
  if (intent === 'SERVICE_ENTRY') {
    const service = await createService(collected);
    text = serviceSummary(service);
  } else if (intent === 'EXPENSE_ENTRY') {
    const tx = await createTransaction({
      type: TX_TYPES.EXPENSE,
      amount: collected.amount,
      category: collected.category || 'boshqa',
      note: collected.notes || collected.incomeSource || '',
    });
    text = `✅ Xarajat saqlandi:\n💸 ${formatMoney(tx.amount)} — ${tx.category}${
      tx.note ? `\n📝 ${tx.note}` : ''
    }`;
  } else if (intent === 'INCOME_ENTRY') {
    const tx = await createTransaction({
      type: TX_TYPES.INCOME,
      amount: collected.amount,
      note: collected.incomeSource || collected.notes || 'Qo\'shimcha daromad',
    });
    text = `✅ Daromad saqlandi:\n💰 ${formatMoney(tx.amount)}${tx.note ? `\n📝 ${tx.note}` : ''}`;
  } else {
    text = 'Saqlandi.';
  }

  if (conversation) await conversation.reset();
  return { text };
}

// Holat yangilash (bajarildi/bekor qilindi).
async function handleStatusUpdate(fields) {
  const service = await findServiceForUpdate({
    name: fields.targetClientName || fields.clientName,
    phone: fields.targetPhone || fields.clientPhone,
  });
  if (!service) {
    return { text: '🔍 Mos xizmat topilmadi. Mijoz ismi yoki telefonini aniqroq ayting.' };
  }

  const newStatus = fields.newStatus || SERVICE_STATUS.DONE;
  if (newStatus === SERVICE_STATUS.CANCELLED) {
    await cancelService(service._id);
    return { text: `🔴 "${service.clientName}" xizmati bekor qilindi.` };
  }

  // Bajarildi — to'langan deb hisoblaymiz (naqd odat), daromad yoziladi.
  const updated = await completeService(service._id, { markPaid: true });
  return {
    text: `🟢 "${updated.clientName}" xizmati bajarildi.\n💰 Daromad yozildi: ${formatMoney(
      updated.price
    )}`,
  };
}

// To'lov qabul qilish.
async function handlePaymentUpdate(fields) {
  const client = await findClient({
    name: fields.targetClientName || fields.clientName,
    phone: fields.targetPhone || fields.clientPhone,
  });
  if (!client) {
    return { text: '🔍 Mijoz topilmadi. Ismi yoki telefonini aniqroq ayting.' };
  }
  const amount = fields.paymentAmount || fields.amount;
  if (!amount) {
    return { text: `💵 ${client.name} qancha to'lov qildi? Summani yuboring.` };
  }
  const { client: updated } = await recordPayment({ clientId: client._id, amount });
  return {
    text: `✅ To'lov qabul qilindi: ${formatMoney(amount)}\n👤 ${updated.name}\n💳 Qolgan qarz: ${formatMoney(
      updated.totalDebt
    )}`,
  };
}

// Qidiruv.
async function handleSearch({ fields, question }) {
  const results = await searchServices({
    text: fields.searchText || '',
    dateFrom: fields.dateFrom || null,
    dateTo: fields.dateTo || null,
    limit: 20,
  });
  if (results.length === 0) {
    return { text: '🔍 Hech narsa topilmadi.' };
  }
  const lines = results.slice(0, 20).map((s, i) => serviceListLine(s, i));
  return { text: `🔍 Topildi (${results.length} ta):\n\n${lines.join('\n')}` };
}

// Analitika.
async function handleAnalytics({ fields }) {
  const metric = fields.analyticsMetric || 'profit';
  const period = fields.analyticsPeriod || 'month';

  if (metric === 'debt') {
    const { clients, total } = await listDebts();
    if (clients.length === 0) return { text: '✅ Qarzdorlar yo\'q.' };
    const lines = clients
      .slice(0, 20)
      .map((c, i) => `${i + 1}. ${c.name} — ${formatMoney(c.totalDebt)}`);
    return { text: `📋 Qarzdorlar (jami ${formatMoney(total)}):\n\n${lines.join('\n')}` };
  }

  const summary = await getSummary(period);
  const periodLabel = {
    today: 'Bugun',
    month: 'Bu oy',
    last_month: 'O\'tgan oy',
    year: 'Bu yil',
    all: 'Hammasi',
  }[period] || period;

  const lines = [
    `📊 ${periodLabel}:`,
    `💰 Daromad: ${formatMoney(summary.income)}`,
    `💸 Xarajat: ${formatMoney(summary.expense)}`,
    `🧮 Sof balans: ${formatMoney(summary.balance)}`,
  ];
  return { text: lines.join('\n') };
}

export default { runAgent };
