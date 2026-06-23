// Route Telegram messages: text / voice / image / location -> Gemini -> agent.
import Conversation from '../../models/Conversation.js';
import Client from '../../models/Client.js';
import Service from '../../models/Service.js';
import { extractNotebookRecords, transcribeAudio, understandText } from '../../ai/gemini.js';
import { runAgent } from '../../ai/agent.js';
import { editService } from '../../services/serviceService.js';
import { computeReminders } from '../../services/reminderService.js';
import { mergeFields, nextMissing, parseReminderOffset, isEntryIntent, QUESTIONS } from '../flow.js';
import { downloadFile } from '../bot.js';
import {
  clientChoiceKeyboard,
  futureServiceKeyboard,
  locationQuestionKeyboard,
  locationReviewKeyboard,
  paymentConfirmKeyboard,
  paymentMethodKeyboard,
  saveKeyboard,
  serviceConfirmationText,
  ocrRecordKeyboard,
  ocrRecordText,
  formatBotDateTime,
} from '../ui.js';
import { formatMoney, parseMoney } from '../../utils/money.js';
import { parseHumanDateTime } from '../../utils/dates.js';
import { formatPhone } from '../../utils/phone.js';
import { normalizeLocationData, reverseGeocode } from '../location.js';

async function getConversation(telegramId) {
  let conv = await Conversation.findOne({ telegramId });
  if (!conv) conv = await Conversation.create({ telegramId });
  return conv;
}

// Gemini kalit/auth/kvota xatosini aniqlaydi. Bot faqat egasi uchun, shuning uchun
// umumiy "keyinroq urinib ko'ring" o'rniga aniq sababni ko'rsatamiz.
function isAiKeyError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('api key') ||
    msg.includes('api_key_invalid') ||
    msg.includes('permission denied') ||
    msg.includes('permission_denied') ||
    msg.includes('quota') ||
    msg.includes('resource_exhausted') ||
    msg.includes('401') ||
    msg.includes('403')
  );
}

// Egaga ko'rsatiladigan AI xato matni — kalit muammosida aniq yo'riq beradi.
async function replyAiError(ctx, err, genericText) {
  if (isAiKeyError(err)) {
    await ctx.reply(
      "AI kaliti ishlamayapti (GEMINI_API_KEY noto'g'ri, muddati o'tgan yoki kvota tugagan).\n" +
        "Railway → Variables bo'limida to'g'ri kalitni kiriting.\n" +
        'Kalit oling: https://aistudio.google.com/apikey'
    );
    return;
  }
  await ctx.reply(genericText);
}

