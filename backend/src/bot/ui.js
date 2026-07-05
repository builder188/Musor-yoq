import { InlineKeyboard } from 'grammy';
import { formatMoney, formatConversionLine } from '../utils/money.js';
import { formatKg } from '../services/materialService.js';
import { formatPhone } from '../utils/phone.js';
import { formatDateTime, formatTime, dayWord } from '../utils/dates.js';
import { encodeCoords } from './location.js';
import { missingEntryFields, FIELD_LABELS } from './flow.js';
import { miniAppUrl } from '../config/env.js';

export function formatBotDateTime(value) {
  return formatDateTime(value);
}

export function formatBotTime(value) {
  return formatTime(value);
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

// Xarajat toifasi -> ko'rsatiladigan o'zbekcha nom (saqlash xulosasi uchun).
// Dinamik kategoriya (ro'yxatda yo'q nom) o'z nomi bilan ko'rsatiladi.
const ENTRY_CATEGORY_LABEL = {
  yoqilgi: "Yoqilg'i",
  tamirlash: "Ta'mirlash",
  'oziq-ovqat': 'Oziq-ovqat',
  svalka: 'Svalka',
  boshqa_chiqim: 'Boshqa',
  boshqa_kirim: 'Boshqa kirim',
};

function entryCategoryLabel(category) {
  return ENTRY_CATEGORY_LABEL[category] || category || 'Boshqa';
}

// MULTI-ENTRY xulosasi: bitta xabarda aytilgan bir nechta yozuv (kirim/chiqim/xizmat/
// material/buyum aralash bo'lishi mumkin) — har biri ALOHIDA saqlangani raqamli ro'yxat
// + jami bilan ko'rsatiladi.
const KEYCAP_NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

function multiRecordLine(r) {
  const sum = typeof r.amount === 'number' && r.amount > 0 ? formatMoney(r.amount) : 'Summa aytilmagan';
  switch (r.kind) {
    case 'income':
      return `💰 ${sum} | ${entryCategoryLabel(r.category) || 'Kirim'}${r.description ? ` — ${r.description}` : ''}`;
    case 'service':
      return `👤 Xizmat: ${r.name || '-'} — ${sum}`;
    case 'material_sale':
      return `♻️ ${r.quantityKg > 0 ? `${formatKg(r.quantityKg)} kg ` : ''}${r.name || 'Material'} — ${sum}`;
    case 'item_sale':
      return `📦 ${r.name || 'Buyum'} sotildi — ${sum}`;
    case 'item_giveaway':
      return `📦 ${r.name || 'Buyum'} tekinga berildi`;
    default: // expense
      return `💸 ${sum} | ${entryCategoryLabel(r.category)}${r.description ? ` — ${r.description}` : ''}`;
  }
}

export function multiSavedSummaryText(records = []) {
  const lines = [`Bo'ldi oka, hammasini yozdim ✅ (${records.length} ta yozuv)`];
  records.forEach((r, i) => {
    lines.push(`${KEYCAP_NUMBERS[i] || `${i + 1})`} ${multiRecordLine(r)}`);
  });
  // Xizmat puli xulosa jamiga kirmaydi (kelajak xizmat hali olinmagan bo'lishi mumkin;
  // tarixiy xizmat daromadi balansga o'z oqimida allaqachon yozilgan).
  const incomeTotal = records
    .filter((r) => r.kind === 'income' || r.kind === 'material_sale' || r.kind === 'item_sale')
    .reduce((s, r) => s + (r.amount || 0), 0);
  const expenseTotal = records.filter((r) => r.kind === 'expense').reduce((s, r) => s + (r.amount || 0), 0);
  if (incomeTotal > 0) lines.push(`💰 Jami kirim: ${formatMoney(incomeTotal)}`);
  if (expenseTotal > 0) lines.push(`💸 Jami chiqim: ${formatMoney(expenseTotal)}`);
  lines.push("Bittasini o'zgartirish/bekor qilish: '2-sini 120 ming qil' yoki '2-sini bekor qil'.");
  return lines.join('\n');
}

function hasNumber(value) {
  return typeof value === 'number' && value > 0;
}

