# AI_CONTEXT.md

## 2026-07-04 Dinamik xarajat kategoriyalari + "hammasi Oziq-ovqat 650 000" bug tuzatildi
- **BUG 1 (kategoriya):** `flow.js`/`gemini.js` normalizeExpenseCategory regexlarida oziq-ovqat sinovi `/(...|osh|...)/` "b-OSH-qa_chiqim" ichidan mos kelardi → Gemini "boshqa_chiqim" qaytargan HAR QANDAY xarajat "Oziq-ovqat" bo'lib qolardi. Endi normalize FAQAT to'liq legacy nom mosligini slug'ga aylantiradi (yoqilgi/tamirlash/oziq-ovqat/boshqa_chiqim); qolgani DINAMIK kategoriya nomi (bosh harf bilan; >40 belgi = izoh deb hisoblanadi → null). `gemini.js` shu yagona funksiyani ishlatadi; izohdan kategoriya YASALMAYDI (avval `category || description` edi).
- **BUG 2 (post-save yutish):** saqlangandan keyin XUDDI SHU intentdagi yangi to'liq gap ("zapravkaga 200 berdim") `classifyPostSaveMessage`da 'edit' bo'lib, OLDINGI yozuvni qayta-qayta yangilardi (rasmda "yozuvni yangiladim ✅ 650 000 | Oziq-ovqat"). Endi: action===savedIntent + confidence≥0.7 + editField yo'q + tuzatish so'zi yo'q (`CORRECTION_RE`: emas/xato/to'g'irla/o'zgartir/aslida/...) + hasConcreteSignal + o'z mazmuni bor (EXPENSE: category yoki description; INCOME: description) → 'new'. Yalang'och "700 ming" — hali ham edit. `classifyPostSaveMessage(u, savedIntent, rawText)` — 3-parametr qo'shildi.
- **Dinamik kategoriyalar:** Gemini sxemasida category enum OLIB TASHLANDI (classify tool + create_transaction tool) — prompt endi "benzinga 100 ming" → category "benzin", "svalkaga berdim" → "svalka" deb o'rgatadi; boshqa_chiqim faqat maqsad noaniq bo'lsa. YANGI `models/ExpenseCategory.js` (MaterialCategory naqshi: name/normalizedName/source, tenant+soft-delete). `categoryService`: `ensureExpenseCategory` (default 3 ta slug'da qoladi; yangi nom avtomatik yaratiladi + notifyOwner), `listKnownExpenseCategories`, `expenseKey`, `DEFAULT_EXPENSE_CATEGORIES`. `Transaction.category` endi enum EMAS (erkin string; legacy sluglar saqlanib qoladi). `financeService.normalizeCategory` chiqimda flow normalizega tayanadi; create/updateTransaction dinamik toifani ensure qiladi; CATEGORY_KEYWORDS endi \b regexlar ("telefon" ichidan "non" topilmaydi) + zapravka/salyarka/somsa.
- **Ovoz biriktirish:** `attachEntrySource` endi EXPENSE_ENTRY/INCOME_ENTRY uchun ham (SOURCE_ATTACH_INTENTS); `fallbackToolCall`/`createAgentTransaction`/`createTransaction` voice/sourceText'ni BARCHA tranzaksiyalarga uzatadi; `routeSavedEntry` sourceMeta'ni post-save 'new' yo'liga ham uzatadi (avval yo'qolardi). Transaction.voice ovozi Mini App'da kategoriya ichida qayta eshitiladi (mavjud `/api/items/audio/:fileId`).
- **"Boshqa kirim-chiqimlar":** toifasiz chiqim (boshqa_chiqim/null) + toifasiz kirim (boshqa_kirim/null) yagona bo'limda. `getCategoryOverview` endi `expenses` (har kategoriya count/total) va `other` (count/totalIncome/totalExpense) qaytaradi; yangi endpointlar `GET /api/categories/expense/:name/records`, `GET /api/categories/other/records` (ovoz+sourceText bilan; 'qarz' chetlab o'tiladi).
- **Ko'rsatish:** bot ui/agent/queries label lookup dinamik nomga fallback (`|| category || 'Boshqa'`). Mini App Categories.jsx: "Xarajat kategoriyalari" + "Boshqa kirim-chiqimlar" bo'limlari, ExpenseDetail/OtherDetail (audio player bilan); Finance.jsx `categoryLabel` helper (t() kaliti topilmasa nomning o'zi), CategorySelect dinamik variantlarni /categories'dan yuklaydi; i18n uz+ru (categories.expenses/other/recordsCount/noRecords, category.qarz).
- **Tekshiruv:** normalize sof mantiq 20/20 PASS; node --check 12 backend fayl OK; Mini App build OK. Eski ma'lumot migratsiyasiz ishlaydi (sluglar o'z joyida).

## 2026-07-03 Hamkorlik/shartnomaviy mijozlar (PARTNER_CONTRACT + hamkor tashrifi)
- **Maqsad:** doimiy hamkor mijozlar ("Salat sex") — bir marta "X bilan shartnoma tuzdim, narxi 300 ming, lokatsiya ..." deyiladi, keyin "X ga bordim" (tarixiy: standart narx/manzil bilan DARHOL saqlanadi, balansga qo'shiladi) yoki "X ga boraman" (faqat sana/vaqt so'raladi, mavjud eslatma jadvali ishlaydi). Farqli narx/manzil aytilsa — tashrifga ham yoziladi, standart ham YANGILANADI. Umumiy funksiya (istalgan mijoz hamkor bo'la oladi).
- **Model (Client):** `isPartner`, `partnerPrice` (0=aytilmagan), `partnerLocation` (locationSchema), `partnerSince`. `phone` endi IXTIYORIY (default '') — hamkor korxonada tel bo'lmasligi mumkin; unique partial index yangilandi: `{isDeleted:false, phone:{$exists:true,$gt:''}}` (bo'sh telefonlar noyoblikka kirmaydi; `connect.js syncIndexes` eski indeksni almashtiradi).
- **YANGI `services/partnerService.js`:** `findClientByExactName` (ci-exact + oxirgi so'z kelishik qo'shimchasi strip "Salat sexga"→"Salat sex"), `findPartnerByName`, `upsertPartnerContract` (tel/ism bo'yicha topadi yoki telsiz yaratadi; prev holatni qaytaradi — undo uchun), `syncPartnerDefaultsFromVisit` (farqli narx/manzilda standart yangilanadi, teng bo'lsa no-op), `revertPartnerContract` (post-save Bekor: yangi yaratilgan → soft-delete, mavjud → prev'ga qaytadi), `countMonthVisits`, `getPartnerReportRows`. Tashrif sanasi ta'rifi YAGONA: `$ifNull:[serviceDateTime, completedAt]`, status=bajarildi.
- **createService (hamkor integratsiya):** ism bo'yicha mijoz endi `findClientByExactName` bilan topiladi (avval case-sensitive exact edi — zaiflik tuzatildi). `client.isPartner` bo'lsa: aytilmagan narx/manzil standartdan to'ldiriladi; AYTILGAN narx/manzil `syncPartnerDefaultsFromVisit` bilan standartga yoziladi. `editService`: hamkorning ENG SO'NGGI xizmati tahrirlansa (post-save "narxi 350") standart ham yangilanadi; eski tarix tahriri tegmaydi.
- **AI qatlami:** yangi subIntent `PARTNER_CONTRACT` (MIJOZ) — intents/prompts/gemini normalize/agent to'liq wiring (ENTRY_REQUIRED: clientName→price→location; ENTRY_MINIMUM: clientName; PARTNER_QUESTIONS "standart narx" savollari; AMOUNT_KEY price→USD konvertatsiya ishlaydi; tool `upsert_partner_contract`). Tashrif ALOHIDA intent EMAS — SERVICE_ENTRY'da `applyPartnerVisitDefaults`: ism hamkorga mos kelsa `_partnerVisit` + standartlar to'ldiriladi (`_partnerFilled` bayrog'i — keyingi xabardagi aniq qiymat avto-qiymatni almashtira oladi), tarixiyda sana=hozir; `entryNextMissing` hamkor tashrifida faqat kelajak sana (+standart narx yo'q bo'lsa narx) so'raydi — tel/manzil so'ralmaydi.
- **Post-save:** savedRef type 'partner' (created/prev bilan); Bekor→revertPartnerContract; tahrir→updateClient (partnerPrice/partnerLocation). `classifyPostSaveMessage`: shartnomadan keyin "X ga bordim" — TAHRIR EMAS, yangi tashrif (maxsus holat). `correctSaleClassification` PROTECTED_SUBS'ga PARTNER_CONTRACT qo'shildi.
- **API/Mini App:** `PUT /clients/:id` isPartner/partnerPrice/partnerLocation qabul qiladi (hamkorda tel bo'sh bo'lishi mumkin); `POST /clients` isPartner=true → upsertPartnerContract; `getClientDetail` `currentMonthVisits` qaytaradi. Clients.jsx: 🤝 badge, detailda hamkor kartasi (standart narx/manzil + "{oy} oyida borilgan: N marta"), Edit/Add modallarda hamkor toggle+maydonlar. i18n uz+ru (`clients.partner*`, `standardPrice/standardLocation/monthVisits/visitTimes/optional`; ru'ga yetishmagan `noHistory`/`common.notFilled` ham qo'shildi). CSS `.badge-partner`/`.partner-*`.
- **Hisobot:** PDF (clients/full) "Hamkor mijozlar (shartnoma)" jadvali [Nomi|Tashriflar|Jami daromad|Standart narx|Standart manzil]; Excel "Hamkorlar"/"Партнёры" varag'i — davr ichidagi tashrif soni + jami daromad (bajarilgan xizmatlar narxi).
- **Qo'shimcha tuzatilgan zaifliklar:** (1) `findOrCreateClient` — telefonsiz mavjud mijoz (hamkor) nomiga yangi telefon kelsa dublikat ochmay, telefonni o'sha mijozga biriktiradi; (2) createService ism-lookup case-insensitive bo'ldi; (3) ru.js'da `clients.noHistory`/`common.notFilled` yo'q edi.
- **Tekshiruv:** node --check 13 fayl OK; to'liq index.js import OK; sof mantiq smoke (taksonomiya, normalize, nextMissing tartibi, post-save routing 'new'/'edit') PASS; Mini App build OK.

## 2026-07-02 Lokatsiya pin koordinatalarini saqlash bugfix
- **Maqsad:** Telegram botdan yuborilgan map pin endi faqat reverse-geocode address matnini emas, original lat/lng koordinatalarini ham saqlaydi. Eski yo'qolgan koordinatalar backfill qilinmaydi; tuzatish faqat kelajak yozuvlarga taalluqli.
- **DB/service layer:** Service.location va Client.locations[] formatiga coordinates { lat, lng } qo'shildi. serviceService.normalizeLocation va clientService.normalizeLocationInput address, manual mapUrl va coordinates'ni birga saqlaydi; findOrCreateClient xizmatdan kelgan koordinatani client location ro'yxatiga ham uzatadi.
- **Bot oqimi:** location confirmation/rename callback payloadi qisqa bo'lishi uchun rounded coord faqat lookup sifatida ishlatiladi; saqlashda pending session/conversation ichidagi original Telegram koordinatalari ustuvor. Rename text route yes/no location question'dan oldin ishlaydi.
- **Mini App:** LocationDisplay address matnining o'zini xarita linkiga aylantiradi: avval manual mapUrl, bo'lmasa https://maps.google.com/?q={lat},{lng}. Alohida "Xaritada ochish" tugmasi olib tashlandi. Home/Clients/Services raw address qatorlari shared rendererga o'tdi; edit formalari mavjud coordinates'ni yashirin payloadda saqlab qoladi.
- **Tekshiruv:** node --check o'zgargan backend fayllar OK; npm run build OK; Mongoose smoke check Service.location.coordinates va Client.locations[0].coordinates qiymatlarini aniq saqlashini ko'rsatdi.
- **Davomi (audit + mustahkamlash):** `LocationDisplay` legacy string manzilni ham ko'rsatadi; `bot/location.js normalizeLocationData` yaroqsiz koordinatada `coordinates:null` (NaN obyekt yo'q); `clientService.findOrCreateClient` endi `upsertLocation` bilan ishlaydi — bir xil nomli manzilga pin kelsa mavjud qator coords/mapUrl bilan boyitiladi (dublikat ochilmaydi, yangi pin koordinatasi ustuvor). Semantika: object-edit (Mini App, coords payloadda) koordinatani saqlaydi; matnli edit (bot) yangi joy degani — coords tozalanadi. Smoke-test 13/13 (scratch `musoryoq_loc_test` db), brauzer render testi 5/5.

