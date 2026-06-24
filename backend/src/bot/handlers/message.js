// Route Telegram messages: text / voice / image / location -> Gemini -> agent.
import Conversation from '../../models/Conversation.js';
import { extractNotebookRecords, transcribeAudio, understandText } from '../../ai/gemini.js';
import { runAgent } from '../../ai/agent.js';
import { editService } from '../../services/serviceService.js';
import { mergeFields, nextMissing, isEntryIntent, QUESTIONS } from '../flow.js';
import { downloadFile } from '../bot.js';
import {
  reminderInfoLine,
  locationQuestionKeyboard,
  locationReviewKeyboard,
  paymentMethodKeyboard,
  saveKeyboard,
  serviceConfirmationText,
  ocrRecordKeyboard,
  ocrRecordText,
  formatBotDateTime,
} from '../ui.js';
import { formatMoney } from '../../utils/money.js';
import { parseHumanDateTime } from '../../utils/dates.js';
import { normalizeLocationData, reverseGeocode } from '../location.js';
import {
  IMAGE_LIMIT_BYPASS_REPLY,
  UNSUPPORTED_MEDIA_REPLY,
  VIDEO_UNSUPPORTED_REPLY,
  VOICE_MAX_DURATION_SECONDS,
  VOICE_TOO_LONG_REPLY,
  enableImageLimitBypass,
  hasImageLimitBypassPhrase,
  imageLimitReply,
  reserveImageSlots,
} from '../mediaLimits.js';

const PHOTO_GROUP_SETTLE_MS = 1_000;
const pendingPhotoGroups = new Map();

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
      "Oka, AI kaliti ishlamayapti (GEMINI_API_KEY noto'g'ri, muddati o'tgan yoki kvota tugagan).\n" +
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
    await ctx.reply(`Manzilni topdim oka:\n${address}\n\nShu nom bilan saqlaymizmi?`, {
      reply_markup: locationReviewKeyboard(coords),
    });
  });

  bot.on('message:voice', async (ctx) => {
    if ((ctx.message.voice.duration || 0) > VOICE_MAX_DURATION_SECONDS) {
      await ctx.reply(VOICE_TOO_LONG_REPLY);
      return;
    }
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      const buffer = await downloadFile(ctx.message.voice.file_id, ctx.api);
      const transcription = await transcribeAudio(buffer, ctx.message.voice.mime_type || 'audio/ogg');
      await handleTextInput(ctx, transcription);
    } catch (err) {
      console.error('Ovozni qayta ishlash xatosi:', err.message);
      await replyAiError(ctx, err, "Ovozni tushunolmadim oka, yana bir marta yuboring yoki yozib bering.");
    }
  });

  bot.on('message:audio', async (ctx) => {
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      const buffer = await downloadFile(ctx.message.audio.file_id, ctx.api);
      const transcription = await transcribeAudio(buffer, ctx.message.audio.mime_type || 'audio/mpeg');
      await handleTextInput(ctx, transcription);
    } catch (err) {
      console.error('Audio xatosi:', err.message);
      await replyAiError(ctx, err, "Audioni tushunolmadim oka, yozib yuborsangiz bo'ladi.");
    }
  });

  bot.on('message:photo', async (ctx) => {
    if (await handleImageLimitBypassRequest(ctx, ctx.message.caption)) return;
    if (ctx.message.media_group_id) {
      await enqueuePhotoGroup(ctx);
      return;
    }
    await processPhotoBatch([ctx]);
  });

  bot.on('message:text', async (ctx) => {
    if (await handleImageLimitBypassRequest(ctx, ctx.message.text)) return;
    await ctx.replyWithChatAction('typing').catch(() => {});
    try {
      await handleTextInput(ctx, ctx.message.text);
    } catch (err) {
      console.error('Matn NLU xatosi:', err.message);
      await replyAiError(ctx, err, "Voy oka, hozir bir narsa chappa ketdi. Birozdan keyin yana urinib ko'ramiz.");
    }
  });

  // Qo'llab-quvvatlanmaydigan turlar — bot faqat matn/ovoz/rasm/lokatsiya bilan ishlaydi.
  bot.on('message:video', (ctx) => ctx.reply(VIDEO_UNSUPPORTED_REPLY));
  const unsupported = ['message:document', 'message:sticker', 'message:animation', 'message:video_note'];
  for (const filter of unsupported) {
    bot.on(filter, (ctx) => ctx.reply(UNSUPPORTED_MEDIA_REPLY));
  }
}

async function handleImageLimitBypassRequest(ctx, text) {
  if (!hasImageLimitBypassPhrase(text)) return false;
  enableImageLimitBypass(ctx.from.id);
  await ctx.reply(IMAGE_LIMIT_BYPASS_REPLY);
  return true;
}

function enqueuePhotoGroup(ctx) {
  const key = `${ctx.chat?.id || ctx.from.id}:${ctx.message.media_group_id}`;
  let group = pendingPhotoGroups.get(key);
  if (!group) {
    group = {
      items: [],
      timer: null,
      done: null,
      resolve: null,
    };
    group.done = new Promise((resolve) => {
      group.resolve = resolve;
    });
    pendingPhotoGroups.set(key, group);
  }

  group.items.push(ctx);
  if (group.timer) clearTimeout(group.timer);
  group.timer = setTimeout(async () => {
    try {
      await processPhotoBatch(group.items);
    } catch (err) {
      console.error('Rasm albomi xatosi:', err.message);
      await group.items[0]?.reply("Rasmlarni o'qiyolmadim oka, yana bir marta yuborib ko'ring.").catch(() => {});
    } finally {
      pendingPhotoGroups.delete(key);
      group.resolve();
    }
  }, PHOTO_GROUP_SETTLE_MS);

  return group.done;
}

