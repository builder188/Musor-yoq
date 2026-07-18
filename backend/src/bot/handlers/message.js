// Route Telegram messages: text / voice / image / location -> Gemini -> agent.
import Conversation from '../../models/Conversation.js';
import Service, { SERVICE_STATUS } from '../../models/Service.js';
import { extractNotebookRecords, transcribeAudio, understandText } from '../../ai/gemini.js';
import { runAgent, applyConfirmedEdit, editSavedEntry, cancelSavedEntry, classifyPostSaveMessage, confirmPendingUsefulItemMatch, handleMultiSavedText, handleFineAmountReply, resumeReturningEntry } from '../../ai/agent.js';
import { editService, completeService, cancelService, markServiceNotDone } from '../../services/serviceService.js';
import { mergeFields, nextMissing, isEntryIntent, QUESTIONS } from '../flow.js';
import { downloadFile } from '../bot.js';
import {
  reminderInfoLine,
  locationReviewKeyboard,
  paymentMethodKeyboard,
  saveKeyboard,
  editConfirmKeyboard,
  serviceConfirmationText,
  ocrRecordKeyboard,
  ocrRecordText,
  formatBotDateTime,
} from '../ui.js';
import { formatMoney } from '../../utils/money.js';
import { parseHumanDateTime } from '../../utils/dates.js';
import { normalizeLocationData, reverseGeocode } from '../location.js';
import { startLocationBind, routeLocationBindAnswer } from '../locationBind.js';
import { interpretYesNo, interpretSavedReply, interpretConfirmAction, matchClarifyOption } from '../answers.js';
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

// Gemini'ga yuboriladigan suhbat kontekstining uzunligi (oxirgi N xabar).
const HISTORY_LIMIT = 10;
// "Bajarildimi?" so'roviga tugmasiz (matn/ovoz) javob qabul qilinadigan oyna.
const CONFIRM_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
function isRecentConfirm(at) {
  if (!at) return false;
  const t = new Date(at).getTime();
  return Number.isFinite(t) && Date.now() - t <= CONFIRM_REPLY_WINDOW_MS;
}

// Universal "bekor" saqlangan yozuvni faqat YAQINDA saqlangan bo'lsa o'chiradi —
// muddatsiz bo'lsa, soatlar o'tib yozilgan "bekor" eski yozuvni kutilmaganda yo'q qilardi.
const SAVED_CANCEL_WINDOW_MS = 10 * 60 * 1000;
function isRecentSavedEntry(conv) {
  const at = conv?.collected?.savedAt ? new Date(conv.collected.savedAt).getTime() : 0;
  return Number.isFinite(at) && at > 0 && Date.now() - at <= SAVED_CANCEL_WINDOW_MS;
}