// Saqlangan yozuvning AYTILGAN maydonlarini ko'rsatadigan qatorlar (bo'shlari chiqmaydi).
function savedFieldLines(intent, fields) {
  const lines = [];
  if (intent === 'SERVICE_ENTRY') {
    if (fields._partnerVisit) lines.push('🤝 Hamkorlik tashrifi (standart qiymatlar bilan)');
    if (fields.clientName) lines.push(`👤 ${fields.clientName}`);
    if (fields.clientPhone) lines.push(`☎️ ${formatPhone(fields.clientPhone) || fields.clientPhone}`);
    const location = fields.location?.address || fields.location;
    if (location) lines.push(`📍 ${location}`);
    if (fields.serviceDateTime) lines.push(`📅 ${formatBotDateTime(fields.serviceDateTime)}`);
    if (hasNumber(fields.price)) lines.push(`💰 ${formatMoney(fields.price)}`);
    if (fields.notes) lines.push(`📝 ${fields.notes}`);
    return lines;
  }
  if (intent === 'PARTNER_CONTRACT') {
    lines.push(`🤝 Hamkorlik: ${fields.clientName || '-'}`);
    if (hasNumber(fields.price)) lines.push(`💰 Standart narx: ${formatMoney(fields.price)}`);
    const location = fields.location?.address || fields.location;
    if (location) lines.push(`📍 Standart manzil: ${location}`);
    if (fields.clientPhone) lines.push(`☎️ ${formatPhone(fields.clientPhone) || fields.clientPhone}`);
    lines.push(`Endi "${fields.clientName || 'hamkor'}ga bordim" desangiz — standart narx bilan darhol yozaman.`);
    return lines;
  }
  if (intent === 'MATERIAL_SALE') {
    const qty = hasNumber(fields.quantityKg) ? `${formatKg(fields.quantityKg)} kg ` : '';
    lines.push(`♻️ ${qty}${fields.materialName || 'Material'}${hasNumber(fields.amount) ? ` — 💰 ${formatMoney(fields.amount)}` : ''}`);
    if (hasNumber(fields.pricePerKg)) lines.push(`📊 1 kg: ${formatMoney(fields.pricePerKg)}`);
    return lines;
  }
  if (intent === 'ITEM_ENTRY') {
    lines.push(`📦 Buyum: ${fields.itemName || '-'}`);
    if (hasNumber(fields.estimatedPrice)) lines.push(`💰 Taxminiy narx: ${formatMoney(fields.estimatedPrice)}`);
    if (fields.sourceType === 'voice') lines.push('🎙 Manba: ovozli xabar biriktirildi');
    if (fields.notes) lines.push(`📝 ${fields.notes}`);
    return lines;
  }
  if (intent === 'ITEM_SALE') {
    lines.push(`📦 ${fields.itemName || 'Buyum'} sotildi${hasNumber(fields.amount) ? ` — 💰 ${formatMoney(fields.amount)}` : ''}`);
    if (fields.recipient) lines.push(`👤 Oluvchi: ${fields.recipient}`);
    if (hasNumber(fields.amount)) lines.push('💰 Balansga kirim yozildi');
    else lines.push('⚖️ Summa aytilmagani uchun balansga hech narsa qo\'shilmadi');
    return lines;
  }
  if (intent === 'ITEM_GIVEAWAY') {
    lines.push(`📦 ${fields.itemName || 'Buyum'} tekinga berildi (balansga yozilmadi)`);
    if (fields.recipient) lines.push(`👤 Oluvchi: ${fields.recipient}`);
    if (fields.notes) lines.push(`📝 ${fields.notes}`);
    return lines;
  }
  if (intent === 'DEBT_REMINDER') {
    const taken = fields.direction === 'taken';
    lines.push(`🔔 Qarz eslatmasi — 👤 ${fields.person || '-'} ${taken ? '(men oldim)' : '(men berdim)'}`);
    if (hasNumber(fields.amount)) lines.push(`💰 ${formatMoney(fields.amount)}`);
    if (fields.dueDate) lines.push(`📅 ${formatBotDateTime(fields.dueDate)} da eslataman`);
    if (hasNumber(fields.amount) && fields.skipBalance !== true) {
      lines.push(taken ? "💰 Balansga qo'shildi" : '💸 Balansdan ayirildi');
    } else if (fields.skipBalance === true) {
      lines.push('⚖️ Balansga tegmadim (so\'raganingizdek)');
    }
    return lines;
  }
  if (intent === 'INCOME_ENTRY') {
    lines.push(`💰 ${hasNumber(fields.amount) ? formatMoney(fields.amount) : 'Summa aytilmagan'} | ${entryCategoryLabel(fields.category) || 'Kirim'}`);
    const desc = fields.description || fields.notes || fields.incomeSource;
    if (desc) lines.push(`📝 ${desc}`);
    return lines;
  }
  // EXPENSE_ENTRY
  lines.push(`💸 ${hasNumber(fields.amount) ? formatMoney(fields.amount) : 'Summa aytilmagan'} | ${entryCategoryLabel(fields.category)}`);
  const desc = fields.description || fields.notes;
  if (desc) lines.push(`📝 ${desc}`);
  return lines;
}