async function processPhotoBatch(contexts) {
  const ordered = [...contexts].sort((a, b) => (a.message.message_id || 0) - (b.message.message_id || 0));
  const first = ordered[0];
  const limit = reserveImageSlots(first.from.id, ordered.length);
  if (!limit.allowed) {
    await first.reply(imageLimitReply(limit.retryAfterSeconds));
    return;
  }

  for (const item of ordered) {
    await processSinglePhoto(item);
  }
}

async function processSinglePhoto(ctx) {
  await ctx.replyWithChatAction('typing').catch(() => {});
  try {
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    const buffer = await downloadFile(photo.file_id, ctx.api);
    const records = await extractNotebookRecords(buffer, 'image/jpeg', ctx.message.caption || '');
    await routeImageRecords(ctx, records, photo.file_id);
  } catch (err) {
    console.error('Rasm xatosi:', err.message);
    await replyAiError(ctx, err, "Rasmni o'qiyolmadim oka, aniqroq suratga oling yoki yozib bering.");
  }
}

// Matn (yoki ovoz/audio transkripsiyasi) uchun yagona oqim: avval yarim qolgan
// holatlarni (reschedule, OCR tasdiq, lokatsiya nomi) tekshiradi, keyin NLU.
// Ovoz/audio ham shu yerga keladi — shuning uchun "vaqt surildi" ovoz bilan ham ishlaydi.
async function handleTextInput(ctx, text) {
  const conv = await getConversation(ctx.from.id);
  // Universal chiqish: istalgan yarim qolgan oqimdan "bekor" bilan chiqish.
  if (/^(bekor|otmen|otmena|cancel|to'?xtat|toxtat|stop)\b/i.test(text.trim())) {
    await conv.reset();
    clearAllSessionState(ctx);
    await ctx.reply('Boldi oka, bekor qildim.');
    return;
  }
  // "Vaqt surildi" uchun yangi sana kutilyapti (matn yoki ovoz).
  if (ctx.session?.awaitingReschedule || conv.pendingIntent === 'SERVICE_RESCHEDULE') {
    return routeServiceReschedule(ctx, conv, text);
  }
  if (conv.pendingIntent === 'IMAGE_RECORD_CONFIRM') {
    return routeImageConfirmation(ctx, conv, text);
  }
  if (ctx.session?.pendingLocationRename) {
    return routeLocationRename(ctx, conv, text);
  }
  // OCR navbati ochiq turganda boshqa narsa yozilsa — navbatni bekor qilamiz.
  if (ctx.session?.ocrQueue?.length > 0) {
    ctx.session.ocrQueue = [];
    ctx.session.currentOcrIndex = 0;
  }

  const understanding = await understandText(text);
  await routeUnderstanding(ctx, understanding, text);
}

async function routeServiceReschedule(ctx, conv, text) {
  // Nisbiy ("ertaga soat 15", "2 kundan keyin") va aniq ("2026-06-12 15:30") sanani tushunadi.
  const date = parseHumanDateTime(text);
  if (!date || Number.isNaN(date.getTime())) {
    await ctx.reply("Sanani aniqroq yozib bering oka. Masalan: 'ertaga soat 15:00' yoki '2026-06-12 15:30'");
    return;
  }
  const serviceId =
    ctx.session?.awaitingReschedule || conv.collected?.serviceId || ctx.session?.collectedData?.serviceId;
  if (!serviceId) {
    await conv.reset();
    if (ctx.session) ctx.session.awaitingReschedule = null;
    await ctx.reply("Xizmatni topolmadim oka, qaytadan urinib ko'ring.");
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
  await ctx.reply(`Boldi oka, xizmat vaqtini ${formatBotDateTime(date)} ga ko'chirdim ✅`);
}

async function routeUnderstanding(ctx, understanding, rawText) {
  const conv = await getConversation(ctx.from.id);
  // Yangi NLU xabari (matn/ovoz/rasm) keldi — boshqa mini-oqimlarning eskirgan
  // session bayroqlarini tozalaymiz. Aks holda ovoz/rasm orqali kelgan xabar
  // reschedule/eslatma kutilishini chetlab o'tib, keyingi matnni noto'g'ri ushlaydi.
  if (ctx.session) {
    ctx.session.awaitingReschedule = null;
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

  await ctx.reply("Oka, ‘ha’ yoki ‘yo’q’ deb javob bering.");
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
    await ctx.reply(`Manzilni oldim oka: ${customName}`);
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
  await ctx.reply(`Manzilni oldim oka: ${customName}\n\nBu manzil yangi xizmat uchunmi?`, {
    reply_markup: locationQuestionKeyboard(),
  });
}

async function sendAgentResult(ctx, res) {
  if (res?.tool === 'create_service' && res.result) {
    await ctx.reply(serviceConfirmationText(res.result));
    const info = reminderInfoLine(res.result);
    if (info) await ctx.reply(info);
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