export function registerMessageHandler(bot) {
  bot.on('message:location', async (ctx) => {
    const conv = await getConversation(ctx.from.id);
    const { latitude, longitude } = ctx.message.location;
    const address = await reverseGeocode(latitude, longitude);
    const coords = { lat: latitude, lng: longitude };
    const location = normalizeLocationData(address, coords);

    if (!(conv.pendingIntent && conv.awaitingField === 'location')) {
      conv.pendingIntent = 'LOCATION_QUESTION';
      conv.collected = { location };
      conv.awaitingField = null;
    } else {
      conv.collected = { ...conv.collected, pendingLocation: location };
    }
    conv.markModified('collected');
    await conv.save();
    if (ctx.session) {
      ctx.session.intent = conv.pendingIntent;
      ctx.session.collectedData = conv.collected || {};
      ctx.session.pendingLocation = location;
      ctx.session.pendingLocationRename = false;
      ctx.session.pendingLocationCoords = null;
      ctx.session.awaitingConfirmation = true;
      ctx.session.pendingField = conv.awaitingField;
    }
    await ctx.reply(`Manzil topildi:\n${address}\n\nShu nom bilan saqlaymi?`, {
      reply_markup: locationReviewKeyboard(coords),
    });
  });

  bot.on('message:voice', async (ctx) => {
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      const buffer = await downloadFile(ctx.message.voice.file_id, ctx.api);
      const transcription = await transcribeAudio(buffer, ctx.message.voice.mime_type || 'audio/ogg');
      const understanding = await understandText(transcription);
      await routeUnderstanding(ctx, { ...understanding, transcription }, transcription);
    } catch (err) {
      console.error('Ovozni qayta ishlash xatosi:', err.message);
      await replyAiError(ctx, err, "Ovozni tushunolmadim. Iltimos, qayta urinib ko'ring yoki matn yozing.");
    }
  });

  bot.on('message:audio', async (ctx) => {
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      const buffer = await downloadFile(ctx.message.audio.file_id, ctx.api);
      const transcription = await transcribeAudio(buffer, ctx.message.audio.mime_type || 'audio/mpeg');
      const understanding = await understandText(transcription);
      await routeUnderstanding(ctx, { ...understanding, transcription }, transcription);
    } catch (err) {
      console.error('Audio xatosi:', err.message);
      await replyAiError(ctx, err, "Audioni tushunolmadim. Matn ko'rinishida yuboring.");
    }
  });

  bot.on('message:photo', async (ctx) => {
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      const photo = ctx.message.photo[ctx.message.photo.length - 1];
      const buffer = await downloadFile(photo.file_id, ctx.api);
      const records = await extractNotebookRecords(buffer, 'image/jpeg', ctx.message.caption || '');
      await routeImageRecords(ctx, records, photo.file_id);
    } catch (err) {
      console.error('Rasm xatosi:', err.message);
      await replyAiError(ctx, err, "Rasmni o'qiy olmadim. Aniqroq surat yuboring yoki matn yozing.");
    }
  });

  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text;
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      const conv = await getConversation(ctx.from.id);
      // Universal chiqish: istalgan yarim qolgan oqimdan (reschedule, eslatma,
      // lokatsiya nomi, slot-filling, OCR) "bekor" bilan chiqish — holatlar
      // aralashib qolib foydalanuvchi qopqonga tushmasligi uchun.
      if (/^(bekor|otmen|otmena|cancel|to'?xtat|toxtat|stop)\b/i.test(text.trim())) {
        await conv.reset();
        clearAllSessionState(ctx);
        await ctx.reply('Bekor qilindi.');
        return;
      }
      // Eng yuqori ustuvorlik: maxsus eslatma vaqti kutilyapti.
      if (ctx.session?.awaitingReminderConfig) {
        return handleReminderConfig(ctx, text);
      }
      // Uzaytirish uchun sana kutilyapti.
      if (ctx.session?.awaitingReschedule || conv.pendingIntent === 'SERVICE_RESCHEDULE') {
        return routeServiceReschedule(ctx, conv, text);
      }
      if (conv.pendingIntent === 'IMAGE_RECORD_CONFIRM') {
        return routeImageConfirmation(ctx, conv, text);
      }
      if (ctx.session?.pendingLocationRename) {
        return routeLocationRename(ctx, conv, text);
      }
      // Foydalanuvchi OCR navbati ochiq turganda boshqa narsa yozsa — navbatni bekor qilamiz.
      if (ctx.session?.ocrQueue?.length > 0) {
        ctx.session.ocrQueue = [];
        ctx.session.currentOcrIndex = 0;
      }
      const fuzzyPayment = await maybeRouteFuzzyClientPayment(ctx, conv, text);
      if (fuzzyPayment) return;

      const understanding = await understandText(text);
      await routeUnderstanding(ctx, understanding, text);
    } catch (err) {
      console.error('Matn NLU xatosi:', err.message);
      await replyAiError(ctx, err, "AI bilan bog'lanishda xatolik. Birozdan keyin urinib ko'ring.");
    }
  });

  // Qo'llab-quvvatlanmaydigan turlar — bot faqat matn/ovoz/rasm/lokatsiya bilan ishlaydi.
  const unsupported = ['message:document', 'message:video', 'message:sticker', 'message:animation', 'message:video_note'];
  for (const filter of unsupported) {
    bot.on(filter, (ctx) => ctx.reply('Men bunday qabul qilmayman oka 🙂'));
  }
}

