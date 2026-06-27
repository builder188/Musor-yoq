import { InlineKeyboard } from 'grammy';
import { formatMoney, formatConversionLine } from '../utils/money.js';
import { formatKg } from '../services/materialService.js';
import { formatPhone } from '../utils/phone.js';
import { formatDateTime, formatTime, dayWord } from '../utils/dates.js';
import { encodeCoords } from './location.js';

function pad(value) {
  return String(value).padStart(2, '0');
}

export function formatBotDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatBotDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

export function formatBotTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Manzil matni. Xarita tugmasi faqat Mini App'dagi mapUrl orqali ko'rsatiladi.
export function locationLabel(service) {
  return service.location?.address || service.location || '-';
}

const EMOJI_DIVIDER = '━━━━━━━━━━━━━━━━━';

export function serviceConfirmationText(service) {
  const location = locationLabel(service);
  const lines = [
    "Boldi, yozib qo'ydim oka ✅",
    EMOJI_DIVIDER,
    `👤 ${service.clientName || '-'}`,
    `📱 ${formatPhone(service.clientPhone) || service.clientPhone || '-'}`,
    `📍 ${location}`,
    `📅 ${formatBotDateTime(service.serviceDateTime)}`,
    `💰 ${formatMoney(service.price)}`,
    `💳 ${service.paymentMethod || '-'}`,
  ];
  const conv = conversionLineFor(service);
  if (conv) lines.push(conv);
  if (service.notes) lines.push(`📝 ${service.notes}`);
  lines.push(EMOJI_DIVIDER);
  return lines.join('\n');
}

// Dollarda kelishilgan summa uchun shaffof konvertatsiya satri (bo'lmasa null).
function conversionLineFor(rec = {}) {
  if (rec._conversion) return formatConversionLine(rec._conversion);
  if (rec.originalCurrency === 'USD' && rec.originalAmount && rec.exchangeRateUsed) {
    return formatConversionLine({
      originalAmount: rec.originalAmount,
      rate: rec.exchangeRateUsed,
      uzsAmount: rec.price ?? rec.amount,
    });
  }
  return null;
}

// Tasdiqlash so'rovi (confirmAt kelganda) tugmalari — har xizmat o'z serviceId bilan.
export function confirmServiceKeyboard(serviceId) {
  return new InlineKeyboard()
    .text('✅ Bajarildi', `complete_${serviceId}`)
    .text('❌ Bekor qilindi', `cancel_direct_${serviceId}`)
    .row()
    .text('📅 Vaqt surildi', `reschedule_${serviceId}`);
}

export function saveKeyboard() {
  return new InlineKeyboard().text('Saqlash', 'save_yes').text('Bekor qilish', 'save_no');
}

export function locationQuestionKeyboard() {
  return new InlineKeyboard().text('Ha', 'location_service_yes').text("Yo'q", 'location_service_no');
}

export function locationConfirmKeyboard() {
  return new InlineKeyboard().text('Ha', 'use_location').text("Yo'q", 'ignore_location');
}

export function locationReviewKeyboard(coords) {
  const encoded = encodeCoords(coords?.lat, coords?.lng);
  if (!encoded) return locationConfirmKeyboard();
  return new InlineKeyboard()
    .text("Ha, to'g'ri", `loc_confirm_${encoded}`)
    .row()
    .text("Nomi o'zgartirish", `loc_rename_${encoded}`)
    .row()
    .text("Yo'q", 'ignore_location');
}

export function ocrRecordKeyboard() {
  return new InlineKeyboard().text('Saqlash', 'ocr_save').text("O'tkazib yuborish", 'ocr_skip');
}

export function ocrRecordText(record, index, total) {
  const price = typeof record.price === 'number' ? formatMoney(record.price) : '?';
  const when = record.serviceDateTime ? formatBotDateTime(record.serviceDateTime) : record.date || '?';
  return [
    `Yozuv ${index}/${total}:`,
    `Mijoz: ${record.clientName || '?'}`,
    `Tel: ${formatPhone(record.clientPhone) || record.clientPhone || '?'}`,
    `Manzil: ${record.location?.address || record.location || '?'}`,
    `Narx: ${price}`,
    `Sana: ${when}`,
  ].join('\n');
}