## 2026-07-02 Sana/vaqt to'liq ko'rsatish va formatlash bugfix
- **Markaziy formatlash:** Mini App `miniapp/src/utils/format.js` va backend `backend/src/utils/dates.js` oy nomli formatga o'tdi: uz `4-iyul 2026, soat 11:00`, ru `4 июля 2026, 11:00`. Mini App sahifa-local `Intl.DateTimeFormat` va month array'lar olib tashlandi; `formatDate`/`formatDateTime`/`formatTime`/`formatWeekdayDate`/`formatMonth*` ishlatiladi.
- **Mini App qamrovi:** mijoz kartalari va tarixida `serviceDateTime` endi vaqt bilan ko'rinadi; xizmatlar list/bottom-sheet, Home qidiruv/AI natijalari, transaction/reminder/deleted restore timestamp'lari formatlandi. Service detail modal va Services bottom-sheet `serviceDateTime`dan tashqari `createdAt`ni ham `Kiritilgan` sifatida ko'rsatadi.
- **Bot/API/hisobot:** bot `formatBotDate*` custom `DD.MM.YYYY` formatidan backend helperlarga o'tdi; AI search/service summary service vaqtini tushirmaydi; debt snooze aniq timestamp bilan javob beradi. PDF/Excel report sanalari va oylik chart/summary label'lari language bo'yicha oy nomi bilan chiqadi.
- **Saqlash tekshiruvi:** `Service.serviceDateTime` allaqachon Date maydonida to'liq sana+vaqt saqlaydi; `serviceService.createService/editService/rescheduleService` `serviceDateTime`ni `Date`ga parse qiladi va reminder schedule shu timestampdan hisoblanadi. O'zgarish saqlashga emas, ko'rsatishga qaratildi.
- **Tekshiruv:** backend `node --check` (`backend/src/**/*.js`) OK; `npm run build` OK; `git diff --check` OK.
- **Davomi (qoldiq tuzatishlar):** qarz eslatma xulosalari (bot saved summary + agent fallback) dueDate'ni endi `formatDateTime` bilan ko'rsatadi ("... da eslataman"); `deleteService` izohlaridagi ISO sanalar `formatDateTime`ga o'tdi; kategoriya-yaratildi bildirishnomasi va balans hisobotidagi xarajat sanalari soat bilan; Mini App Items (buyum kartasi/tafsiloti) va Categories (material yozuvlari) `formatDateTime`ga o'tdi. O'lik kod o'chirildi: `ui.formatBotDate`, `pdf.reportDate`. HTML input qiymatlari (type=date/month/datetime-local) atayin mashina formatida qoldi.

## 2026-07-02 YANGI OQIM: darhol saqlash + moslashuvchan maydonlar (ENTRY_CONFIRM olib tashlandi)
- **Katta o'zgarish:** barcha kiritish turlarida (xizmat/xarajat/kirim/material/buyum/qarz) "Ha, to'g'ri / Yo'q" TASDIQ BOSQICHI YO'Q. Ma'lumot yig'ilgach `finalizeEntry` DARHOL saqlaydi (MongoDB, kirim balansga avtomatik), keyin xulosa + 3 tugma: [✏️ Tahrirlash `saved_edit`][❌ Bekor qilish `saved_cancel`][📱 Ilovaga o'tish (webApp `?tab=`)]. Yangi holat `ENTRY_SAVED` (collected: savedIntent/fields/saved{type,ids}/stopped).
- **Tahrirlash — joyida:** `agent.editSavedEntry` foydalanuvchi aytgan maydonni SAQLANGAN yozuv ustida yangilaydi (`applySavedEntryUpdate`: editService / updateTransaction(+material maydonlari) / updateUsefulItem / updateItemSale / updateDebtReminder) — yangi yozuv yaratMAYDI. **Bekor qilish — kodsiz** (1990 so'ralmaydi, hozirgina kiritilgan yozuv): `cancelSavedEntry`→`undoSavedEntry` (service cascade soft-delete / tx soft-delete / item soft-delete / sotuvni revert / giveaway revert / deleteReminder+balans tiklash).
- **Maydonlar ixtiyoriy:** ENTRY_REQUIRED endi faqat SO'RASH TARTIBI (standart holat o'zgarmagan — navbat bilan so'rayveradi). Foydalanuvchi to'xtatsa (`flow.detectStopSignal` regex YOKI Gemini `fields.stopAsking=true`) — qolganlari BO'SH holda saqlanadi, xulosa "Tushunarli oka... ❕Aytilmagan: ..." (`ui.savedSummaryText` + `flow.missingEntryFields`/`FIELD_LABELS`). Yagona qat'iy talab `flow.ENTRY_MINIMUM` (kamida bitta identifikatsiya: ism YOKI tel / material/buyum nomi / person / xarajatda summa-yoki-izoh).
- **Model/service yumshatildi:** Service.clientId/location.address/serviceDateTime/price endi optional (price 0="aytilmagan"); telefonsiz xizmat mijozsiz saqlanadi, telefon keyin kiritilsa editService mijozga bog'laydi; sanasiz xizmatga eslatma jadvali qo'yilmaydi. createTransaction amount 0 qabul qiladi; sellUsefulItem summasiz ishlaydi; createDebtReminder dueDate/amount'siz ishlaydi (remindAt null → cron olmaydi; summasiz → balans tx yo'q). **Narx/summa KEYIN kiritilsa balans o'sha payt yangilanadi:** tx amount edit → getSummary avtomatik; DONE xizmat narxi 0→X: editService `ensureServiceIncome` bilan daromadni ENDI yaratadi (completeService endi price 0 da income yozmaydi).
- **Routing (message.js):** `ENTRY_SAVED` → `routeSavedEntry`: `answers.interpretSavedReply` (cancel/edit/ack, qisqa gaplar) → aks holda NLU + `agent.classifyPostSaveMessage` (SUXBAT yoki boshqa konkret WRITE intent → yangi buyruq; SERVICE_EDIT/CLIENT_EDIT yoki shu intentning o'zi → saqlangan yozuv tahriri). Universal "bekor" ENTRY_SAVED'da yozuvni O'CHIRADI. ITEM_MATCH_CONFIRM tanlovi tasdiqlangach ham post-save bosqichi keladi.
- **BUG TOPILDI+TUZATILDI (balansga yozilmaslik):** eski oqimda yozuv `ENTRY_CONFIRM`da DB'ga yozilmay kutib turardi; `interpretEntryConfirm` "bo'ldi" kabi keng tarqalgan tasdiqni TANIMASDI ("bo'ladi"/"bo'pti" bor edi, "bo'ldi" yo'q) va tanilmagan HAR QANDAY matn "maydon tahriri" deb qabul qilinib xulosa qayta ko'rsatilaverardi (loop) — foydalanuvchi saqlandi deb o'ylaydi, lekin DB'da yozuv yo'q → balans/Mini App bo'sh. Yangi darhol-saqlash oqimida bu bosqich butunlay yo'q — integratsiya testi (real Mongo, alohida `musoryoq_flow_test` db) 35/35: yozuv darhol DB'da, balans darhol, tahrir joyida, bekor tiklaydi.
- **Mini App:** `App.jsx` `?tab=`/start_param deep-link (bot tugmasi tegishli sahifani ochadi: services/finance/categories/reminders). Formatlash null-safe edi (formatDate ''), Services sort `|| 0`.
- **Eski oqim OLIB TASHLANDI:** entrySummaryText/entryConfirmKeyboard/interpretEntryConfirm/confirmPendingEntry/editPendingEntry/routeEntryConfirmation yo'q; eski `entry_*` callbacklarga "tugma eskirgan" javobi. OCR (rasm) tasdiq oqimi va Mini App FinalConfirmModal atayin saqlangan (bu goal bot AI kiritish oqimiga tegishli).
- **Tekshiruv:** node --check 15 fayl; import graph OK; sof mantiq 58/58 (stop-signal, minimum, interpretSavedReply, summary, keyboard, post-save routing); integratsiya 35/35 (yuqorida); Mini App build OK (58 modul).

- **Yakuniy self-check (2026-07-02):** post-save tahrir mappingi intentga moslandi (`narx/summa` -> service `price`, tx/item-sale/debt `amount`, item-entry `estimatedPrice`; `izoh` -> `notes` yoki `description`/`note`; sana edit parse qilinadi). Giveaway `closedAt` ham tahrirlanadi. Hozirgi tekshiruv: backend `node --check` 69 fayl OK; o'zgargan backend import graph OK; flow logic self-check OK; `git diff --check` OK; `npm run build` OK; runtime grepda eski `ENTRY_CONFIRM` funksiyalari yo'q.