async function handleReminderConfig(ctx, text) {
  const serviceId = ctx.session?.awaitingReminderConfig;
  const minutes = parseReminderOffset(text);
  if (minutes === null) {
    await ctx.reply("Tushunmadim. Masalan: '2 soat oldin', '30 daqiqa oldin' yoki 'xizmat vaqtida'.");
    return;
  }
  const service = await Service.findOne({ _id: serviceId, isDeleted: { $ne: true } });
  if (!service) {
    if (ctx.session) ctx.session.awaitingReminderConfig = null;
    await ctx.reply('Xizmat topilmadi.');
    return;
  }

  // Yuborilgan eslatmalarni saqlab, qolganini yangi maxsus ofset bilan almashtiramiz.
  const sent = (service.reminders || []).filter((r) => r.sent);
  const fresh = await computeReminders(service.serviceDateTime, [minutes]);
  service.reminders = [...sent, ...fresh];
  await service.save();
  if (ctx.session) ctx.session.awaitingReminderConfig = null;

  if (!fresh.length) {
    await ctx.reply("Bu vaqt allaqachon o'tib ketgan, eslatma qo'shilmadi.");
    return;
  }
  await ctx.reply(`Eslatma sozlandi: ${reminderOffsetLabel(minutes)}.`);
}

function reminderOffsetLabel(minutes) {
  if (minutes === 0) return 'xizmat vaqtida';
  if (minutes % 1440 === 0) return `${minutes / 1440} kun oldin`;
  if (minutes % 60 === 0) return `${minutes / 60} soat oldin`;
  return `${minutes} daqiqa oldin`;
}

async function routeServiceReschedule(ctx, conv, text) {
  // Nisbiy ("ertaga soat 15", "2 kundan keyin") va aniq ("2026-06-12 15:30") sanani tushunadi.
  const date = parseHumanDateTime(text);
  if (!date || Number.isNaN(date.getTime())) {
    await ctx.reply("Sanani aniqroq yozing. Masalan: 'ertaga soat 15:00' yoki '2026-06-12 15:30'");
    return;
  }
  const serviceId =
    ctx.session?.awaitingReschedule || conv.collected?.serviceId || ctx.session?.collectedData?.serviceId;
  if (!serviceId) {
    await conv.reset();
    if (ctx.session) ctx.session.awaitingReschedule = null;
    await ctx.reply('Xizmat topilmadi. Qaytadan urinib ko\'ring.');
    return;
  }
  await editService(serviceId, { serviceDateTime: date.toISOString() });
  await conv.reset();
  if (ctx.session) {
    ctx.session.intent = null;
    ctx.session.collectedData = {};
    ctx.session.pendingField = null;
    ctx.session.awaitingReschedule = null;
  }
  await ctx.reply(`Xizmat vaqti uzaytirildi: ${formatBotDateTime(date)}`);
}