export function paymentConfirmKeyboard() {
  return new InlineKeyboard().text('Ha, yozing', 'payment_confirm_yes').text("Yo'q", 'payment_confirm_no');
}

export function editConfirmKeyboard() {
  return new InlineKeyboard().text('Ha', 'edit_confirm').text("Yo'q", 'edit_cancel');
}

// Xarajat toifasi -> ko'rsatiladigan o'zbekcha nom (yakuniy tasdiq xulosasi uchun).
const ENTRY_CATEGORY_LABEL = {
  yoqilgi: "Yoqilg'i",
  tamirlash: "Ta'mirlash",
  'oziq-ovqat': 'Oziq-ovqat',
  boshqa_chiqim: 'Boshqa',
};

// Yangi yozuv (SERVICE/EXPENSE/INCOME) saqlashdan OLDINGI yakuniy tekshirish xulosasi.
// Barcha majburiy maydonlar yig'ilgach ko'rsatiladi; entryConfirmKeyboard bilan birga.
export function entrySummaryText(intent, fields = {}) {
  const conv = conversionLineFor(fields); // dollar bo'lsa: "💵 100$ → ... so'm (kurs ...)"
  if (intent === 'SERVICE_ENTRY') {
    const location = fields.location?.address || fields.location || '-';
    const lines = [
      'Tekshirib chiqing oka:',
      `👤 ${fields.clientName || '-'}  📱 ${formatPhone(fields.clientPhone) || fields.clientPhone || '-'}  📍 ${location}`,
      `📅 ${fields.serviceDateTime ? formatBotDateTime(fields.serviceDateTime) : '-'}  💰 ${formatMoney(fields.price)}  💳 ${fields.paymentMethod || '-'}`,
    ];
    if (conv) lines.push(conv);
    lines.push("Hammasi to'g'rimi?");
    return lines.join('\n');
  }
  if (intent === 'MATERIAL_SALE') {
    const name = fields.materialName || 'Material';
    const qty = typeof fields.quantityKg === 'number' && fields.quantityKg > 0 ? `${formatKg(fields.quantityKg)} kg ` : '';
    const lines = ['Tekshirib chiqing oka:', `♻️ ${qty}${name} — 💰 ${formatMoney(fields.amount)}`];
    if (typeof fields.pricePerKg === 'number' && fields.pricePerKg > 0) {
      lines.push(`📊 1 kg: ${formatMoney(fields.pricePerKg)}`);
    }
    if (conv) lines.push(conv);
    lines.push("To'g'rimi?");
    return lines.join('\n');
  }
  if (intent === 'INCOME_ENTRY') {
    const desc = fields.description || fields.notes || fields.incomeSource || '-';
    const lines = ['Tekshirib chiqing:', `💰 ${formatMoney(fields.amount)} | Kirim`, `📝 ${desc}`];
    if (conv) lines.push(conv);
    lines.push("To'g'rimi?");
    return lines.join('\n');
  }
  // EXPENSE_ENTRY
  const desc = fields.description || fields.notes || '-';
  const category = ENTRY_CATEGORY_LABEL[fields.category] || 'Boshqa';
  const lines = ['Tekshirib chiqing:', `💸 ${formatMoney(fields.amount)} | ${category}`, `📝 ${desc}`];
  if (conv) lines.push(conv);
  lines.push("To'g'rimi?");
  return lines.join('\n');
}

// Yakuniy tasdiq tugmalari: [✅ Ha, to'g'ri][✏️ Yo'q, tahrirlash kerak][❌ Bekor qilish].
// Matn/ovoz javobi ham qabul qilinadi (message.routeEntryConfirmation).
export function entryConfirmKeyboard() {
  return new InlineKeyboard()
    .text("✅ Ha, to'g'ri", 'entry_save')
    .row()
    .text("✏️ Yo'q, tahrirlash kerak", 'entry_edit')
    .row()
    .text('❌ Bekor qilish', 'entry_cancel');
}

// CLARIFY — niyat noaniq bo'lganda tezkor tanlov tugmalari.
// Tanlovlar conversationda saqlanadi; callback faqat indeksni yuboradi (clarify_0, clarify_1, ...).
export function clarifyKeyboard(options = []) {
  const keyboard = new InlineKeyboard();
  options.slice(0, 3).forEach((opt, index) => {
    keyboard.text(opt.label, `clarify_${index}`).row();
  });
  keyboard.text('Bekor qilish', 'clarify_cancel');
  return keyboard;
}