// Atomar upsert — avval findOne+create edi: ikki xabar parallel kelsa ikkalasi ham
// "yo'q" deb topib, biri unique index (telegramId) xatosi bilan yiqilardi.
async function getConversation(telegramId) {
  return Conversation.findOneAndUpdate(
    { telegramId },
    { $setOnInsert: { telegramId } },
    { upsert: true, new: true }
  );
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
    // Boshqa turlar kabi himoyalangan — aks holda xato jim bot.catch'ga tushib,
    // egasi lokatsiya qabul qilindi-qilinmadi bilmay qolardi.
    try {
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
    } catch (err) {
      console.error('Lokatsiya xatosi:', err?.stack || err?.message || err);
      await ctx.reply("Lokatsiyani saqlay olmadim oka, qaytadan yuborib ko'ring.").catch(() => {});
    }
  });

  bot.on('message:voice', async (ctx) => {
    if ((ctx.message.voice.duration || 0) > VOICE_MAX_DURATION_SECONDS) {
      await ctx.reply(VOICE_TOO_LONG_REPLY);
      return;
    }
    await handleVoiceLikeMessage(ctx, ctx.message.voice.file_id, ctx.message.voice.mime_type || 'audio/ogg');
  });

  bot.on('message:audio', async (ctx) => {
    await handleVoiceLikeMessage(ctx, ctx.message.audio.file_id, ctx.message.audio.mime_type || 'audio/mpeg');
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

// Ovoz/audio: TRANSKRIPSIYA va undan keyingi matn oqimi ALOHIDA try/catch'da.
// Avval ikkalasi bitta blokda edi — shu sabab NLU/agent xatosi ham "Ovozni
// tushunolmadim" bo'lib chiqib, asl sabab yashirinardi. Endi: transkripsiya xatosi
// -> "Ovozni tushunolmadim"; bo'sh transkripsiya -> aniq yo'riq; keyingi xato esa
// matn bilan bir xil umumiy xato (va replyAiError kalit muammosini ko'rsatadi).
async function handleVoiceLikeMessage(ctx, fileId, mime) {
  await ctx.replyWithChatAction('typing').catch(() => {});

  let transcription;
  try {
    const buffer = await downloadFile(fileId, ctx.api);
    transcription = (await transcribeAudio(buffer, mime) || '').trim();
  } catch (err) {
    console.error('Ovoz transkripsiya xatosi:', err.message);
    await replyAiError(ctx, err, "Ovozni tushunolmadim oka, yana bir marta yuboring yoki yozib bering.");
    return;
  }

  if (!transcription) {
    await ctx.reply("Ovozingizni eshitdim oka, lekin so'z chiqmadi. Sekinroq, aniqroq qaytadan yuboring yoki yozib bering.");
    return;
  }

  try {
    await handleTextInput(ctx, transcription, {
      type: 'voice',
      telegramFileId: fileId,
      mimeType: mime,
      duration: ctx.message.voice?.duration || ctx.message.audio?.duration || null,
      messageId: ctx.message.message_id || null,
    });
  } catch (err) {
    console.error('Ovozdan keyingi NLU xatosi:', err.message);
    await replyAiError(ctx, err, "Voy oka, hozir bir narsa chappa ketdi. Birozdan keyin yana urinib ko'ramiz.");
  }
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
async function handleTextInput(ctx, text, sourceMeta = null) {
  const conv = await getConversation(ctx.from.id);
  // Joriy xabardan OLDINGI tarixni olamiz (Gemini'ga kontekst); keyin xabarni yozamiz.
  const priorHistory = Array.isArray(conv.history) ? conv.history.slice(-HISTORY_LIMIT) : [];
  // Boshida faol oqim bormidi? (CLARIFY/disambiguatsiya tashlangach cron-tasdiqni
  // noto'g'ri qo'zg'atmaslik uchun asl holatni eslab qolamiz.)
  const hadPendingIntent = !!conv.pendingIntent;
  // Egasi xabarini suhbat tarixiga yozamiz (atomar; xatosi oqimni to'xtatmaydi).
  Conversation.pushHistory(ctx.from.id, 'user', text);

  // Universal chiqish: istalgan yarim qolgan oqimdan "bekor" bilan chiqish.
  // Yozuv YAQINDA (10 daqiqa ichida) saqlangan bo'lsa — o'sha yozuv o'chiriladi;
  // eskirgan bo'lsa faqat holat tozalanadi (yozuv joyida qoladi).
  if (/^(bekor|otmen|otmena|cancel|to'?xtat|toxtat|stop)\b/i.test(text.trim())) {
    if (conv.pendingIntent === 'ENTRY_SAVED' && isRecentSavedEntry(conv)) {
      try {
        const res = await cancelSavedEntry({ conversation: conv });
        clearAllSessionState(ctx);
        await ctx.reply(res.text);
        return;
      } catch {
        /* yozuv topilmasa — oddiy bekor bilan davom etamiz */
      }
    }
    await conv.reset();
    clearAllSessionState(ctx);
    await ctx.reply('Boldi oka, bekor qildim.');
    return;
  }
  // "Vaqt surildi" uchun yangi sana kutilyapti (matn yoki ovoz).
  if (ctx.session?.awaitingReschedule || conv.pendingIntent === 'SERVICE_RESCHEDULE') {
    return routeServiceReschedule(ctx, conv, text);
  }
  if (conv.pendingIntent === 'ENTRY_SAVED') {
    return routeSavedEntry(ctx, conv, text, priorHistory, sourceMeta);
  }
  if (conv.pendingIntent === 'ITEM_MATCH_CONFIRM') {
    return routeItemMatchConfirmation(ctx, conv, text);
  }
  // Jarima to'lovi uchun summa kutilyapti ("✅ To'ladim" bosilgan, summa noma'lum edi).
  if (conv.pendingIntent === 'FINE_AMOUNT') {
    return routeFineAmount(ctx, conv, text);
  }
  // Lokatsiya qatorga bog'lanmoqda: "qaysi xizmatga?" savoliga matn/ovoz javobi
  // (ism / telefon / qator raqami / "yangi").
  if (conv.pendingIntent === 'LOCATION_BIND') {
    await routeLocationBindAnswer(ctx, conv, text);
    return;
  }
  // Qaytgan mijoz taklifi ("shu ma'lumotlarni ishlataymi?") — matn/ovoz bilan ha/yo'q.
  if (conv.pendingIntent === 'RETURNING_CONFIRM') {
    return routeReturningConfirm(ctx, conv, text);
  }
  if (conv.pendingIntent === 'IMAGE_RECORD_CONFIRM') {
    return routeImageConfirmation(ctx, conv, text);
  }
  // Tugmali savollarga MATN/OVOZ bilan javob — tugma bosish SHART emas (callback bilan bir xil natija).
  if (conv.pendingIntent === 'EDIT_CONFIRM') {
    return routeEditConfirmation(ctx, conv, text);
  }
  if (ctx.session?.pendingLocationRename) {
    return routeLocationRename(ctx, conv, text);
  }
  if (conv.pendingIntent === 'LOCATION_QUESTION') {
    return routeLocationQuestion(ctx, conv, text);
  }
  if (conv.pendingIntent === 'CLARIFY') {
    // Tugmalardan birini matn bilan tanladimi? Ha — davom etamiz; yo'q — oddiy NLU.
    if (await routeClarifyChoice(ctx, conv, text)) return;
  } else if (conv.pendingIntent === 'CLIENT_DISAMBIGUATION') {
    if (await routeClientDisambiguation(ctx, conv, text)) return;
  }
  // OCR navbati ochiq turganda boshqa narsa yozilsa — navbatni bekor qilamiz.
  if (ctx.session?.ocrQueue?.length > 0) {
    ctx.session.ocrQueue = [];
    ctx.session.currentOcrIndex = 0;
  }
  // Faol oqim yo'q + yaqinda "bajarildimi?" so'ralgan bo'lsa — matn/ovoz javobini shu xizmatga bog'laymiz.
  if (!hadPendingIntent && conv.lastConfirmServiceId && isRecentConfirm(conv.lastConfirmAt)) {
    const action = interpretConfirmAction(text);
    if (action && (await routeServiceConfirm(ctx, conv, action))) return;
  }

  const understanding = await understandText(text, priorHistory);
  await routeUnderstanding(ctx, understanding, text, sourceMeta);
}

// Qaytgan mijoz taklifi javobi: "ha" — oxirgi ism/manzil/narx ishlatiladi; "yo'q" —
// foydalanuvchi o'zi aytadi (entry oqimi odatiy savollar bilan davom etadi).
// Ha/yo'q bo'lmagan javob ("manzili Chilonzor, 300 ming") — foydalanuvchi ma'lumotni
// O'ZI aytdi: takrorlab so'ramaymiz, entry holatini tiklab xabarni odatiy NLU oqimiga
// beramiz (aytilgan qiymatlar ustun, taklif qayta ko'rsatilmaydi).
async function routeReturningConfirm(ctx, conv, text) {
  const answer = interpretYesNo(text);
  try {
    if (answer !== null) {
      const res = await resumeReturningEntry({ conversation: conv, accept: answer === 'yes' });
      await syncSessionFromConversation(ctx, conv);
      await sendAgentResult(ctx, res);
      return;
    }
    const pending = conv.collected || {};
    conv.pendingIntent = pending.entryIntent || 'SERVICE_ENTRY';
    conv.collected = { ...(pending.entry || {}), _returningChecked: true };
    conv.awaitingField = null;
    conv.markModified('collected');
    await conv.save();
    const understanding = await understandText(text, []);
    const res = await runAgent({ understanding, rawText: text, conversation: conv });
    await syncSessionFromConversation(ctx, conv);
    await sendAgentResult(ctx, res);
  } catch (err) {
    await conv.reset();
    clearAllSessionState(ctx);
    await ctx.reply('Xatolik: ' + err.message);
  }
}

// Jarima summasi javobi (matn yoki ovoz transkripsiyasi) — to'lovni yozadi.
// Xato bo'lsa (yozuv topilmadi/allaqachon to'langan) holat tozalanadi, sabab aytiladi.
async function routeFineAmount(ctx, conv, text) {
  try {
    const res = await handleFineAmountReply({ conversation: conv, rawText: text });
    await ctx.reply(res.text);
  } catch (err) {
    await conv.reset();
    await ctx.reply(err?.message || "Voy oka, jarima to'lovini yozishda xatolik bo'ldi.");
  }
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

async function routeUnderstanding(ctx, understanding, rawText, sourceMeta = null) {
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
  const res = await runAgent({ understanding, rawText, conversation: conv, sourceMeta });
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

// Saqlangan yozuv xulosasiga (darhol-saqlash oqimi) matn/ovoz javobi:
//  - "bekor/o'chir"  -> ALLAQACHON saqlangan yozuv o'chiriladi (kodsiz)
//  - "tahrirla/yo'q" -> tahrir rejimi ("Nimani o'zgartiramiz?")
//  - "ha/rahmat/bo'ldi" -> shunchaki tasdiq, holat yopiladi
//  - qiymatli gap ("narxi 200 ming") -> NLU orqali: saqlangan yozuv tahririmi yoki
//    butunlay YANGI buyruqmi (yangi yozuv/savol) — shunga qarab yo'naltiriladi.
async function routeSavedEntry(ctx, conv, text, priorHistory, sourceMeta = null) {
  // Multi-entry to'plamida qisman bekor: "2-sini bekor qil" / "benzinni o'chir" —
  // faqat o'sha yozuv o'chiriladi ("hammasini bekor qil" — barchasi). Tahrir rejimida
  // ham ishlaydi (bekor fe'li bo'lmasa null qaytadi va odatiy routing davom etadi).
  if (conv.collected?.savedIntent === 'MULTI_ENTRY') {
    const multiRes = await handleMultiSavedText({ conversation: conv, text });
    if (multiRes) {
      await syncSessionFromConversation(ctx, conv);
      await ctx.reply(multiRes.text, multiRes.keyboard ? { reply_markup: multiRes.keyboard } : undefined);
      return;
    }
  }

  // Tahrir rejimida — keyingi gap to'g'ridan-to'g'ri maydon tuzatishdir.
  if (conv.awaitingField === 'editSaved') {
    return routeSavedEdit(ctx, conv, text, priorHistory);
  }

  const choice = interpretSavedReply(text);

  if (choice === 'cancel') {
    const res = await cancelSavedEntry({ conversation: conv });
    clearAllSessionState(ctx);
    await ctx.reply(res.text);
    return;
  }

  if (choice === 'edit') {
    conv.awaitingField = 'editSaved';
    await conv.save();
    if (ctx.session) ctx.session.pendingField = 'editSaved';
    await ctx.reply("Nimani o'zgartiramiz oka? Masalan: 'narxi 300 ming' yoki 'telefoni 90 123 45 67'");
    return;
  }

  if (choice === 'ack') {
    await conv.reset();
    clearAllSessionState(ctx);
    await ctx.reply('👍');
    return;
  }

  // Qiymatli gap — NLU hal qiladi: saqlangan yozuv tahririmi yoki yangi buyruqmi.
  const understanding = await understandText(text, priorHistory || []);
  const savedIntent = conv.collected?.savedIntent;
  if (classifyPostSaveMessage(understanding, savedIntent, text) === 'new') {
    await conv.reset();
    // sourceMeta uzatiladi — yangi yozuv ovozli kiritilgan bo'lsa, ovoz unga biriktiriladi.
    return routeUnderstanding(ctx, understanding, text, sourceMeta);
  }
  const res = await editSavedEntry({ conversation: conv, understanding, rawText: text });
  await syncSessionFromConversation(ctx, conv);
  await ctx.reply(res.text, res.keyboard ? { reply_markup: res.keyboard } : undefined);
}

async function routeItemMatchConfirmation(ctx, conv, text) {
  try {
    const res = await confirmPendingUsefulItemMatch({ conversation: conv, choiceText: text });
    if (!res.keepPending) clearAllSessionState(ctx);
    // Tanlov tasdiqlangach yozuv saqlanadi — post-save xulosa tugmalari bilan keladi.
    await ctx.reply(res.text, res.keyboard ? { reply_markup: res.keyboard } : undefined);
  } catch (err) {
    await conv.reset();
    clearAllSessionState(ctx);
    await ctx.reply('Xatolik: ' + err.message);
  }
}

// Tahrir loop'i: AI tuzatilgan maydonni SAQLANGAN yozuv ustida joyida yangilaydi
// (yangi yozuv yaratilmaydi), keyin yangilangan xulosa xuddi shu 3 tugma bilan ko'rsatiladi.
async function routeSavedEdit(ctx, conv, text, priorHistory) {
  const understanding = await understandText(text, priorHistory || []);
  try {
    const res = await editSavedEntry({ conversation: conv, understanding, rawText: text });
    await syncSessionFromConversation(ctx, conv);
    await ctx.reply(res.text, res.keyboard ? { reply_markup: res.keyboard } : undefined);
  } catch (err) {
    // Tahrir qo'llanmadi (masalan noto'g'ri telefon) — yozuv o'z holicha qoladi.
    await ctx.reply(`Qo'llay olmadim oka: ${err.message}\nQaytadan ayting yoki 'bekor' deng.`);
  }
}

// EDIT_CONFIRM (narx/sana/manzil/ism/telefon tahriri) — [Ha][Yo'q] tugmasiga matn/ovoz javobi.
// edit_confirm / edit_cancel callbacklari bilan bir xil natija.
async function routeEditConfirmation(ctx, conv, text) {
  const answer = interpretYesNo(text);
  if (answer === 'no') {
    await conv.reset();
    clearAllSessionState(ctx);
    await ctx.reply("Mayli oka, o'zgartirmadim.");
    return;
  }
  if (answer === 'yes') {
    const pending = conv.collected || {};
    if (!pending.editType || !pending.targetId) {
      await conv.reset();
      clearAllSessionState(ctx);
      await ctx.reply("O'zgartirish ma'lumotini topolmadim oka.");
      return;
    }
    try {
      const result = await applyConfirmedEdit(pending);
      await conv.reset();
      clearAllSessionState(ctx);
      const name = result.service?.clientName || result.client?.name || '';
      await ctx.reply(`Boldi oka, ${name} ma'lumotini yangiladim ✅`);
    } catch (err) {
      await ctx.reply('Xatolik: ' + err.message);
    }
    return;
  }
  await ctx.reply("O'zgartiraymi, oka? 'ha' yoki 'yo\'q' deb ayting.", { reply_markup: editConfirmKeyboard() });
}

// LOCATION_QUESTION (legacy: "Bu manzil yangi xizmat uchunmi?") — [Ha][Yo'q] tugmasiga
// matn/ovoz javobi. Ha/yo'q bo'lmagan javob endi BOG'LASH identifikatori deb qaraladi
// ("Sardor" / "+99890..." / "3-qator") — foydalanuvchi tugmani kutmasdan ham bog'lay oladi.
async function routeLocationQuestion(ctx, conv, text) {
  const answer = interpretYesNo(text);
  if (answer === null && conv.collected?.location) {
    await routeLocationBindAnswer(ctx, conv, text);
    return;
  }
  if (answer === 'no') {
    await conv.reset();
    clearAllSessionState(ctx);
    await ctx.reply("Mayli oka, joylashuvni qo'ydim ✅");
    return;
  }
  // "Ha" = manzil nomi tasdiqlandi ("Shu nom bilan saqlaymizmi?") — endi tugma bosilgandagi
  // (loc_confirm) kabi BOG'LASH savoliga o'tamiz: "Bu manzil qaysi xizmatga tegishli?"
  const location = conv.collected?.location;
  if (!location) {
    await conv.reset();
    clearAllSessionState(ctx);
    await ctx.reply('Joylashuvni topolmadim oka.');
    return;
  }
  await startLocationBind(ctx, conv, location);
}

// CLARIFY — tugmalardan birini matn/ovoz bilan tanlash (clarify_N callback bilan bir xil).
// true: tanlov topildi va bajarildi. false: mos kelmadi — CLARIFY tashlandi, oddiy NLU davom etadi.
async function routeClarifyChoice(ctx, conv, text) {
  const options = Array.isArray(conv.collected?.options) ? conv.collected.options : [];
  const choice = matchClarifyOption(text, options);
  if (!choice) {
    await conv.reset();
    return false;
  }
  const rawText = conv.collected?.rawText || '';
  const fields = conv.collected?.fields || {};
  await conv.reset();
  const res = await runAgent({
    understanding: { intent: choice.subIntent, fields, confidence: 1, reply: '' },
    rawText,
    conversation: conv,
  });
  await syncSessionFromConversation(ctx, conv);
  await sendAgentResult(ctx, res);
  return true;
}

// CLIENT_DISAMBIGUATION — bir xil ismli mijozlardan birini matn/ovoz bilan tanlash
// (tartib raqami "birinchi" yoki ism bo'yicha). pick_client_ callback bilan bir xil natija.
// Nomzodlar ({name, phone}) conversation'da saqlangan — alohida Client kolleksiyasi yo'q.
async function routeClientDisambiguation(ctx, conv, text) {
  const candidates = Array.isArray(conv.collected?.candidates) ? conv.collected.candidates : [];
  const intent = conv.collected?.disambIntent;
  if (!candidates.length || !intent) {
    await conv.reset();
    return false;
  }
  const match = matchClarifyOption(text, candidates.map((c, i) => ({ label: c.name || '', idx: i })));
  if (!match) {
    await conv.reset();
    return false;
  }
  const client = candidates[match.idx];
  const fields = {
    ...(conv.collected?.disambFields || {}),
    targetPhone: client.phone || undefined,
    clientPhone: client.phone || undefined,
    targetClientName: client.name || undefined,
    targetIdentifier: client.phone || client.name,
  };
  await conv.reset();
  const res = await runAgent({
    understanding: { intent, fields, reply: '', confidence: 1 },
    rawText: '',
    conversation: conv,
  });
  await syncSessionFromConversation(ctx, conv);
  await sendAgentResult(ctx, res);
  return true;
}

// "Bajarildimi?" cron so'roviga tugmasiz (matn/ovoz) javob: done/cancel/reschedule.
// complete_ / cancel_direct_ / reschedule_ callbacklari bilan bir xil natija.
// false qaytarsa — so'rov eskirgan (xizmat allaqachon hal qilingan), oddiy NLU davom etadi.
async function routeServiceConfirm(ctx, conv, action) {
  const serviceId = conv.lastConfirmServiceId;
  const service = await Service.findOne({ _id: serviceId, isDeleted: { $ne: true } });
  if (!service || service.status !== SERVICE_STATUS.PENDING) {
    conv.lastConfirmServiceId = null;
    conv.lastConfirmAt = null;
    await conv.save();
    return false;
  }
  try {
    if (action === 'reschedule') {
      conv.pendingIntent = 'SERVICE_RESCHEDULE';
      conv.collected = { serviceId: String(service._id) };
      conv.awaitingField = 'serviceDateTime';
      conv.lastConfirmServiceId = null;
      conv.lastConfirmAt = null;
      conv.markModified('collected');
      await conv.save();
      if (ctx.session) {
        ctx.session.intent = 'SERVICE_RESCHEDULE';
        ctx.session.collectedData = { serviceId: String(service._id) };
        ctx.session.pendingField = 'serviceDateTime';
        ctx.session.awaitingReschedule = String(service._id);
      }
      await ctx.reply("Qachonga ko'chiramiz oka? Sana va vaqtni yozing yoki ayting.");
      return true;
    }
    if (action === 'done') {
      const updated = await completeService(service._id, { markPaid: true });
      conv.lastConfirmServiceId = null;
      conv.lastConfirmAt = null;
      await conv.save();
      await ctx.reply(
        `Zo'r oka, ${updated.clientName} xizmatini bajarildi deb belgiladim ✅\nDaromad: ${formatMoney(updated.price)}`
      );
      return true;
    }
    if (action === 'not_done') {
      const updated = await markServiceNotDone(service._id);
      conv.lastConfirmServiceId = null;
      conv.lastConfirmAt = null;
      await conv.save();
      await ctx.reply(
        `Mayli oka, ${updated.clientName} xizmati bajarilmadi deb belgilandi. Balansga hech narsa yozilmadi — keyin vaqtini o'zgartirib qayta rejalashtirsangiz bo'ladi.`
      );
      return true;
    }
    if (action === 'cancel') {
      const updated = await cancelService(service._id);
      conv.lastConfirmServiceId = null;
      conv.lastConfirmAt = null;
      await conv.save();
      await ctx.reply(`Mayli oka, ${updated.clientName} xizmatini bekor qildim. Balansga hech narsa yozilmadi.`);
      return true;
    }
  } catch (err) {
    await ctx.reply('Xatolik: ' + err.message);
    return true;
  }
  return false;
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

  const coords = ctx.session?.pendingLocation?.coordinates
    || conv.collected?.pendingLocation?.coordinates
    || conv.collected?.location?.coordinates
    || ctx.session?.pendingLocationCoords;
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

  // Faol kirish oqimi yo'q — manzil MAVJUD qatorga bog'lanadi ("qaysi xizmatga?").
  ctx.session.intent = 'LOCATION_BIND';
  ctx.session.collectedData = { location };
  ctx.session.pendingField = 'bindTarget';
  ctx.session.awaitingConfirmation = false;
  await ctx.reply(`Manzilni oldim oka: ${customName}`);
  await startLocationBind(ctx, conv, location);
}

async function sendAgentResult(ctx, res) {
  // Post-save xulosa (tugmalari bilan) ustuvor — darhol-saqlash oqimining javobi.
  if (res?.keyboard) {
    if (ctx.session && res.tool === 'create_service' && res.result) {
      ctx.session.lastServiceId = res.result.id || res.result._id || null;
    }
    await ctx.reply(res.text, { reply_markup: res.keyboard });
    return;
  }
  if (res?.tool === 'create_service' && res.result) {
    await ctx.reply(serviceConfirmationText(res.result));
    const info = reminderInfoLine(res.result);
    if (info) await ctx.reply(info);
    if (ctx.session) ctx.session.lastServiceId = res.result.id || res.result._id || null;
    return;
  }
  await ctx.reply(res.text);
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