async function maybeRouteFuzzyClientPayment(ctx, conv, text) {
  const match = text.match(/^(.+?)\s+(.+?)\s+(berdi|to'?ladi|toladi)$/i);
  if (!match) return false;

  const name = match[1].trim();
  const amount = parseMoney(match[2]);
  if (!name || !amount) return false;

  const rx = new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  const clients = await Client.find({ name: rx, isDeleted: { $ne: true } }).sort({ updatedAt: -1 }).limit(8).lean();
  if (!clients.length) return false;

  conv.pendingIntent = 'PAYMENT_CLIENT_CONFIRM';
  conv.collected = { amount, note: text, candidates: clients.map((client) => String(client._id)) };
  conv.awaitingField = clients.length === 1 ? 'confirmClient' : 'chooseClient';
  if (clients.length === 1) conv.collected.clientId = String(clients[0]._id);
  conv.markModified('collected');
  await conv.save();

  if (ctx.session) {
    ctx.session.intent = 'PAYMENT_CLIENT_CONFIRM';
    ctx.session.collectedData = conv.collected;
    ctx.session.pendingField = conv.awaitingField;
    ctx.session.awaitingConfirmation = true;
  }

  if (clients.length === 1) {
    const client = clients[0];
    await ctx.reply(
      `${client.name} (${formatPhone(client.phone) || client.phone})ga ${formatMoney(amount)} yozaymi?`,
      { reply_markup: paymentConfirmKeyboard() }
    );
    return true;
  }

  await ctx.reply(`Qaysi ${name}?`, { reply_markup: clientChoiceKeyboard(clients) });
  return true;
}

async function routeUnderstanding(ctx, understanding, rawText) {
  const conv = await getConversation(ctx.from.id);
  // Yangi NLU xabari (matn/ovoz/rasm) keldi — boshqa mini-oqimlarning eskirgan
  // session bayroqlarini tozalaymiz. Aks holda ovoz/rasm orqali kelgan xabar
  // reschedule/eslatma kutilishini chetlab o'tib, keyingi matnni noto'g'ri ushlaydi.
  if (ctx.session) {
    ctx.session.awaitingReschedule = null;
    ctx.session.awaitingReminderConfig = null;
    ctx.session.pendingLocationRename = false;
    ctx.session.pendingLocationCoords = null;
  }
  // Eskirgan non-entry tasdiq holati (reschedule, edit-tasdiq, lokatsiya savoli,
  // to'lov tasdiq) — bu yergacha yetgan xabar yangi buyruq, demak uni tashlaymiz.
  // Entry (slot-filling) holatini saqlaymiz: runAgent uni continueEntry'da davom ettiradi.
  if (conv.pendingIntent && !isEntryIntent(conv.pendingIntent)) {
    await conv.reset();
  }
  const res = await runAgent({ understanding, rawText, conversation: conv });
  await syncSessionFromConversation(ctx, conv);
  await sendAgentResult(ctx, res);
}

async function routeImageRecords(ctx, records, fileId) {
  if (!records.length) {
    await ctx.reply("Rasmdan aniq yozuv topilmadi. Iltimos, tiniqroq surat yuboring yoki matn qilib yozing.");
    return;
  }

  const conv = await getConversation(ctx.from.id);
  const recordsWithImage = records.map((record) => ({
    ...record,
    images: [{ fileId, type: 'telegram' }],
  }));

  // Bir nechta yozuv — birin-ketin tasdiqlash (Saqlash / O'tkazib yuborish).
  if (recordsWithImage.length > 1) {
    if (ctx.session) {
      ctx.session.ocrQueue = recordsWithImage;
      ctx.session.currentOcrIndex = 0;
      ctx.session.ocrSaved = 0;
      ctx.session.ocrSkipped = 0;
    }
    await ctx.reply(`Bu rasmda ${recordsWithImage.length} ta yozuv bor. Birma-bir ko'rib chiqamiz:`);
    await ctx.reply(ocrRecordText(recordsWithImage[0], 1, recordsWithImage.length), {
      reply_markup: ocrRecordKeyboard(),
    });
    return;
  }

  // Bitta yozuv — to'liq xulosa bilan tasdiq.
  conv.pendingIntent = 'IMAGE_RECORD_CONFIRM';
  conv.collected = { pendingData: recordsWithImage[0] };
  conv.awaitingField = 'confirmImageRecords';
  conv.markModified('collected');
  await conv.save();
  if (ctx.session) {
    ctx.session.intent = 'IMAGE_RECORD_CONFIRM';
    ctx.session.collectedData = conv.collected;
    ctx.session.pendingField = 'confirmImageRecords';
    ctx.session.awaitingConfirmation = true;
  }

  const summary = formatExtractedRecords(recordsWithImage);
  await ctx.reply(`${summary}\n\nSaqlashimmi?`, { reply_markup: saveKeyboard() });
}

async function routeImageConfirmation(ctx, conv, text) {
  const normalized = text.trim().toLowerCase();
  if (/^(yo'q|yoq|no|n|bekor|cancel|kerak emas)/i.test(normalized)) {
    await conv.reset();
    await ctx.reply('Rasmdagi yozuvlar bekor qilindi.');
    return;
  }

  if (/^(ha|xa|yes|y|ok|mayli|saqla)/i.test(normalized)) {
    const records = conv.collected?.records
      || (conv.collected?.pendingData ? [conv.collected.pendingData] : []);
    // Bitta yozuvda majburiy maydon yetishmasa — standart so'rash oqimiga ulaymiz.
    if (records.length === 1) {
      const asked = await startServiceAskFromRecord(ctx, conv, records[0]);
      if (asked) return;
    }
    const result = await saveConfirmedImageRecords(records);
    await conv.reset();
    await ctx.reply(result);
    return;
  }

  await ctx.reply("Iltimos, 'ha' yoki 'yo'q' deb javob bering.");
}

// OCR yozuvida majburiy maydon yetishsa, uni standart SERVICE_ENTRY slot-filling
// oqimiga ulaydi (telefon/manzil/narx/to'lov... bittalab so'raladi). To'liq bo'lsa false.
async function startServiceAskFromRecord(ctx, conv, record) {
  const fields = mergeFields({}, record);
  const missing = nextMissing('SERVICE_ENTRY', fields);
  if (!missing) return false;
  conv.pendingIntent = 'SERVICE_ENTRY';
  conv.collected = fields;
  conv.awaitingField = missing;
  conv.markModified('collected');
  await conv.save();
  await syncSessionFromConversation(ctx, conv);
  const keyboard = missing === 'paymentMethod' ? paymentMethodKeyboard() : null;
  await ctx.reply(
    `Rasmdagi ba'zi ma'lumot to'liq emas.\n${QUESTIONS[missing] || missing}`,
    keyboard ? { reply_markup: keyboard } : undefined
  );
  return true;
}

async function routeLocationRename(ctx, conv, text) {
  const customName = text.trim();
  if (!customName || customName.length < 3) {
    await ctx.reply("Manzil nomini aniqroq yozing. Masalan: Shayxontohur, Navro'z bozori yaqini.");
    return;
  }

  const coords = ctx.session?.pendingLocationCoords
    || ctx.session?.pendingLocation?.coordinates
    || conv.collected?.pendingLocation?.coordinates
    || conv.collected?.location?.coordinates;
  if (!coords || !Number.isFinite(Number(coords.lat)) || !Number.isFinite(Number(coords.lng))) {
    ctx.session.pendingLocationRename = false;
    ctx.session.pendingLocationCoords = null;
    await ctx.reply('Koordinata topilmadi. Lokatsiyani qayta yuboring.');
    return;
  }

  const location = normalizeLocationData(customName, coords);
  ctx.session.pendingLocationRename = false;
  ctx.session.pendingLocationCoords = null;
  ctx.session.pendingLocation = null;

  if (conv.pendingIntent && conv.awaitingField === 'location') {
    conv.collected = { ...(conv.collected || {}), location };
    delete conv.collected.pendingLocation;
    conv.markModified('collected');
    await conv.save();
    const res = await runAgent({
      understanding: { intent: conv.pendingIntent, fields: {}, reply: '', confidence: 1 },
      rawText: customName,
      conversation: conv,
    });
    await syncSessionFromConversation(ctx, conv);
    await ctx.reply(`Manzil saqlandi: ${customName}`);
    await sendAgentResult(ctx, res);
    return;
  }

  conv.pendingIntent = 'LOCATION_QUESTION';
  conv.collected = { location };
  conv.awaitingField = null;
  conv.markModified('collected');
  await conv.save();
  ctx.session.intent = 'LOCATION_QUESTION';
  ctx.session.collectedData = { location };
  ctx.session.pendingField = null;
  ctx.session.awaitingConfirmation = true;
  await ctx.reply(`Manzil saqlandi: ${customName}\n\nBu manzil yangi xizmat uchunmi?`, {
    reply_markup: locationQuestionKeyboard(),
  });
}

async function sendAgentResult(ctx, res) {
  if (res?.tool === 'create_service' && res.result) {
    await ctx.reply(serviceConfirmationText(res.result));
    if (new Date(res.result.serviceDateTime).getTime() > Date.now()) {
      await ctx.reply('Eslatma sozlamasi:', {
        reply_markup: futureServiceKeyboard(res.result.id || res.result._id),
      });
    }
    if (ctx.session) ctx.session.lastServiceId = res.result.id || res.result._id || null;
    return;
  }
  await ctx.reply(res.text, res.keyboard ? { reply_markup: res.keyboard } : undefined);
}

async function syncSessionFromConversation(ctx, conv) {
  if (!ctx.session || !conv) return;
  ctx.session.intent = conv.pendingIntent;
  ctx.session.collectedData = conv.collected || {};
  ctx.session.pendingField = conv.awaitingField;
  ctx.session.awaitingConfirmation = conv.pendingIntent === 'IMAGE_RECORD_CONFIRM';
}

// Barcha session sub-holatlarini tozalash (universal "bekor" uchun).
function clearAllSessionState(ctx) {
  if (!ctx.session) return;
  ctx.session.intent = null;
  ctx.session.collectedData = {};
  ctx.session.pendingField = null;
  ctx.session.awaitingConfirmation = false;
  ctx.session.lastServiceId = null;
  ctx.session.awaitingReschedule = null;
  ctx.session.awaitingReminderConfig = null;
  ctx.session.pendingLocation = null;
  ctx.session.pendingLocationRename = false;
  ctx.session.pendingLocationCoords = null;
  ctx.session.ocrQueue = [];
  ctx.session.currentOcrIndex = 0;
  ctx.session.ocrSaved = 0;
  ctx.session.ocrSkipped = 0;
}

function formatExtractedRecords(records) {
  if (records.length > 1) {
    const lines = records.map((record, index) => `${index + 1}. ${record.clientName || '-'} | ${record.clientPhone || '-'} | ${record.location || '-'} | ${record.price ? formatMoney(record.price) : '-'}`);
    return `Bu rasmda ${records.length} ta yozuv bor:\n${lines.join('\n')}`;
  }
  const record = records[0];
  return [
    'Rasmdan topilgan maʼlumot:',
    `Mijoz: ${record.clientName || '-'}`,
    `Tel: ${record.clientPhone || '-'}`,
    `Manzil: ${record.location || '-'}`,
    `Sana: ${record.serviceDateTime ? formatBotDateTime(record.serviceDateTime) : '-'}`,
    `Narx: ${record.price ? formatMoney(record.price) : '-'}`,
    `To'lov: ${record.paymentMethod || '-'}`,
    record.notes ? `Izoh: ${record.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

async function saveConfirmedImageRecords(records) {
  const saved = [];
  const skipped = [];

  for (const [index, record] of records.entries()) {
    const fields = mergeFields({}, record);
    const missing = nextMissing('SERVICE_ENTRY', fields);
    if (missing) {
      skipped.push({ index: index + 1, missing });
      continue;
    }

    try {
      const res = await runAgent({
        understanding: { intent: 'SERVICE_ENTRY', fields, reply: '', confidence: 0.85 },
        rawText: `OCR bulk record ${index + 1}: ${JSON.stringify(fields)}`,
        conversation: null,
      });
      saved.push(res);
    } catch (err) {
      skipped.push({ index: index + 1, missing: err.message || 'saqlash xatosi' });
    }
  }

  const lines = [];
  if (saved.length) lines.push(`${saved.length} ta yozuv saqlandi.`);
  if (skipped.length) {
    lines.push(`${skipped.length} ta yozuv saqlanmadi, chunki maydonlar yetishmaydi:`);
    for (const item of skipped) {
      lines.push(`${item.index}-yozuv: ${item.missing}`);
    }
  }
  return lines.join('\n') || 'Saqlash uchun toliq yozuv topilmadi.';
}