export function pdfFilterKeyboard() {
  return new InlineKeyboard()
    .text("To'liq - bu oy", 'pdf:full:month')
    .text("To'liq - hammasi", 'pdf:full:all')
    .row()
    .text('Moliya - bu oy', 'pdf:finance:month')
    .text('Moliya - hammasi', 'pdf:finance:all')
    .row()
    .text('Xizmatlar - bu oy', 'pdf:services:month')
    .text('Mijozlar - hammasi', 'pdf:clients:all');
}

export function paymentMethodKeyboard() {
  return new InlineKeyboard()
    .text('Naqd', 'pm_naqd')
    .text('Karta', 'pm_karta')
    .text("O'tkazma", 'pm_otkazma');
}

export function clientChoiceKeyboard(clients) {
  const keyboard = new InlineKeyboard();
  clients.slice(0, 8).forEach((client) => {
    keyboard.text(`${client.name} (${formatPhone(client.phone) || client.phone})`, `payment_client_${client._id}`).row();
  });
  keyboard.text('Bekor qilish', 'payment_confirm_no');
  return keyboard;
}

// Generik mijoz tanlash (bir xil ismlilar uchun) — har qanday amalni davom ettiradi.
export function clientPickKeyboard(clients) {
  const keyboard = new InlineKeyboard();
  clients.slice(0, 8).forEach((client) => {
    keyboard.text(`${client.name} (${formatPhone(client.phone) || client.phone})`, `pick_client_${client._id}`).row();
  });
  keyboard.text('Bekor qilish', 'pick_cancel');
  return keyboard;
}

// Oddiy oldindan eslatma (reminderAt) — tugmasiz.
export function serviceReminderText(service) {
  return [
    `⏰ Oka, ${dayWord(service.serviceDateTime)} soat ${formatTime(service.serviceDateTime)}da ${service.clientName || 'mijoz'}ga borishingiz kerakligini eslatib qo'yaman.`,
    `📍 ${locationLabel(service)}  💰 ${formatMoney(service.price)}`,
  ].join('\n');
}

// Xizmat VAQTIDAGI eslatma — tugmasiz ("hozir borish vaqti keldi").
export function serviceStartReminderText(service) {
  return [
    `⏰ Oka, hozir ${service.clientName || 'mijoz'}ga borish vaqti keldi — soat ${formatTime(service.serviceDateTime)}.`,
    `📍 ${locationLabel(service)}  💰 ${formatMoney(service.price)}`,
  ].join('\n');
}

// Tasdiqlash so'rovi (confirmAt) — tugmali ("Bajarildimi?").
export function serviceConfirmText(service) {
  const phone = formatPhone(service.clientPhone) || service.clientPhone || '-';
  return [
    "❓ Xo'sh oka, bu xizmatni bajardingizmi?",
    `👤 ${service.clientName || '-'}  📱 ${phone}`,
    `📍 ${locationLabel(service)}  💰 ${formatMoney(service.price)}`,
  ].join('\n');
}

// Xizmat saqlangach: qachon eslatma/tasdiq yuborilishini bildiradi (avtomatik, tugmasiz).
export function reminderInfoLine(service) {
  if (!service || service.isHistorical) return null;
  const parts = [];
  const nowMs = Date.now();
  const svcMs = new Date(service.serviceDateTime).getTime();
  // Oldindan eslatma — faqat vaqti hali kelmagan va xizmat vaqtidan oldin bo'lsa.
  if (service.reminderAt && new Date(service.reminderAt).getTime() > nowMs && new Date(service.reminderAt).getTime() < svcMs) {
    parts.push(`⏰ ${formatDateTime(service.reminderAt)} da oldindan eslatib qo'yaman, oka`);
  }
  // Xizmat vaqtida ham eslatma (vaqti hali kelmagan bo'lsa).
  if (Number.isFinite(svcMs) && svcMs > nowMs) {
    parts.push(`⏰ Xizmat vaqtida (${formatDateTime(service.serviceDateTime)}) ham eslatib qo'yaman`);
  }
  if (service.confirmAt) {
    parts.push(`✅ ${formatDateTime(service.confirmAt)} da "bajardingizmi?" deb so'rayman`);
  }
  return parts.length ? parts.join('\n') : null;
}