// Yozuv SAQLANGANDAN KEYINGI xulosa xabari (darhol-saqlash oqimi):
//  - stopped: foydalanuvchi to'xtatgan ("boshqa so'rama") — "Tushunarli oka..." ohangi.
//  - edited:  tahrirdan keyin yangilangan xulosa.
// Aytilmagan (bo'sh qolgan) so'raladigan maydonlar "❕Aytilmagan:" qatorida ko'rsatiladi.
export function savedSummaryText(intent, fields = {}, { stopped = false, edited = false } = {}) {
  const header = edited
    ? "Bo'ldi oka, yozuvni yangiladim ✅"
    : stopped
      ? "Tushunarli oka, ma'lumotlarni saqladim ✅"
      : "Boldi oka, yozib qo'ydim ✅";
  const lines = [header, EMOJI_DIVIDER, ...savedFieldLines(intent, fields)];
  const conv = conversionLineFor(fields); // dollar bo'lsa: "💵 100$ → ... so'm (kurs ...)"
  if (conv) lines.push(conv);
  let missing = missingEntryFields(intent, fields);
  // Hamkor tashrifida telefon kutilmaydi (hamkor ko'pincha korxona) — "Aytilmagan"da chiqarmaymiz.
  if (fields._partnerVisit) missing = missing.filter((f) => f !== 'clientPhone');
  if (missing.length) {
    lines.push(`❕Aytilmagan: ${missing.map((f) => FIELD_LABELS[f] || f).join(', ')}`);
  }
  lines.push(EMOJI_DIVIDER);
  return lines.join('\n');
}

// Saqlangan yozuv uchun intentga mos Mini App sahifasi (tab) havolasi.
const INTENT_TAB = {
  SERVICE_ENTRY: 'services',
  PARTNER_CONTRACT: 'clients',
  EXPENSE_ENTRY: 'finance',
  INCOME_ENTRY: 'finance',
  MATERIAL_SALE: 'finance',
  ITEM_ENTRY: 'categories',
  ITEM_SALE: 'categories',
  ITEM_GIVEAWAY: 'categories',
  DEBT_REMINDER: 'reminders',
};

function miniAppTabUrl(intent) {
  const base = miniAppUrl();
  if (!base) return null;
  return `${base}/?tab=${INTENT_TAB[intent] || 'home'}`;
}

// Saqlangandan KEYINGI 3 tugma: [✏️ Tahrirlash][❌ Bekor qilish][📱 Ilovaga o'tish].
// Tahrirlash — ALLAQACHON saqlangan yozuvni joyida yangilaydi; Bekor qilish — uni
// o'chiradi (kodsiz, chunki hozirgina kiritilgan); Ilovaga o'tish — mos sahifani ochadi.
// Matn/ovoz javobi ham qabul qilinadi (message.routeSavedEntry).
export function savedEntryKeyboard(intent) {
  const keyboard = new InlineKeyboard()
    .text('✏️ Tahrirlash', 'saved_edit')
    .text('❌ Bekor qilish', 'saved_cancel');
  const url = miniAppTabUrl(intent);
  if (url) keyboard.row().webApp("📱 Ilovaga o'tish", url);
  return keyboard;
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

// Qarz eslatmasi vaqti kelganda (dueDate) — tugmali xabar ("hal bo'ldi" / "keyinroq").
export function debtReminderDueText(reminder) {
  const taken = reminder.direction === 'taken';
  const who = reminder.person || 'kimdir';
  const action = taken ? `${who}ga ${formatMoney(reminder.amount)} qarzni qaytarishingiz` : `${who}dan ${formatMoney(reminder.amount)} qarzni olishingiz`;
  const lines = [`🔔 Eslatma, oka! Bugun ${action} kerak.`];
  if (reminder.note) lines.push(`📝 ${reminder.note}`);
  return lines.join('\n');
}

export function debtReminderKeyboard(reminderId) {
  return new InlineKeyboard()
    .text('✅ Hal bo\'ldi', `debt_done_${reminderId}`)
    .text('📅 Keyinroq', `debt_snooze_${reminderId}`);
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