## 2026-06-30 Qarz eslatma (DEBT_REMINDER) + Mini App "Eslatmalar" bo'limi
- **Maqsad:** "Sardorga 100 ming qarz berdim, 30 iyunda olaman" → 100 ming balansdan AVTOMATIK ayiriladi, egaga "berdim, balans -100, 30 iyun kuni eslataman" deb javob, 30 iyun kuni cron tugmali eslatma yuboradi. "...lekin balansdan minus qilma" desa — balansga tegmaydi, lekin eslatma baribir yuboriladi.
- **Model (YANGI `models/Reminder.js`):** tenant-scoped + soft-delete. type(debt/general), direction(given=men berdim / taken=men oldim), person, amount, affectsBalance, transactionId (bog'langan balans tx), eventDate (qarz sanasi), dueDate, remindAt (cron vaqti), remindSent (at-most-once), status(pending/done/cancelled). 'qarz' kategoriyasi `Transaction.TX_CATEGORIES` enum'iga qo'shildi.
- **Balans mexanikasi (`services/reminderEntryService.js`):** affectsBalance bo'lsa alohida Transaction (given→chiqim 'qarz', taken→kirim 'qarz') yaratiladi → `getSummary` (notDeleted) balansni darhol o'zgartiradi. "Hal bo'ldi"/bekor/o'chirishda o'sha tx SOFT-DELETE qilinadi → balans TIKLANADI (Reminder yozuvi tarixni saqlaydi). Income taksonomiyasiga tegmaydi (given=chiqim).
- **AI:** `DEBT_REMINDER` subIntent (MOLIYA). Trigger: qarz fe'li + person + KELAJAK sana. Maydonlar: person/amount/direction/dueDate/eventDate/`skipBalance` (faqat "balansdan minus qilma" desa true). USD avtomatik so'mga (mavjud applyCurrencyConversion). Slot-filling: person→amount→dueDate (flow.js). Bir xil ENTRY_CONFIRM (Ha/Yo'q/Bekor), matn/ovoz javob izchil.
- **Cron (`cron/reminders.js fireDebtReminders`):** remindAt kelganda atomar claim (at-most-once, qaytarmaydi — service eslatmasi bilan bir xil) → tugmali xabar [✅ Hal bo'ldi][📅 Keyinroq]. Callbacklar: `debt_done_<id>` (markDone+balans tiklash), `debt_snooze_<id>` (+1 kun).
- **API (`routes/reminders.js`):** GET/POST /api/reminders, PATCH /:id/done|cancel|snooze, DELETE /:id (requireDeleteCode).
- **Mini App:** yangi nav tab `🔔 Eslatmalar` (7-tab) + `pages/Reminders.jsx`: faol/hal bo'lgan/barchasi, summary (faol soni+jami), qo'lda qo'shish (yo'nalish/kim/summa/sana/balans toggle/izoh), "Hal bo'ldi", soft-delete. i18n uz+ru (`nav.reminders`, `reminders.*`).
- **Tekshiruv:** node --check 12 fayl OK; import graph OK; sof mantiq testlari (mergeFields/nextMissing/applyRawValue/summary/dueText) PASS; Mini App build OK.

## 2026-06-28 Tarixiy sana — barcha daromad turlarida + kategoriyalar restrukturizatsiya
- **O'tgan sana:** o'tgan zamon/sana bilan aytilgan voqea (xizmat/material/buyum/qo'lda kirim) — voqea YUZ BERGAN sanaga yoziladi. Prompt'da global EVENT DATE qoidasi. KOD: `serviceService.completionDateFor` — tarixiy xizmat income tx `serviceDateTime`ga (avval bugun edi → hisobot xato oyga tushardi). Material/item/income Gemini `date`ini saqlaydi (applyEntryDefaults faqat yo'q bo'lsa bugun). Mini App qo'lda sotuvga sana maydoni.
- **Sotuv≠xarajat (kritik):** ovozli "muzlatgich sotdim" Oziq-ovqat xarajat deb tushunilardi → `gemini.correctSaleClassification` deterministik to'g'rilash (sotish fe'li + tanilgan tovar → ITEM_SALE/MATERIAL_SALE) + prompt qotirildi.
- **Material ovozi:** Transaction.voice/sourceText; material sotuvi ovozli aytilsa kategoriyaga biriktiriladi (Mini App'da qayta eshitiladi).
- **Kategoriyalar:** `MaterialCategory` model + `categoryService` (+notifyOwner yangi kategoriyada) + `routes/categories.js`. Mini App "Buyumlar"→"Kategoriyalar" (material kategoriyalari + Kerakli buyumlar; yozuvlar: sana/kg/narx/balans/ovoz; yaratish; qo'lda qo'shish).
- Tekshiruv: node --check + route graph OK; classify 9/9, date 8/8, categoryService PASS; Mini App build OK.

## 2026-06-27 Material/buyum AI tizimiga to'liq integratsiyasi (audit)
- Tasdiqlandi: material sotish + kerakli buyumlar mavjud AI oqimiga to'liq mos — hammasi MOLIYA subIntent, bir xil ENTRY_CONFIRM (Ha/Yo'q tahrirlash/Bekor), matn/ovoz javob tugmasiz ishlaydi (routeEntryConfirmation/continueEntry/ITEM_MATCH_CONFIRM intent-agnostik), "oka" ohang izchil, kontekst (oxirgi 10 xabar) hammasiga taalluqli.
- Qotirish: prompts.js STEP 1 MOLIYA ta'rifi material/buyum sotuvini aniq qamraydi; commands.js HELP_TEXT + agent.js fallback hint material/buyumni eslatadi (discoverability).
- Mid-entry pivot ishlaydi: boshqa yozuv o'rtasida "paxta sotdim"/"televizor sotdim"/"menda divan bor" desa — maybeCorrectIntent yangi niyatga o'tadi. Material soft-ask (kilo narxi) pivotdan keyin ham to'g'ri.
- Tekshiruv: import graph OK; integratsiya testlari (4 subIntent confirm, tahrir loop, 3 pivot, soft-ask continuation, ovoz) PASS.

## 2026-06-27 Hisobot — chuqur tahlil (Insights)
- Hisobotga "Qiziqarli ko'rsatkichlar" bo'limi: eng daromadli material/buyum, eng ko'p to'lagan mijoz, eng band oy (buyurtma), eng daromadli oy, o'rtacha xizmat narxi, eng faol kun. Davr ichida, uz/ru, Excel'da emoji bilan.
- `services/reportInsightsService.js getReportInsights({from,to})` — xom agg (top material/item/client, best/busiest month, avg service price, active weekday). `reports.js formatInsights(insights,language)` → `[{emoji,label,value}]` (PDF emoji'siz, Excel emoji bilan; bir manba). PDF `pdf.js drawInsights` (rangli marker + label + qiymat). Excel "Tahlil" varag'i.
- DIQQAT: PDF Helvetica emoji'ni chizolmaydi — PDF'da emoji ISHLATILMAYDI (rangli marker), Excel'da ishlatiladi.
- Tekshiruv: node --check OK; insights 7/7 + formatInsights uz/ru + real PDF render PASS.

## 2026-06-27 Hisobot (PDF/Excel) — daromad manbasi bo'yicha oylik foiz tahlili
- Mavjud PDF/Excel hisobotga YANGI bo'lim: har oy uchun nechta xizmat + jami kirim + xizmat vs material/buyum sotuvi (son+foiz). Grafik (stacked-bar) VA matn/son/foiz birga.
- `incomeSourceService.getMonthlyIncomeBreakdown({from,to})` — oylik agg (servicesCount, totalIncome, sources+pct, servicePct, salesTotal/salesPct, otherTotal/otherPct; noma'lum kategoriya→other).
- `reports.js`: `buildPeriodTitle` (tildagi aniq davr: "1-maydan 30-maygacha bo'lgan hisobot (2026)" / "Отчёт с 1 мая по 30 мая 2026") → PDF header "Davr:". `buildMonthlyIncomeRows` oy nomini localize qiladi. Excel "Manba tahlili" varag'i (`unicodeBar` "██████░░░░ 60%"). Yordamchilar export (keyingi hisobot promptlari uchun).
- `pdf.js`: `drawSourceAnalysis` (oylik stacked-bar + son/foiz) + `drawSourceLegend` + `SOURCE_COLORS`. Til Mini App tanlovidan (`/reports/send language`). Mini App o'zgartirilmadi.
- Tekshiruv: node --check OK; agg + title + bar testlari PASS; HAQIQIY createReportDoc PDF render (valid %PDF).

## 2026-06-27 Daromad manbalari taksonomiyasi (4 manba) + Moliya sahifasi breakdown
- Kirim 4 manbadan: **xizmat** (service income, category='xizmat') · **material** (category='material') · **buyum** (kerakli buyum sotuvi, category='buyum') · **boshqa_kirim** (qo'lda kirim). Manba income tranzaksiyaning `category` maydonida saqlanadi (qo'shimcha maydon shart emas — 1:1).
- YAGONA modul `services/incomeSourceService.js`: `INCOME_SOURCES` ro'yxati + `incomeSourceKey(category)`→key ('other' fallback) + `getIncomeBySource(period)` (manba bo'yicha total+count, noma'lum kategoriya 'other'ga). Bu — keyingi hisobot funksiyalarining ASOSI. Yangi manba qo'shish = income kategoriya + 1 qator.
- `GET /api/finance/income-sources?period=`. Moliya sahifasida 3 kartochka: 📊 Daromad manbalari, ♻️ Material sotuvi (nom+kg), 📦 Kerakli buyumlar (nechta+qaysilari). i18n uz+ru (`finance.incomeSources/itemsInStock/sources.*`).
- Tekshiruv: node --check OK; taksonomiya + agg-mapping testlari PASS; Mini App build OK (56 modul).

## 2026-06-27 Kerakli buyumlar inventari
- **Maqsad:** musordan chiqqan, lekin tashlanmaydigan dona buyumlar (`muzlatgich`, `televizor`, `divan`...) materiallardan alohida yuritiladi. Bular kg emas, har biri alohida `UsefulItem`.
- **Model/API:** yangi `models/UsefulItem.js` tenant-scoped + soft-delete. Maydonlar: `name/normalizedName/estimatedPrice/acquiredAt/notes/sourceType/sourceText/voice/status/closedAt/recipient/soldAmount/saleTransactionId`. Yangi `routes/items.js`: `GET/POST /api/items`, `PATCH /:id/sold`, `PATCH /:id/give-away`, `DELETE /:id`, `GET /audio/:fileId`.
- **AI/bot:** yangi subIntentlar: `ITEM_ENTRY`, `ITEM_SALE`, `ITEM_GIVEAWAY`. Slot-filling: qo'shishda faqat `itemName` shart (narx so'ralmaydi), sotishda `itemName+amount`, tekinga berishda `itemName`. Voice orqali qo'shilsa `sourceText` + Telegram `voice` metadata biriktiriladi.
- **Aqlli match:** `usefulItemService` alias/fuzzy matching qiladi: `haladelnik/xolodilnik/holodilnik` -> `Muzlatgich`, `tv/telik` -> `Televizor`, `stiralka` -> `Kir yuvish mashinasi`. Noaniq yaqin match bo'lsa bot `ITEM_MATCH_CONFIRM` holatida nomzodlarni raqam bilan so'raydi. Ro'yxatda yo'q buyum sotilsa, transaction baribir yoziladi va ogohlantirish qaytadi.
- **Moliya:** `Transaction.category='buyum'`, `itemName/usefulItemId`; sotuv darhol income transaction. Tekinga berish balansga tegmaydi. PDF finance kategoriya ustunida buyum nomi ko'rinadi.
- **Mini App:** yangi `Items.jsx` + nav tab `Buyumlar`: ro'yxat/qidiruv, qo'lda qo'shish, detal, source transcript/audio, qo'lda `Sotildi` + summa, `Tekinga berildi`, soft-delete.
- **Self-check:** backend `node --check` OK; Mini App `npm run build` OK; item logic smoke OK; import graph OK; `git diff --check` OK (faqat CRLF warninglar).

## 2026-06-27 Railway log audit - npm warning + log encoding
- **Log tahlili:** Railway logidagi `[err] npm warn config production Use --omit=dev instead` fatal backend xatosi emas; npm `production` config ogohlantirishini stderr'ga yozgani uchun Railway uni `err` sifatida ko'rsatgan. Backend o'zi MongoDB, webhook, cron va kurs keshini muvaffaqiyatli start qilgan.
- **Tuzatish:** repo ildiziga `railway.json` qo'shildi: build `npm run build`, deploy start bevosita `node backend/src/index.js`. Runtime endi nested `npm run start --workspace ...` wrapper'iga kirmaydi, shuning uchun production-config npm warning runtime logida chiqmasligi kerak.
- **Log tozaligi:** runtime console loglaridagi uzun tirelar ASCII `-` ga almashtirildi (`migrateTenancy`, `connect`, `exchangeRateService`) - Railway/log viewer mojibake (`вЂ”`) chiqarmasligi uchun. `backend/.env.example` buzilib qolgan `smash :)` holatidan normal namunaga qaytarildi.
- **Self-check:** `railway.json` JSON parse OK; barcha `backend/src/**/*.js` `node --check` OK; material flow smoke OK; `npm run build` OK; `git diff --check` OK (faqat CRLF ogohlantirishlari).

## 2026-06-27 Material sotish (paxta/temir/plastik...) — yangi daromad manbai
- **Maqsad:** egasi musordan chiqqan materiallarni sotgani (masalan "30 kg paxtani 300 mingga sotdim") oddiy KIRIM sifatida yozilsin, balans/oylik grafik/hisobot/kategoriya statistikasiga to'liq kirsin.
- **Niyat:** MOLIYA ichida 4-chi subIntent `MATERIAL_SALE` (`ai/intents.js`). Gemini ajratadi: `materialName` (asos shakl: "paxtani"→"Paxta"), `quantityKg`, `amount` (umumiy summa), `pricePerKg` (prompt + classify schema + `normalizeExtractedFields`).
- **Saqlanishi:** `Transaction` `category='material'` (income), `materialName/quantityKg/pricePerKg` maydonlari. Izoh toza quriladi ("Paxta · 30 kg") — Mini App ro'yxati/PDF/Excel/qidiruvda ko'rinadi. Balans (`getSummary`) va oylik grafik AVTOMATIK qamraydi (income transaction).
- **Kategoriya:** 10 asosiy (`materialService.DEFAULT_MATERIALS`: Paxta, Taxta, Yengil/Og'ir temir, Salafan, Plastik, Plassmassa, Alyuminiy, Mis, G'isht). `resolveMaterialName` kanonik nomga keltiradi (dublikat yo'q); ro'yxatda yo'q narsa → YANGI kategoriya o'sha nom bilan (rad etmaydi). "Keyingi safar ham tanilsin": avval ishlatilgan nomlar `Transaction.distinct` dan olinadi.
- **Ma'lumot mantig'i:** umumiy summa har doim ustun (foydalanuvchi aytgani). Faqat miqdor+summa bo'lsa kilo narxi YUMSHOQ (1 martalik) so'raladi (`flow.nextSoftAsk` + `agent.maybeAskSoft`, `_softAsked` bayrog'i); javob bermasa qistab so'ralmay saqlanadi. Faqat miqdor+kilo narxi bo'lsa umumiy summa avtomatik hisoblanadi (`applyEntryDefaults`).
- **Tasdiq:** "Bo'ldi oka, 30 kg Paxta — 300 000 so'mga sotilgani yozildi ✅" (`agent.fallbackResponse`). Saqlashdan oldin yakuniy tekshiruv xulosasi (`ui.entrySummaryText` MATERIAL_SALE).
- **Statistika:** `materialService.getMaterialStats(period)` (materialName bo'yicha jami/kg/soni) → `GET /api/finance/materials`; Mini App Finance'da "♻️ Material sotuvi" kartochkasi. `GET /api/finance/materials/categories` → tanilgan kategoriyalar. PDF kategoriya ustunida materialName ko'rsatiladi.
- **Tekshiruv:** `node --check` 11 fayl OK; pure-logic 23/23 PASS; agent uchburchak oqim (S1 to'liq→confirm, S2 yumshoq so'rov, S3 javob, S4 rad-nag yo'q, S5 summa so'rash) 5/5 PASS; gemini import-graf + extraction; Mini App Finance.jsx esbuild OK. Jonli Gemini/DB testi foydalanuvchida.

## 2026-06-26 Oddiy suhbat (salom/rahmat/xayr) endi qidiruv emas
- **Muammo:** egasi "rahmat ukam" / "salom" / "xayr" yozsa, dastur uni SEARCH_QUERY deb olib "qidiruv amalga oshirildi, hech narsa topilmadi" javobini berardi.
- **Tuzatish:** `ai/queries.js` ga `smallTalkReply(rawText)` qo'shildi va `answerReadQuery` ichida data-shablonlardan KEYIN, qidiruvga o'tishdan OLDIN chaqiriladi. Tasniflar: thanks/greeting/bye/howareyou/ack → iliq "oka" javob (`tool:'small_talk'`). DB'ga tegmaydi.
- **Ehtiyotkor:** raqam yoki data so'zi (qancha/mijoz/balans/manzil/bor…) bo'lsa — suhbat EMAS, qidiruvga o'tadi; 6 so'zdan uzun gap ham o'tadi. Stem regexlar trailing \b SIZ ("qalaysiz", "yaxshimisiz" ushlanadi); "xayr" (\bxayr\b) "xayrli kun" (salom) dan ajratilgan; "rahmat" \b bilan "Rahmatga" (mijoz ismi) dan himoyalangan.
- Bot va Mini App ikkalasiga ham tegishli (umumiy `answerReadQuery`). Tekshiruv: `node --check` OK; detection 19 talk + 9 non-talk PASS; "ee rhamat ukam"→"Arzimaydi oka 😊", "salom"→salomlashish, "xayr oka"→xayrlashuv; import-graf resolve.

## 2026-06-26 So'rov shablonlari yakuni: XIZMATLAR (yangi format) + get_next_client + umumiy modul + Mini App xarita tugmalari
- **Umumiy modul:** barcha AI o'qish-shablonlari yangi `backend/src/ai/queries.js` ga ko'chirildi. Yagona kirish: `answerReadQuery({rawText, fields, isAnalytics})` → `{text, tool}` yoki `null` (mos kelmasa umumiy qidiruvga). `agent.runAgent` SEARCH/ANALYTICS shu funksiyani chaqiradi — Telegram bot (matn/ovoz) HAM, Mini App AI chat HAM bir xil modul/mantiq (kod takrorlanmaydi). agent.js'dagi eski inline shablonlar olib tashlandi.
- **Routing tartibi** (queries.js): BALANS (isAnalytics) → KEYINGI MIJOZ (`looksLikeNextClient`) → MIJOZLAR (`looksLikeTodayClients`) → XIZMATLAR (`looksLikeTodayServices`) → null. "kim/qayer borish" endi MIJOZLAR'dan KEYINGI MIJOZ'ga ko'chdi.
- **XIZMATLAR (yangi format, qisqaroq):** `buildTodayServicesReport` → `getTodayPendingServices()` (faqat kutilmoqda). Shablon: "📦 Bugun N ta ish bor oka:\n\n1️⃣ {soat} — 📍{manzil}\n…\n\n👉 Hozir {eng_yaqin} ga borish vaqti keldi" — ism/tel YO'Q, faqat vaqt+manzil. Bo'sh → "Bugun uchun barcha ishlar tugadi oka 🎉". (Eski 🧹 status-ikonkali format va `getTodayServices` olib tashlandi.)
- **get_next_client():** `serviceService.getNextClient()` = `pickNearestByTime(getTodayPendingServices())` — bugun, kutilmoqda, joriy vaqtga eng yaqin BITTA. `pickNearestByTime` — yagona "eng yaqin" mantiq (MIJOZLAR/XIZMATLAR tavsiyasi + get_next_client baham ko'radi). `buildNextClientReport`: "👉 Hozir {ism} ga borishingiz kerak, oka\n📍 {manzil}  💰 {price} so'm  ⏰ soat {vaqt}". Bo'sh → "Bugun uchun barcha ishlar tugadi oka 🎉". Trigger: "Endi qaysi mijoz uyiga boraman?", "hozir qayerga borish kerak", "keyingi mijoz".
- **Mini App xarita tugmalari:** `components/MapQuickLinks.jsx` (umumiy) — "Xarita havolasi" input ostida 2 ta 28px chip [🗺️ Google][🗺️ Yandex], `window.open(url,'_blank','noopener,noreferrer')` (Google: google.com/maps, Yandex: yandex.uz/maps). FAQAT saytni ochadi — nusxa-paste foydalanuvchida (avtomatik qaytarish yo'q, ataylab). Clients (qo'shish+tahrirlash) va Services formalariga ulandi. CSS `styles.css` (theme tokenlari, ikkala mavzu).
- **Tekshiruv:** backend `node --check` 3 fayl OK, import-graf OK (`answerReadQuery`/`getNextClient`/`pickNearestByTime` resolve), routing 18/18 PASS (4 tur ajratish + o'tgan-zamon/joy/sana rad); Mini App `npm run build` OK (55 modul); preview'da 3 forma'da tugmalar 28px, to'g'ri URL `_blank`, konsol xatosiz tasdiqlandi.

## 2026-06-26 Dollar/so'm avto-konvertatsiya (rad etish olib tashlandi)
- Bot endi dollarni RAD ETMAYDI (`agent.requiresSomConfirmation` o'chirildi). "100$"/"100 dollar" → summa + `currency='USD'` ajratiladi (Gemini `currency` maydoni + `agent.detectUsd` regex zaxira), `getUsdToUzsRate()` bilan so'mga aylantiriladi (`money.convertUsdToUzs=round(amount*rate/100)*100`).
- Valyuta `rawText`dan alohida kuzatiladi (`trackEntryCurrency`) chunki `parseMoney("100$")=100` belgini tashlaydi. Konvertatsiya: `applyCurrencyConversion` (idempotent) — `finalizeEntry`, `handlePaymentUpdate`, `handleServiceEdit`/`editAgentService`, `editPendingEntry`. Kurs yo'q → `currencyFallback` (so'mda qayta so'raydi).
- Asl valyuta saqlanadi: `originalAmount/originalCurrency/exchangeRateUsed` (Service+Transaction); balans/hisobot DOIM so'mda. Tasdiq/xulosa xabarida `formatConversionLine` ("💵 100$ → 1 205 200 so'm (kurs: 1$ = 12 052 so'm)").
- Mini App bosh sahifada kichik real-time kurs (`Home.RateChip` → `/exchange-rate`).
- Tekshiruv: backend node --check OK, konvertatsiya/UI 7/7, Mini App build OK (54 modul).

## 2026-06-26 AI so'rov-javob standart shablonlari (BALANS + MIJOZLAR + XIZMATLAR)
- Bot va Mini App AI chatdagi o'qish so'rovlari endi DETERMINISTIK, aniq formatli shablon javob beradi (Gemini qayta yozmaydi — format buzilmaydi, tezroq). `runAgent` SEARCH/ANALYTICS routing: BALANS (ANALYTICS) → MIJOZLAR (looksLikeTodayClients) → XIZMATLAR (looksLikeTodayServices) → umumiy qidiruv (executeToolFlow).
- **BALANS** (ANALYTICS_QUERY): `buildBalanceReport(period)` → `financeService.getBalanceReport(period)` real aggregatsiya: kirim/chiqim/balans + eng katta/kichik xarajat ($sort amount) + eng qimmat xizmat ($sort price) + bajarilgan/kutilayotgan xizmat soni. Davr aytilmasa → `all` (umumiy/joriy); aytilsa `analyticsPeriod` (today/week/month/last_month/year). Kutilayotgan: `all`da kelajak ham sanaladi (yuqori chegara yo'q), aniq davrda oraliq ichida. Emoji: 💰💵📈📉🔺🔻🏆✅⏳.
- **MIJOZLAR** (SEARCH_QUERY, aniq sana/filtrsiz): `looksLikeTodayClients` "mijozlar haqida"/"bugungi mijozlar"/"hozir kimga borishim kerak"/"navbatdagi" ni aniqlaydi (o'tgan zamon "borganman" yoki aniq joy "Chilonzordagi" — oddiy qidiruv, ushlanmaydi; dateFrom/dateTo bo'lsa rad). `buildTodayClientsReport` → `getTodayPendingServices()` (bugun, kutilmoqda, vaqt asc). Ro'yxat 1️⃣2️⃣… + ism — soat — 📍manzil; tavsiya: joriy vaqtga serviceDateTime bo'yicha eng yaqin (faqat vaqt). Bo'sh → "Bugun uchun barcha ishlar tugadi oka 🎉".
- **XIZMATLAR** (SEARCH_QUERY, aniq sana/filtrsiz, QISQAROQ): `looksLikeTodayServices` "xizmat/ish/reja" so'zlariga tayanadi (mijoz emas — MIJOZLAR'dan ajraladi; "Chilonzordagi xizmatlar"/sana — qidiruv). `buildTodayServicesReport` → `getTodayServices()` (bugun, kutilmoqda+bajarildi, vaqt asc). Format: 🧹 Bugungi xizmatlar (N ta) → 1️⃣ ism — soat ✅/⏳ → "✅ X bajarildi · ⏳ Y kutilmoqda". Bo'sh → "Bugun uchun xizmat yo'q oka 📭".
- Har ikkala mode ('bot' va 'query') uchun ishlaydi (o'qish so'rovlari mode-gated emas). Tekshiruv: `node --check` 3 fayl OK; routing 15/15 PASS (MIJOZLAR/XIZMATLAR/SEARCH ajratish + o'tgan-zamon/joy/sana rad); 3 shablon render mock data bilan format mosligi tasdiqlandi; export'lar import bilan resolve.

## 2026-06-26 USD→UZS kurs infra (CBU API + 12h kesh, global singleton)
- `services/exchangeRateService.js getUsdToUzsRate()`: kesh<12h → CBU asosiy URL → CBU zaxira URL → eski kesh → null. 5s timeout, hech qachon throw qilmaydi. `getRateInfo()` endpoint uchun meta beradi. `parseUsdRate` Nominalga bo'ladi, vergul/nuqta formatni tushunadi.
- `models/ExchangeRate.js` — GLOBAL singleton (`exchange_rate_cache`, base:'USD'); **tenantScopePlugin YO'Q** (kurs hamma uchun bir xil, shaxsiy emas, kontekstsiz ishlaydi).
- `GET /api/v1/exchange-rate` → `{usdToUzsRate, rateUpdatedAt, stale, source}` (auth ortida). `index.js` startupda fonda kursni isitadi.
- Hozircha faqat infra; bot'da dollar→so'm avtomatik konvertatsiya keyingi ish. Asosiy manba CBU rasmiy (kalit kerak emas); zaxira — CBU "barcha valyuta" endpoint'i (bir xil manba).
- Live CBU testi tasdiqlandi (1 USD ≈ 12013 UZS).

## 2026-06-26 To'liq multi-tenant izolyatsiya (telegramUserId + AsyncLocalStorage scope plugin)
- Endi har bir ruxsatli Telegram ID — alohida, mustaqil ma'lumotlar to'plamiga ega. Asosi: `db/tenantScope.js` — AsyncLocalStorage (`runWithUser`/`runGlobal`/`currentUserId`) + Mongoose plugin (Client/Service/Transaction/DebtPayment). Plugin har query/aggregate/save'ga `telegramUserId` qo'shadi; **kontekstsiz so'rov XATO beradi (fail-closed)** — global ataylab `runGlobal` bilan.
- Kontekst 6 joyda: bot guard (`runWithUser(ctx.from.id)`), API router (auth'dan keyin `runWithUser(req.telegramUser.id)`), reminder cron + cleanup cron + startup repair + migratsiya (`runGlobal`). Qolgan service/route/agent/bot kodi o'zgarmadi — scope avtomatik.
- Schema: `telegramUserId` (required, index) + Client `{telegramUserId,phone}` compound partial-unique (eski faqat-phone unique o'rniga). `Settings.getSingleton` default `currentUserId()`ga (reminder/deleteCode to'g'ri egadan); default theme 'light'.
- Env: `ALLOWED_TELEGRAM_IDS` (eski `OWNER_TELEGRAM_ID` fallback). Migratsiya idempotent startupda (`db/migrateTenancy.js`) — eski yozuvlarni `legacyOwnerId`ga biriktiradi.
- Eslatma cron endi FAQAT `service.telegramUserId`ga yuboradi (broadcast emas) — multi-tenant + BUG1 (at-most-once, 403 spam yo'q) birga.
- Tekshiruv: 29/29 tenant unit/sim test (DB'siz), import-graf 10/10, node --check OK. Jonli 2-akkaunt testi — foydalanuvchi zimmasida.

## 2026-06-26 Eslatma dublikati tuzatildi — at-most-once (claim-first, rollback yo'q)
- `cron/reminders.js` eslatmalari endi "ko'pi bilan bir marta": atomar claim (`findOneAndUpdate sent:false→true`) yuborishdan OLDIN bo'ladi va claimdan keyin bayroq HECH QACHON qaytarilmaydi (send xatosida ham). Eski kod xatoda `sent:false` ga qaytarardi → keyingi tik qayta yuborardi (dublikat/spam).
- `broadcast` `Promise.all` → `Promise.allSettled`: har owner'ga mustaqil; bitta owner (botni bloklagan) xato bersa qolganlari spam bo'lmaydi; yetkazilgan son qaytadi. Bu allowlist (`OWNER_TELEGRAM_ID` ko'p ID) holatidagi har-daqiqa-spam bug'ining asosiy sababi edi.
- Dublikatsizlik kafolati zanjiri: bir marta start (`index.js:95`) → intra-process `withLock` → cross-instance atomar claim. Rollback olib tashlangani claim'ni qayta ochmaydi.
- Trade-off: claim bilan send orasida crash bo'lsa juda kamdan-kam yo'qotish mumkin — dublikatdan afzal; 3 tur eslatma bir-birini qisman qoplaydi.
- OGOHLANTIRISH: hali ham `broadcast` BARCHA owner'larga yuboradi va `Service/Client/Transaction` da `ownerId` yo'q. Haqiqiy "mustaqil biznes" izolyatsiyasi (per-owner data + eslatma faqat egaga) — keyingi alohida ish.

## 2026-06-24 Responsive shell + yangi ma'lumot yakuniy tasdiqlash
- Mini App shell responsive qayta qurildi: `>=768px` desktop sidebar (`SidebarNav`, collapsed state localStorage), `<768px` eski bottom nav; resize listener shellni reloadsiz almashtiradi. Modal/detail viewlar `AppContext` navigation stack orqali ichki `Orqaga` tugmasiga ulangan.
- Bot yangi yozuv oqimlari (`SERVICE_ENTRY`, `EXPENSE_ENTRY`, `INCOME_ENTRY`) endi to'g'ridan DBga yozmaydi: barcha majburiy maydonlar yig'ilgach `ENTRY_CONFIRM` pending holati saqlanadi va `ui.entrySummaryText` xulosasi `ui.entryConfirmKeyboard()` 3 tugmasi bilan ko'rsatiladi: [✅ Ha, to'g'ri=`entry_save`][✏️ Yo'q, tahrirlash kerak=`entry_edit`][❌ Bekor qilish=`entry_cancel`]. `entry_save`/matnli `ha|to'g'ri|saqla` → `confirmPendingEntry()` real `create_service/create_transaction`ni bajaradi. `entry_cancel`/`bekor` reset qiladi ("hech narsa saqlanmadi"). `entry_edit`/`yo'q`/`tahrirla` (yoki to'g'ridan "narxi 200 ming" kabi matn) → `agent.editPendingEntry` AI orqali maydonni `collected.fields` ustiga yozadi (`mergeFields(...,{overwrite:true})`) va yangilangan xulosani xuddi shu 3 tugma bilan QAYTA ko'rsatadi (tasdiqlanmaguncha loop). Matn/ovoz javoblari tugma bilan bir xil (`answers.interpretEntryConfirm`). Eski 2-tugmali `saveKeyboard` (save_yes/save_no) endi faqat OCR rasm tasdig'i uchun.
- Mini App yangi data create oqimlari (`Clients` orqali yangi xizmat/mijoz, `Services` yangi xizmat, `Finance` kirim/chiqim) `FinalConfirmModal` orqali preview beradi; `api.post` faqat `Saqlashni tasdiqlash` bosilgandan keyin ketadi. Edit/complete/delete/restore/report oqimlari o'zgarmadi.
- Tekshiruv: `cd miniapp && npm run build` OK; backend `src/**/*.js` `node --check` OK; `git diff --check` OK; Vite `127.0.0.1:5177` da Playwright bilan mobile bottom nav, final confirm modal, desktop sidebar/bottom-nav conditional render tekshirildi. Browserdagi backend `Failed to fetch` banneri backend dev server ishlamagani uchun kutilgan.

## 2026-06-23 Eslatma va lokatsiya prompti yakunlandi
- Eski `defaultReminders` array va `service.reminders[]` oqimi runtime koddan olib tashlandi. Settings endi `reminderHoursBefore` va `confirmHoursAfter` (default 3, 1..168) saqlaydi; Mini App ikkalasini alohida sozlaydi.
- Service jadvali: `reminderAt = serviceDateTime - X soat` oddiy matn, `confirmAt = serviceDateTime + X soat` tugmali tasdiq. Cron `reminderSent/confirmSent` atomar claim qiladi; restore/reschedule `applyServiceSchedule` bilan qayta hisoblaydi.
- Mini App Settings eski 1 kun/1 soat/aynan vaqtida presetlarini ko'rsatmaydi; oldindan eslatma va keyingi tasdiqlash uchun alohida soat stepperlari bor. Service detail `reminderAt/confirmAt` ni ko'rsatadi.
- Lokatsiya: DB formati faqat `{ address, mapUrl }`. Mini App formalarida `Manzil nomi` majburiy, `Xarita havolasi` ixtiyoriy; noaniq havolada ogohlantirib baribir saqlashga ruxsat beradi. Bot Telegram pinni Nominatim orqali manzilga aylantiradi va `{ address, mapUrl:null }` sifatida saqlaydi; koordinata faqat tasdiqlash sessiyasida ishlatiladi.
- AI safety: `Sardor 300 ming berdi` kabi xabarlar Gemini'dan oldin fuzzy paymentga ketmaydi; past confidence (<0.7) har qanday classifier natijasida CLARIFY qiladi. Write high-level intent subIntent bermasa, server default write qilmay CLARIFYga o'tkazadi.

## 2026-06-23 Niyat aniqlash qayta qurildi — 3 high-level intent + subIntent (ikki qatlam)
- Gemini klassifikatori endi `intent` (MOLIYA|MIJOZ|SUXBAT|CLARIFY) + `subIntent` (9 aniq amal) qaytaradi.
  High-level — foydalanuvchi tajribasi (CLARIFY, tugmalar); subIntent — mavjud agent ijro qatlami (MongoDB amallari).
  Yagona manba: `backend/src/ai/intents.js` (SUB_TO_HIGH, HIGH_TO_SUBS, HIGH_DEFAULT_SUB, CONFIDENCE_THRESHOLD=0.7).
- `runAgent` tartibi: (1) davom etayotgan slot-filling (SUXBAT pivoti shu yerda) → (2) CLARIFY → (3) sub-action dispatch.
  `resolveAction` eski (callbacks/OCR) to'g'ridan sub-intentni ham, yangi high+sub'ni ham qabul qiladi (orqaga-moslik).
- CLARIFY: `intent='CLARIFY'` -> `clarifyingQuestion` + `clarifyOptions[{label, subIntent}]`; conversationda saqlanadi,
  `clarify_<i>` callback tanlangan subIntent bilan davom etadi. Past-ishonch (`<0.7`) har qanday high-level natijada server xavfsizlik to'ri bilan CLARIFY qiladi.
- MIJOZ majburiy maydon tartibi: **ism → tel → manzil → sana/vaqt → narx → to'lov usuli** (`flow.ENTRY_REQUIRED`).
- SUXBAT/analytics: `analyticsMetric|analyticsPeriod` signali bo'lsa routing doimo get_analytics (SEARCH→ANALYTICS promotion).
- Eslatma (X soat oldin/keyin) va Lokatsiya (Mini App 2 maydon) joriy qilindi; eski `defaultReminders`/`service.reminders[]` runtime oqimi yo'q.

## 2026-06-23 Mini App premium redesign qollandi
- Dizayn referensi `_design_extracted/design_handoff_miniapp_redesign/README.md` va `Musir Yoq Redesign.dc.html` asosida Mini App vizual qatlami yangilandi; yangi ogir kutubxona qoshilmadi.
- `styles.css` premium tokenlar, Hanken Grotesk, light/dark `data-theme`, bottom-nav blur, summary/job cards, reminder chiplar va bottom-sheet formalar bilan moslandi.
- Home: salomlashish, summary card, search pill, full-width yangi mijoz CTA va `stats.todayServices` asosidagi bugungi xizmatlar royxati; checkbox `/services/:id/complete` oqimiga ulandi.
- Services: 3 segment (`Bugun`/`Kutilmoqda`/`Bajarildi`), `Bugun` real bugungi sana oraligiga filterlanadi, kartalar avatar+checkbox premium korinishida.
- Finance: 3 davr segmenti (`Bugun`/`Bu oy`/`Yil`), `Joriy balans`, kirim/chiqim kartalari, CSS bar grafik va `Songgi harakatlar` matni.
- Settings: profil karta, light/dark va til segmentlari, oldindan eslatma/keyingi tasdiqlash uchun ikki soat stepperi (+/-), xavfsizlik qatorlari va kod ozgartirish bottom-sheet.
- Yangi mijoz formasi: Ism/Telefon/Manzil(+Xarita)/Sana+Vaqt/Xizmat haqi/som/reminder banner tartibi; Sana/Vaqt mobil viewda ham 2 ustun saqlandi.
- Tekshiruv: `cd miniapp && npm run build` OK; production `dist` static server `http://127.0.0.1:5175/` da Playwright bilan Home/Services/Finance/Settings/Add Client modal va dark toggle tekshirildi. Backend lokal ishlamagani sabab browserda `Failed to fetch` banneri kutilgan holat.

## 2026-06-23 Multi-user Telegram allowlist
- `OWNER_TELEGRAM_ID` endi bitta ID yoki vergul bilan ajratilgan bir nechta Telegram ID qabul qiladi: `6028715926,606578823`.
- `env.js` `ownerIds()` va `isOwnerTelegramId()` helperlarini qo'shdi; validator IDlarning hammasi raqam ekanini tekshiradi.
- Bot guard va Mini App `authMiddleware` allowlist bo'yicha ishlaydi. `AUTH_DEV_BYPASS` eski kabi birinchi IDni ishlatadi.
- `Settings.getSingleton(telegramId)` userga bog'landi: `/kod`, Settings API va delete-code middleware so'rov yuborgan user settingsini ishlatadi.
- Eslatma cron barcha ruxsatli IDlarga xabar yuboradi; Mini App `/reports/send` hisobotni so'rov yuborgan Telegram userga jo'natadi.
- README va `backend/.env.example` comma-separated ID formati bilan yangilandi.

## 2026-06-22 Resilient polling (bot Railway'da javob bermaslik fix)
- Muammo: Railway'ga deploy + MongoDB ulangan bo'lsa ham `/start`ga bot javob bermayotgan edi.
- Jonli diagnostika (`getMe`/`getWebhookInfo`/`getUpdates`): token ✓, webhook bo'sh, Atlas Mongo ✓ ulanadi.
  Lokal start qilinganda Telegram darhol `409 Conflict: terminated by other getUpdates` berdi —
  demak Railway poller tirik edi va env/Mongo to'g'ri. Sabab kod emas, polling modelining mo'rtligi.
- Ildiz sabab: Railway'da public domain yo'q -> `botMode()` `polling`ga tushadi. Eski `index.js`da
  `bot.start().catch()` bitta 409da pollingni butunlay to'xtatardi (konteyner tirik, lekin bot o'lik).
  Redeploy paytida eski+yangi konteyner ikkalasi poll qilib 409 beradi -> bot javob bermaydi.
- Fix: `index.js` `startPollingResilient()` — 409/conflict bo'lsa 5s dan keyin qayta uriniladi
  (eski instance chiqib ketguncha, max 30 marta); muvaffaqiyatli startda hisoblagich nollanadi.
  `runtime.bot` endi haqiqiy polling holatini aks ettiradi. Webhook auto-switch (Railway+domain) saqlanib qoldi.
- Tekshiruv: `node --check` (index/env/bot) OK; ikkita lokal instance bilan real 409 -> qayta urinish ->
  tiklanish kuzatildi (eski kodda birinchi 409 doim o'ldirardi); bitta instance toza polling (`bot:true`,
  warnings bo'sh); `npm run build` OK.
- Eng ishonchli variant (ixtiyoriy, user amali): Railway'da service uchun public domain generate qilinsa,
  kod avtomatik webhookga o'tadi va 409 umuman bo'lmaydi. Shuningdek faqat BITTA service shu tokenni polling qilsin.

## 2026-06-22 Railway Telegram polling conflict fix
- Railway loglari o'qildi: backend start bo'lganidan keyin Grammy `getUpdates` 409 conflict bilan yiqilgan.
- Sabab: Railway'da bot polling rejimida ishlagan, bir token bilan boshqa polling instance yoki restart overlap bo'lganda Telegram `getUpdates`ni rad qiladi.
- `env.js` endi Railway runtime (`RAILWAY_ENVIRONMENT`, `RAILWAY_SERVICE_NAME`, `RAILWAY_PROJECT_ID`, `RAILWAY_DEPLOYMENT_ID`) va public domain mavjudligini aniqlaydi.
- Railway public domain bor paytda `BOT_MODE=polling` berilgan bo'lsa ham runtime `webhook` rejimiga o'tadi va health warnings ichida sababini ko'rsatadi.
- `index.js` polling start promise xatosini ushlaydi, shuning uchun polling conflict processni crash-loop qilmaydi; health `bot:false` warning bilan diagnostika beradi.
- README va `.env.example` Railway webhook/polling conflict bo'yicha yangilandi.
- Verification: `node --check` (`env.js`, `index.js`, `bot.js`) OK; Railway env simulyatsiyasi `mode:"webhook"` qaytardi; local/dev simulyatsiyasi `mode:"polling"` qoldi; root `npm run build` OK.

## 2026-06-22 Railway bot start diagnostics
- `backend/src/config/env.js` endi `backend/.env`ni fayl joylashuviga nisbatan yuklaydi; root workspace'dan import/start qilinganda ham lokal `.env` ko'rinadi.
- Env validatsiyasi kuchaydi: `BOT_TOKEN`, `OWNER_TELEGRAM_ID`, `MONGODB_URI`, namunaviy `GEMINI_API_KEY`, va webhook public URL xatolari `/health` diagnostikasida aniqroq ko'rinadi.
- Bot owner guard noto'g'ri `OWNER_TELEGRAM_ID` holatida `/start`ni jim tashlamaydi: ruxsatsiz `/start`ga qisqa Uzbek diagnostika javobi beradi va logga Telegram ID yozadi.
- Self-check: `node --check` (`env.js`, `bot.js`) OK; `npm.cmd run build` OK; real MongoDB connect OK; Telegram Bot API `getMe` OK (`@Musor_yoq_bot`), `getWebhookInfo` OK va webhook URL hozir o'rnatilmagan.

## 2026-06-22 Second audit fixes
- `CODEX_FIXLOG.md` yaratildi va har bir topilgan/tuzatilgan muammo 1 qatordan yozildi.
- `completeService()` double-click race yopildi: pending->done DB atomic update bo'lmasa yangi income transaction yaratilmaydi.
- Completed service narxi qayta yuborilganda linked income transaction amount ham yangilanadi.
- Single service soft-delete endi linked income transactionni ham soft-delete qiladi; restore service linkni qayta tiklaydi.
- Client phone soft-delete kolliziyasi boshqarildi: deleted client qayta ishlatilsa tiklanadi, active duplicate phone update 409 beradi.
- Service/finance input validation kuchaytirildi: invalid date, manfiy/NaN amount, noto'g'ri phone, bo'sh location DBga o'tmaydi.
- API error middleware CastError/ValidationError/duplicate key uchun 400/409 qaytaradi.
- Telegram file/image proxy fetchlariga timeout qo'shildi; SSE AI search xatoda `error` event bilan yopiladi.

## 2026-06-22 Gemini model 2.0 update
- Local `backend/.env` `GEMINI_MODEL=gemini-2.0-flash` ga almashtirildi.
- Tracked defaults ham moslandi: `backend/.env.example`, `backend/src/config/env.js`,
  `backend/src/ai/gemini.js`, `README.md`, `AGENTS.md`, `CLAUDE.md`.

## 2026-06-21 Railway diagnostics/degraded startup
- Uchinchi Railway loglar yana `MONGODB_URI` missing ekanini ko'rsatdi. Bu endi kod alias muammosi emas: runtime environmentda Mongo variable umuman yo'q yoki app servicega link qilinmagan.
- `backend/src/index.js` qayta ishlanib, Express server env/DB tayyor bo'lmasa ham crash-loop qilmaydigan diagnostika rejimida start qiladi.
- `/health`, `/api/health`, `/api/v1/health` authsiz liveness/diagnostics qaytaradi: `ok`, `db`, `bot`, `errors`, `warnings`, `mode`, `startedAt`.
- API route'lar readiness gate orqali o'tadi: runtime tayyor bo'lmasa 503 va health payload qaytaradi; tayyor bo'lsa router ishlaydi.
- Bot moduli endi faqat env validatsiya va Mongo ulanishdan keyin dynamic import qilinadi, token/env xatolari import vaqtida appni yiqitmaydi.
- `/api/v1` mount tartibi latent bug sifatida tuzatildi: endi `/api/v1` `/api`dan oldin mount qilinadi.
- `env.js` Railway domain aliaslarini qo'llab-quvvatlaydi (`RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_PUBLIC_URL`, `PUBLIC_URL`, `APP_URL`) va productionda domain bor bo'lsa default `BOT_MODE=webhook` qiladi.
- Verification: `node --check` (`env.js`, `index.js`, `bot.js`) OK; missing-Mongo smoke test `/health` `ok:false` bilan qaytdi va process crash qilmadi; root `npm run build` OK.
- User action still required: Railway Variables ichida MongoDB URL kiritilishi yoki MongoDB service app servicega reference bilan ulanishi kerak (`MONGODB_URI=${{MongoDB.MONGO_URL}}` yoki real URL).

## 2026-06-21 Railway Mongo env parts fix
- Yangi Railway loglarda so'nggi commit ishlayotgani tasdiqlandi, lekin `MONGODB_URI` hali ham topilmagan. Bu deploy environmentda to'liq Mongo URL yo'q yoki servicega ulanmaganini bildiradi.
- Kod tomondan qo'shimcha qamrov berildi: `env.js` endi `MONGO_PUBLIC_URL`, `MONGODB_URL`, `MONGODB_PRIVATE_URL`, `MONGODB_PUBLIC_URL` aliaslarini ham tekshiradi.
- Agar to'liq URL bo'lmasa, `MONGOUSER`/`MONGOPASSWORD`/`MONGOHOST`/`MONGOPORT`/`MONGODATABASE` (va yaqin variantlari) dan `mongodb://...` URL avtomatik yig'iladi.
- `.env.example` va `README.md` shu Railway Mongo variable variantlari bilan yangilandi.
- Verification: `node --check` (`env.js`, `index.js`) OK; runtime testlarda to'liq `MONGO_URL` ustuvor ishladi va bo'lak `MONGO*` envlardan URL yig'ildi; root `npm run build` OK.
- Agar keyingi log ham `MONGODB_URI` missing desa, Railway projectda MongoDB service app servicega ulanmagan yoki Variables bo'limida umuman Mongo qiymatlari yo'q; buni Railway UI'da user qo'shishi kerak.

## 2026-06-21 Railway Mongo env alias fix
- Railway runtime logidagi crash sababi: backend faqat `MONGODB_URI` ni o'qigan, lekin deploy muhitida Mongo ulanishi boshqa Railway/Mongo alias nomi bilan berilishi mumkin.
- `backend/src/config/env.js` endi `MONGODB_URI`, `MONGO_URL`, `MONGO_PRIVATE_URL`, va `mongodb://` yoki `mongodb+srv://` bilan boshlanadigan `DATABASE_URL` dan birinchisini qabul qiladi.
- `validateEnv()` xabarlari ASCII/o'qiladigan formatga o'tkazildi; Mongo env yo'q bo'lsa qabul qilinadigan aliaslar aniq chiqadi.
- `backend/src/db/connect.js` MongoDB start/disconnect loglaridagi emoji olib tashlandi, Railway loglarida mojibake chiqmasligi uchun.
- `backend/.env.example` va `README.md` Railway Mongo aliaslari bilan yangilandi.
- Verification: `node --check` (`env.js`, `connect.js`, `index.js`) OK; runtime import `MONGO_URL` aliasini `env.MONGODB_URI` sifatida tasdiqladi; root `npm run build` OK.

## 2026-06-21 ExcelJS export + safe bulk delete flow
- `exceljs` is now a backend dependency. `POST /reports/excel` returns a real `.xlsx` workbook
  (`musir_yoq_eksport.xlsx`) instead of XML `.xls`.
- Excel export has 4 sheets: `Mijozlar` (id, name, phone, locations, dates), `Xizmatlar` (full service fields),
  `Tranzaksiyalar` (all active income/expense rows), and `Xulosa` (monthly income/expense/balance/service
  breakdown). Headers are styled, first row is frozen, columns auto-size, alternating rows are shaded.
- `POST /reports/send` with `{ format: "excel" }` sends the generated `.xlsx` buffer to the owner via
  `bot.api.sendDocument`.
- Mini App Excel downloads now use `.xlsx`; Settings `Botga yuborish` sends the full Excel backup to the bot.
- Mini App danger-zone deletion now uses the prompt contract `POST /data/delete` with `{ target, code }`.
- `ConfirmDeleteModal` now starts with the backup question before PIN entry when `onExport` is provided:
  `Ha, PDF olaman` or `Yo'q, to'g'ridan o'chirish`.
- `PUT /settings/change-code` now returns the requested validation message for invalid new codes:
  `Yangi kod 4 ta raqamdan iborat bo'lishi kerak`.
- Verification: backend `node --check` passed for reports/data/settings routes, `reports.js` import passed,
  ExcelJS smoke test passed, and Mini App `npm run build` passed.

## 2026-06-21 Callback handlers, reminders, PDF hardening
- Bot callbacks now match the requested flow more closely: `complete_`/`svc:done`, `not_done_`,
  `snooze_`/`reschedule_`, `cancel_` with confirmation via `cancel_confirm_`/`cancel_no_`, and
  `disable_reminder_` for removing unsent reminders.
- `notDoneKeyboard()` now sends `snooze_{serviceId}` for "Uzaytirish"; both `snooze_` and
  `reschedule_` set `session.awaitingReschedule` and ask for a new service date/time.
- `futureServiceKeyboard()` includes a direct "Eslatmani o'chirish" action. `disable_reminder_` is also
  aliased to the old `mute_` handler and preserves already-sent reminders.
- `reminderService` now creates reminder objects with `failed`, `retryCount`, and `nextRetryAt`, accepts
  custom offset `0`, and exports `scheduleRemindersForService(service, customMinutes)` for prompt-compatible
  service mutation.
- PDF report summary now includes `Jami kirim`, `Jami chiqim`, and `Balans`; report data computes income and
  expense from transactions. PDF table rows color service/finance rows by status/type where possible.
- Verification: `node --check` passed for changed backend files, callback module import passed, and a minimal
  `createReportDoc()` runtime smoke test emitted `pdf ok`.

## 2026-06-21 Mini App pages 4-6: Finance, Reports, Settings
- Finance page covers the requested long-scroll flow: balance card, period tabs, last-6-month Chart.js bars,
  income/expense add modals, grouped transactions, edit modal, and swipe-left delete through `ConfirmDeleteModal`.
- Reports page now has segmented filters for type (`clients`/`finance`/`full`), period mode (custom date range,
  latest N, month picker), and action buttons for PDF download, Excel download, and sending the report to the bot.
- Reports backend has `POST /reports/send` for bot delivery. `attachReportBot(bot)` is called from `index.js`;
  `reports.js` avoids importing the bot directly to prevent circular imports. PDF and Excel generation share the same
  range/type helpers, and Excel now honors report type filtering.
- Settings page is split into appearance, reminders, security code change, data export, danger zone, and 30-day restore.
  Data export supports Excel, PDF, and bot delivery. Client restore opens a modal where related services can be checked
  before restoring with `POST /system/restore`.
- Verification: `npm run build` in `miniapp` passed; `node --check backend/src/routes/reports.js` and
  `node --check backend/src/index.js` passed. Vite dev server was started at `http://127.0.0.1:5175`; Playwright
  verified Reports and Settings render. Backend was not running during browser QA, so fetch errors were expected.

## 2026-06-20 Mini App UI update
- Home page now uses 300ms debounced client search (`GET /clients?search=`), QuickStatsRow
  (`Bugungi xizmatlar` + `Balans`), floating AI button, bottom-sheet AI SSE chat, and service result taps.
- Clients page now has add-client modal, richer ClientCard (last service date, debt badge, deleted badge),
  client detail bottom sheet, service history taps, edit/delete flows.
- Services page now has Kanban drag-to-Bajarildi confirmation, list filters, expandable cards, service
  bottom sheet, complete/reschedule/cancel/edit/delete modals.
- Build check passed with `cd miniapp && npm run build`.

## 2026-06-20 Gemini helpers + confirmation format + reminder/PDF bot flows
- gemini.js exports spec helper aliases `geminiTranscribeAudio(buffer,mime)` and
  `geminiOCR(image,mime)` (Buffer or base64) wrapping the robust transcribeAudio/extractNotebookRecords.
- `serviceConfirmationText` now renders the bordered spec format (✅/👤/📱/📍/📅/💰/💳/📝 with ━ dividers).
- `futureServiceKeyboard` labels: `📅 Standart eslatma` / `✏️ Eslatmani sozlash`.
- Custom reminder flow: `reminder_edit_<id>` sets `session.awaitingReminderConfig` and asks for an offset;
  text handler parses it via `flow.parseReminderOffset` ("2 soat oldin"→120, "30 daqiqa oldin"→30,
  "1 kun oldin"→1440, "xizmat vaqtida"/"0 daqiqa"→0, "yarim soat"→30) and rebuilds the service's reminders
  (keeps already-sent ones). `reminder_default_<id>` just confirms standard reminders.
- `/pdf` command shows `pdfFilterKeyboard` (type × period); `pdf:<type>:<period>` callback builds the PDF in
  memory via new `generateReportPdf()` export in routes/reports.js (also exports `resolveReportRange`) and
  sends it through the bot with `replyWithDocument(new InputFile(...))`. Type ∈ full|finance|services|clients,
  period ∈ month|all.
- `/start` text is now "Salom! 👋 Ovoz, matn, rasm yoki joylashuv yuboring."; `clearState` clears all new
  session fields (awaitingReschedule, awaitingReminderConfig, ocrQueue, currentOcrIndex).

## 2026-06-20 Gemini AI pipeline upgrade (intent → extract → slot-fill → tools)
- Intents extended to 9: added `SERVICE_EDIT` and `CLIENT_EDIT` alongside the existing
  SERVICE_ENTRY/EXPENSE_ENTRY/INCOME_ENTRY/STATUS_UPDATE/PAYMENT_UPDATE/SEARCH_QUERY/ANALYTICS_QUERY.
- Extraction: classify schema now has `hasDollar` (USD blocked — owner must confirm som; price/amount left null)
  and `targetIdentifier`/`editField`/`newValue` for edits. `normalizeExtractedFields` handles both edit intents.
- Dollar guard (`requiresSomConfirmation`) now also triggers on `fields.hasDollar === true` and covers SERVICE_EDIT.
- Edit flow is confirm-first: `handleServiceEdit`/`handleClientEdit` find the target, store a pending
  `EDIT_CONFIRM` on the Conversation, and reply with `editConfirmKeyboard()` (`edit_confirm`/`edit_cancel`).
  `applyConfirmedEdit()` (exported from agent.js) runs the actual `editService`/`updateClient` on confirm.
- Field maps: service narx→price, sana→serviceDateTime, manzil→location; client ism→name, telefon→phone.
- Agent tool declarations expanded to the spec set: `edit_service`, `edit_client`, `complete_service`,
  `cancel_service`, `reschedule_service`, `get_balance`, `get_services_by_identifier` (plus existing tools);
  all have executors in agent.js. Intent→tool gating still validates Gemini's chosen tool against the expected one.
- Slot-filling for `paymentMethod` now offers inline buttons (`paymentMethodKeyboard` → `pm_naqd/pm_karta/pm_otkazma`);
  the pm_* callback resumes the entry via runAgent and finalizes the service.
  **(2026-06-29 SUPERSEDED)** SERVICE_ENTRY no longer asks for `paymentMethod` — it was dropped from
  `ENTRY_REQUIRED`/Gemini-required/prompt FIELD ORDER and `Service.paymentMethod` is now `default:'naqd'`
  (not required). The bot never prompts payment method; confirmation cards omit the 💳 line. The
  `paymentMethodKeyboard`/`pm_*` paths remain as harmless dead code (never reached via entry). Mini App
  still shows/edits the field.

## 2026-06-20 REST API v1 endpoint contract
- Express now mounts the same authenticated API router at both `/api` and `/api/v1`; existing Mini App compatibility is preserved while new contract uses `/api/v1`.
- Clients:
  `GET /clients` supports `search`, `page`, `limit`; `GET /clients/:id` returns client detail, all active services, `paymentHistory`; `GET /clients/deleted`; `POST /clients/:id/restore` returns restore preview; `POST /clients/:id/restore/confirm` restores selected services.
- Services:
  `GET /services` supports `status`, `clientId`, `dateFrom`, `dateTo`, `page`, `limit`; `GET /services/upcoming` returns next 7 days; `PATCH /services/:id/reschedule` updates time/reminders; `PATCH /services/:id/complete` returns `{ service, transaction }`.
- Transactions:
  `GET /transactions` supports `type`, `dateFrom`, `dateTo`, `category`, `page`, `limit`; `GET /transactions/balance` returns `{ totalIncome, totalExpense, balance, period }`; expense category auto-detect maps fuel/repair/food keywords to DB enums.
- Analytics:
  `GET /analytics/dashboard`, `/analytics/monthly`, `/analytics/clients` are active.
- Settings:
  `PUT /settings/change-code` validates `currentCode === settings.deleteCode` and requires a 4-digit `newCode`.
- Reports/Data:
  `POST /reports/excel` returns an Excel-compatible XML `.xls` export without extra dependencies; `POST /data/restore` accepts `{ collection, ids }`.

## 2026-06-20 MongoDB schemas + REST API alignment
- Active Mongoose schemas now match the requested core collections: `Client`, `Service`, `Transaction`, `Settings`.
- `Client`: `name`, unique `phone`, `locations[]`, soft delete fields, `isDeletedByClientDeletion`; no active `totalDebt`.
- `Service`: required `clientId`, denormalized `clientName/clientPhone`, required `location.address`, `serviceDateTime`, `isHistorical`, `price >= 0`, required `paymentMethod`, `paymentStatus`, `paidAmount`, `status`, `cancellationReason`, `completedAt`, `completionPromptSent`, `notes`, Telegram-only `images[].telegramFileId`, robust reminder retry fields, linked `incomeTransactionId`, client-deletion flags and soft delete.
- `Transaction`: `type`, `amount >= 0`, enum `category` (`xizmat`, `boshqa_kirim`, `yoqilgi`, `tamirlash`, `oziq-ovqat`, `boshqa_chiqim`), `description`, `serviceId`, required `date`, soft delete. Active finance no longer uses `paymentMethod`, `note`, `clientId`, or debt payments.
- `Settings`: `telegramUserId`, `language`, `theme`, `deleteCode`, `reminderHoursBefore`, `confirmHoursAfter`; old `confirmDeleteCode` remains only as a virtual compatibility alias.
- REST API remains service-layer driven: `/clients`, `/services`, `/finance`, `/transactions`, `/settings`, `/system`, `/data`. Public debt API is not active.
- Delete code checks now read `Settings.deleteCode`; default remains env `CONFIRM_DELETE_CODE` or `1990`.
- Mini App finance uses `description` and new category enum values; old `note` display is read-only fallback for older records.

## 2026-06-20 master system context alignment
- Product scope is now centered on 2 active modules: (1) clients/services and (2) finance with one balance.
- Finance rule: `balance = sum(Transaction income) - sum(Transaction expense)`.
- Income sources: completed services (`completeService` creates linked income transaction) and manual other income (`createTransaction` with `type=income`).
- Expense sources: fuel, repair, food, other expense categories (`type=expense`).
- There is no active separate debt/payment ledger. Client payment after a service updates only `Service.paidAmount` and `Service.paymentStatus` (`tolangan`/`tolanmagan`/`qisman`); it does not create a new income transaction.
- `record_payment` remains as an AI/bot compatibility tool name, but it now calls `recordServicePayment()` and updates service payment state only.
- Deprecated debt/debt_payment artifacts may still exist only for old soft-delete/restore compatibility and must not be used for active balance or new business logic.

## 2026-06-10 Gemini agent STEP 1-5 update
- Voice pipeline: Telegram audio/OGG fayli Gemini inline audio orqali aniq Uzbek transcription qiladi, keyin text classificationga ketadi.
- Image OCR: Gemini notebook rasmlaridan records JSON massivini chiqaradi; multi-record tasdiqdan keyin to'liq yozuvlar bulk saqlanadi, yetishmayotgan maydonli yozuvlar alohida qaytariladi.
- Intent classification: `gemini-2.0-flash` function calling, tool `classify_business_input`, 7 intentdan aynan bittasi.
- Data extraction: SERVICE_ENTRY va EXPENSE_ENTRY maydonlari prompt/schema/server normalizatsiyada qat'iy qo'llanadi.
- Missing-field handler: SERVICE_ENTRY uchun tartib phone -> name -> location -> datetime -> price -> paymentMethod; qiymatlar `Conversation` sessionda yig'iladi.
- Agent tools: `create_service`, `update_service_status`, `create_transaction`, `record_payment`, `search_data`, `get_analytics`; Gemini tool tanlaydi, server kutilgan intent-tool mosligini tekshiradi, MongoDB service layer ijro qiladi, natija Gemini orqali Uzbek javobga aylantiriladi.

## 2026-06-11 PDF report + deletion update
- `POST /api/reports/pdf` yangi contractni qabul qiladi: `reportType`, `dateRange`, `limit`, `month`.
  PDFKit A4/Helvetica hisobotida header/footer, summary table, clients/services/finance jadvallari va oxirgi 6 oylik income/expense vector chart bor.
- `requireDeleteCode` middleware qo'shildi; barcha DELETE route'lar `code` yoki eski `confirmationCode` orqali `1990` tekshiradi va xato matni: `Noto'g'ri kod. 1990 kiriting.`
- Restore 30 kunlik oynadagi soft-deleted yozuvlarni tiklaydi; service tiklansa `incomeTransactionId` transaction ham tiklanadi.
- Cleanup cron endi har kuni 00:00 da ishlaydi; eski legacy payment yozuvlari faqat compatibility cleanup uchun qolgan.

## 2026-06-11 additional product rules update
- Service images now store Telegram `fileId` in `service.images[]`; no Cloudinary/S3/local storage added. `GET /api/services/images/:fileId` proxies image bytes from Telegram when needed.
- Service edit logic preserves sent reminders, removes unsent reminders, and recomputes reminders when `serviceDateTime` changes. `isHistorical` services keep `reminders: []`.
- Completed service cancellation soft-deletes linked income transaction; service payment state stays on the service record.
- Bot uses MongoDB-backed Grammy session storage and has fuzzy client payment confirmation: one matching client asks confirmation, multiple clients show inline selection.
- `POST /api/ai/search` streams SSE progress (`Qidirmoqda...`, `Tahlil qilmoqda...`) and final results; Mini App Home consumes the stream with fetch streaming.
- Mini App adds Reports as the 6th bottom-nav page; Finance has separate `+ Kirim` and `+ Chiqim` actions with amount/note/date and expense category.
- Kanban drag to `Bajarildi` opens the price-change completion modal and calls the existing service complete endpoint.

## 2026-06-11 core business rules alignment
- Finance service is transaction-only for active balance: income/expense transactions drive summary/chart/list. Deprecated payment routes update service payment state only.
- Service completion creates income transaction; service cancellation soft-deletes linked income only if it had already been completed. Pending cancellation does not affect finance.
- Client soft-delete cascade: pending services soft-delete; completed/history services remain for balance history with `isDeletedByClientDeletion` + note. Transactions are not changed.
- Reminder flow: exact-time reminder asks `Ha, bajardim` / `Yo'q, bajarmadim`; no -> `Uzaytirish` or `Bekor qilish`. Failed reminder sends retry at 5m/15m/1h, max 3 retries.
- Delete code is stored in Settings and can be changed only by providing the current code.
- Dollar amounts are blocked server-side before write; bot asks user to convert to UZS.
- Client restore supports choosing which related services to restore; selected future pending services get reminders recomputed.
- Mini App service detail can delete unsent reminders. Finance/Clients active UI no longer shows separate debt module; payment state stays at service level.
- PDF report labels follow Mini App language (`uz`/`ru` request field).

> Boshqa AI yoki yangi sessiya uchun to'liq kontekst. Oxirgi yangilanish: 2026-06-24.

## Project overview
**Musir Yo'q** — O'zbekistondagi yakka tartibdagi musor olib ketish biznesi egasi uchun
Telegram bot + Mini App. Faqat bitta foydalanuvchi (egasi). Google Gemini AI markaziy aql:
o'zbekcha ovoz/matn/rasmni tushunadi, 3 asosiy niyatga (MOLIYA/MIJOZ/SUXBAT) + aniq subIntentga
ajratadi, maydonlarni chiqaradi, bazani yangilaydi.

## Tech stack
- Backend: Node.js + Express (ESM) · Mongoose/MongoDB · Grammy · Gemini (gemini-2.5-flash-lite) · node-cron · PDFKit
- Frontend: React + Vite · Telegram Mini App SDK · Chart.js · i18n (uz to'liq, ru tayyor)

## Folder structure
```
backend/src/
  config/env.js          # env + validateEnv()
  db/connect.js
  models/                # Client, Service, Transaction, Settings, Conversation, softDelete
  ai/                    # gemini.js (multimodal), prompts.js, intents.js (taksonomiya), agent.js (3 high-level + subIntent router)
  bot/                   # bot.js (owner guard), flow.js (slot-filling), handlers/{commands,message,callbacks}
  services/              # clientService, serviceService, financeService, reminderService, searchService, deleteService
  routes/                # index, stats, clients, services, finance, settings, ai, reports, system
  middleware/            # auth.js (Telegram initData HMAC), asyncHandler.js
  cron/                  # reminders.js (har daqiqa), cleanup.js (03:00)
  utils/                 # phone, money, dates, pdf
miniapp/src/
  pages/{Home,Clients,Services,Finance,Settings}.jsx
  components/{Modal,Spinner,BottomNav,ConfirmDeleteModal,ServiceDetailModal}.jsx
  i18n/{index,uz,ru}.js · store/AppContext.jsx · api/client.js · telegram.js · utils/format.js
```

## Completed work
- To'liq backend: modellar, AI agent (3 high-level + subIntent), bot (ovoz/matn/rasm/lokatsiya), slot-filling,
  REST API, cron (eslatma + tozalash), PDF hisobot, initData auth.
- To'liq Mini App: 5 sahifa, Kanban/List, Chart.js, til/mavzu, xavfli zona, tiklash.
- Tekshiruvlar: barcha fayllar syntax OK; biznes-mantiq assert testlari; **real MongoDB**ga
  qarshi integratsiya testi (moliya qoidalari + API + 1990 kod gate) — hammasi o'tdi.
- Hujjatlar: README.md (setup/deploy), CLAUDE.md yangilandi.

## Schema (oldingi 2026-06-08 snapshot; 2026-06-20 bo'limi ustuvor)
- **Client**: name, phone (unique, +998...), locations[{address, mapUrl}],
  soft-delete. Indekslar: phone(unique), isDeleted.
  totalSpent saqlanmaydi — bajarilgan xizmatlardan hisoblanadi (getClientDetail).
- **Service**: clientId(req), clientName/clientPhone (denorm), location{address(req), mapUrl},
  serviceDateTime, isHistorical, price, paymentMethod('naqd'|'karta'|'otkazma' — apostrofsiz!),
  paymentStatus('tolanmagan'|'tolangan'|'qisman'), paidAmount, status, completedAt, notes,
  images[], reminderAt, reminderSent, confirmAt, confirmSent, incomeTransactionId, soft-delete.
  Indekslar: clientId, status, serviceDateTime, isDeleted.

- **Transaction**: 2026-06-20 dan boshlab yuqoridagi joriy schema ustuvor:
  `type`, `amount`, enum `category`, `description`, `serviceId`, `date`, soft-delete.
- **Legacy payment artifacts**: old `debt_payments` modeli fayli qolishi mumkin, lekin active REST/API/balance oqimida ishlatilmaydi.
- **Settings**: telegramUserId(String, unique, req), language, theme, `deleteCode`,
  reminderHoursBefore, confirmHoursAfter (standart: 3/3 soat).
- **Hisob qoidasi**: summary daromadi faqat income tranzaksiyalardan hisoblanadi.
  qo'shilmaydi (xizmat bajarilganda to'liq narx yozilgan, ikki marta sanalmasin).
  listTransactions faqat active Transaction kolleksiyasini qaytaradi.

## Important decisions / assumptions
- **Daromad tan olinishi:** faqat `bajarildi` xizmat daromad tranzaksiyasini yaratadi.
  `ensureServiceIncome` har "bajarildi"da FAOL income borligini kafolatlaydi (yo'q bo'lsa
  yaratadi — o'z-o'zini tuzatish). Startup `repairMissingServiceIncome()` eski DONE+income-yo'q
  xizmatlarni balansga tiklaydi. Soft-deleted income (bekor/o'chirishda qaytarilgan) qayta tiklanmaydi.
- **Eslatma jadvali (3 bosqich):** (1) `reminderAt` = serviceDateTime − reminderHoursBefore (oldindan,
  vaqti o'tib ketgan bo'lsa yuborilmaydi); (2) `startReminderSent` — xizmat VAQTIDA eslatma
  (`serviceDateTime` kelganda, cron `fireStartReminders`, 2 soat grace); (3) `confirmAt` =
  serviceDateTime + confirmHoursAfter ("bajarildimi?" tugmali). 1 va 2 mustaqil: <3 soat oldin
  kiritilsa faqat vaqtida; 3+ soat bo'lsa ikkalasi ham. Mini App'da bajarildi → `notifyOwner` (bot xabari).
- **To'lov holati:** xizmat ichida `paymentStatus` va `paidAmount`; alohida qarz modeli faol emas.
  Botdan "bajarildi" deyilsa, to'langan deb olinadi (markPaid=true).
- **Tarixiy yozuv** (o'tgan zamon): o'tmishdagi sana bo'lsa avtomatik `bajarildi` + to'langan deb yoziladi.
- **Bot rejimi:** `polling` (dev) va `webhook` (prod) — `BOT_MODE` orqali.
- **Kod tili:** identifikatorlar inglizcha, UI/bot matni o'zbekcha (i18n).
- **Ruscha i18n:** asosiy kalitlar tarjima qilingan, qolgani uz ga fallback.

## Current state
- 2026-06-24: Javob tezligi + model + emoji. (1) TEZLIK: `agent.js executeToolFlow` dan ortiqcha Gemini chaqiruvlari olib tashlandi — niyat allaqachon tasniflangani uchun tool tanlash DETERMINISTIK (`fallbackToolCall`), avvalgi `chooseAgentTool` Gemini chaqiruvi (natijasi baribir faqat deterministik tanlovga mos kelganda ishlatilardi) o'chirildi; yozuv amallari (create/update/...) endi shablon javob oladi (`fallbackResponse`, emoji bilan), `formulateToolResponse` faqat o'qish-so'rovlari (search/analytics) uchun chaqiriladi. Natija: xizmat/xarajat saqlash tasdig'i ~0 qo'shimcha Gemini chaqiruvi (avval 2 ta), qidiruv 3→2, ovozli qidiruv 4→3. (2) MODEL: standart `gemini-2.5-flash` (avval flash-lite) — aqilliroq/tabiiy; `env.js DEFAULT_GEMINI_MODEL`, `gemini.js PRIMARY_MODEL` + CANDIDATE (flash → flash-lite → flash-latest), `.env`/`.env.example` yangilandi. **Railway Variables'da `GEMINI_MODEL` ni `gemini-2.5-flash` qiling yoki o'chiring (default ishlashi uchun).** (3) EMOJI: `prompts.js BOT_PERSONA` ga kam-kam mos emoji ko'rsatmasi; `flow.js QUESTIONS` slot-savollariga 👤📞📍📅💰💳 qo'shildi (shablonlarda allaqachon bor). Tekshiruv: `node --check` + import OK; model `gemini-2.5-flash` ga resolve bo'ldi.
- 2026-06-24: "Dollarni saqlay olmayman" soxta xato + ovoz xato muomalasi tuzatildi. (1) `agent.js requiresSomConfirmation` avval `rawText` + `JSON.stringify(fields)` ustidan `/(\$|dollar|usd)/i` qidirardi; SERVICE_ENTRY normalizatsiyasida `hasDollar` kaliti DOIM bo'lgani uchun JSON ichidagi "hasDollar" so'zi "dollar"ga mos kelib, dollar aytilmasa ham HAR xizmat yozuviga "dollarni saqlay olmayman" javobi chiqardi. Endi faqat foydalanuvchi MATNI tekshiriladi (`/(\$|dollar|dollor|\busd\b)/i`) — soxta xato yo'q, haqiqiy dollar (shu jumladan o'zbekcha "dollor") hamon ushlanadi. (2) `message.js` ovoz/audio oqimi: transkripsiya va keyingi NLU ALOHIDA try/catch'ga ajratildi (avval NLU xatosi ham "Ovozni tushunolmadim" bo'lib asl sabab yashirinardi); bo'sh transkripsiyaga aniq yo'riq beriladi. Tekshiruv: `node --check` 3 fayl OK; regex eski/yangi taqqoslash testi (xizmat yozuvi: eski=true buggy → yangi=false; haqiqiy dollar=true) o'tdi.
- 2026-06-24: Railway crash + ovozli xabar tuzatildi (bitta ildiz sabab). Webhook rejimida grammy default `onTimeout: 'throw'` + 10s timeout — handler 10s dan oshsa Express async middleware'da "unhandled rejection" bo'lib butun process'ni o'ldirardi. Ovoz oqimi (download + 3-4 ketma-ket Gemini chaqiruvi, chegarasiz) doim 10s dan oshib, har ovozli xabarda process yiqilardi → egaga hech qanday javob bormasdi (poison-pill: Telegram qayta yuborib crash-loop). Tuzatish: (1) `index.js` webhook `{ onTimeout: 'return', timeoutMilliseconds: 25_000 }` — timeout'da Telegram'ga 200, ish fonda davom etadi, crash yo'q; (2) `index.js` global `unhandledRejection`/`uncaughtException` handlerlari — process tirik qoladi; (3) `gemini.js` har `generateContent`'ga 20s `timeout` — osilib qolgan chaqiruv uziladi va xato egaga ko'rsatiladi; (4) `db/connect.js` `connected`/`reconnected` tinglovchilari (avval yo'q edi → "MongoDB uzildi" dan keyin jimlik); health endpoint endi `mongoose.connection.readyState` ni jonli o'qiydi. Tekshiruv: `node --check` 3 fayl OK.
- 2026-06-24: Bot media xarajat nazorati qo'shildi. `backend/src/bot/mediaLimits.js` RAM Map bilan rasm 10 ta/60 soniya limitini, 10 daqiqalik `limitni ochib qo'y` bypassini, >90 soniya voice rad etishni va unsupported media javoblarini markazlashtiradi. `message.js` photo/media-groupni AI/downloaddan oldin tekshiradi; oversized album butunlay rad qilinadi, 11-rasm kutish vaqti bilan rad qilinadi.
- Loyiha **ishlashga tayyor**. Kod to'liq. Faqat haqiqiy `.env` (BOT_TOKEN, OWNER_TELEGRAM_ID,
  MONGODB_URI, GEMINI_API_KEY) kerak. `backend/.env.example` va `miniapp/.env.example` mavjud.
- 2026-06-21: Bot lokatsiya oqimi kuchaytirildi. Location yuborilganda reverse geocode natijasi avval
  `Ha, to'g'ri` / `Nomi o'zgartirish` orqali tasdiqlanadi; koordinata faqat tasdiq sessiyasida qoladi, DBga address + mapUrl yoziladi. Slot-filling davomida location tasdiqlansa agent keyingi maydonga davom etadi,
  suhbatsiz yuborilgan location esa yangi xizmat boshlash savoliga o'tadi.
- 2026-06-21: Railway deploy xatosi tuzatildi. Root papkada `package.json` yo'qligi sabab Railpack app turini
  aniqlay olmagan; root workspace manifest qo'shildi. `npm run build` Mini App'ni build qiladi, `npm run start`
  backend service'ni ishga tushiradi.
- 2026-06-21: Railway builddagi Rollup optional dependency xatosi tuzatildi. Root `package-lock.json` ga
  `miniapp/node_modules/@rollup/rollup-linux-x64-gnu` entry qo'shildi; Linux dry-run `npm ci` endi shu paketni
  o'rnatishini ko'rsatadi.

## Known issues / TODO (ixtiyoriy yaxshilashlar)
- PDFKit standart shrift kirill (ruscha) matnni qo'llamaydi — ruscha PDF uchun TTF shrift kerak.
- Ruscha tarjimalar to'liq emas (uz ga fallback).
- Avtomatik testlar repo'da saqlanmadi (vaqtinchalik yozildi, ishlatib o'chirildi).

## Spec qamrovi (joriy)
- Bot: ovoz/matn/rasm/lokatsiya · 3 high-level intent + subIntent · bittalab savol · tasdiq xulosasi.
- Eslatmalar: `reminderAt = serviceDateTime - reminderHoursBefore`, `confirmAt = serviceDateTime + confirmHoursAfter`; cron har xabarni atomar claim qiladi va reschedule eski jadvalni bekor qiladi.
- Lokatsiya: Client/Service DB formati `{ address, mapUrl, coordinates }`; bot pin kelajak yozuvlarda original lat/lng saqlaydi. Mini App address matnining o'zi link: manual mapUrl ustuvor, bo'lmasa Google Maps coords; eski yo'qolgan coords backfill qilinmaydi.
- Mini App: 5 sahifa + sozlamalarda alohida reminder/confirm soatlari.
- Moliya: daromad faqat xizmat bajarilganda, balans faqat active Transaction income/expense asosida.
- O'chirish: 1990 kod, soft-delete, 30 kun tiklash, tungi cleanup.

## Notes for another AI
- Biznes mantiqni `services/` da o'zgartiring — bot va API ikkalasi shu yerdan foydalanadi.
- Yangi maydon qo'shsangiz: model + `flow.js` (slot-filling) + `prompts.js` (AI sxema) + Mini App formani yangilang.
- Har katta ishdan keyin shu faylni va `SESSION_HANDOFF.md` ni yangilang.
