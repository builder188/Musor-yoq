# SESSION_HANDOFF.md

## 2026-07-05 Kategoriya fallback mustahkamlash
- **Maqsad:** erkin kirim/chiqim kategoriyasi mavjud bo'lsa ham, category bo'sh kelgan yoki kelishik qo'shimchasi bilan kelgan holatlarda yozuv `boshqa_*`ga tushib ketmasin.
- **O'zgardi:** `flow.js` category normalizeri `-ga/-dan/-da/-ni/-ning` qo'shimchalarini strip qiladi (`svalkaga` -> `svalka`, `ijaradan` -> `Ijara`) va `svalka` uchun `poligon/musorxona/axlatxona/chiqindi poligoni` sinonimlarini tanidi.
- **O'zgardi:** `financeService` income category bo'sh bo'lsa izohdan manba ajratadi (`ijaradan tushdi` -> `Ijara`, `bonus oldim` -> `Bonus`, `boshqa ishdan tushdi` -> `Boshqa ish`); noaniq income `boshqa_kirim` bo'lib qoladi.
- **Self-check:** backend write/read testi 41/41 PASS; Mini App build OK; node syntax checks OK.

## 2026-07-05 Erkin kirim/chiqim kategoriyalari + Svalka
- **Maqsad (foydalanuvchi):** kirim/chiqim faqat oldindan belgilangan toifalarga tiqilmasin. Agar aytilgan narsa mavjud kategoriyaga aniq mos kelmasa, "boshqa"ga tushmay, foydalanuvchi aytgan nom/ibora bilan yangi kategoriya avtomatik yaralsin. "Svalka" musor tashlash joyi to'lovi uchun oldindan tanilgan xarajat kategoriyasi bo'lsin.
- **Backend:** YANGI `backend/src/models/IncomeCategory.js`; `categoryService`ga `ensureIncomeCategory`, `listKnownIncomeCategories`, `getIncomeCategoryRecords`, overview `incomes`; `routes/categories.js`ga `/income/:name/records`; `Transaction` legacy ro'yxatlariga `svalka`; `DEFAULT_EXPENSE_CATEGORIES`ga Svalka.
- **Saqlash oqimi:** `financeService` income categoryni `normalizeIncomeCategory` + `ensureIncomeCategory` orqali kanonik saqlaydi (`ijara` -> `Ijara`). Expense fallback `svalka`ni slug qiladi va category berilmasa ham "magazinga/bozorga ..." kabi qisqa aytilgan joy/maqsaddan dynamic category yasaydi; faqat haqiqatan noaniq matn `boshqa_chiqim`.
- **AI/bot:** `gemini.js` schema + `prompts.js` INCOME CATEGORY qoidasi; `agent.js` income categoryni create/edit/multi-entry/post-save new-vs-editda olib yuradi; `ui.js` income categoryni xulosalarda ko'rsatadi. "svalkaga ... ishlatdim" -> `svalka`; "ijaradan 1 mln tushdi" -> `Ijara`; "magazinga 400 ming ishlatdim" -> `Magazin`.
- **Mini App:** Finance Add/Edit transaction formi income/expense uchun category yuboradi, dynamic ro'yxat + "Yangi kategoriya" inputi bor. Categories sahifasida "Kirim kategoriyalari" bo'limi va detail records qo'shildi; i18n uz/ru yangilandi.
- **Self-check:** `node --check` o'zgargan backend fayllar OK; `npm run build --workspace musir-yoq-miniapp` OK; `npm run test:write-read --workspace musir-yoq-backend` 38/38 PASS; `git diff --check` OK (CRLF warninglari xolos).

## 2026-07-05 Yozish ishonchliligi auditi — "yozuvlar tasodifiy yo'qoladi" bug
- **Maqsad (foydalanuvchi):** ba'zi kiritilgan ma'lumotlar (xarajat, xizmat...) vaqti-vaqti bilan MongoDB'ga yozilmay / Mini App'da ko'rinmay qolardi. Barcha kiritish yo'llari tekshirilib, yozish tasdiqlanmasdan "saqlandi" deyilmasligi, xatoda esa jim qolmay aniq xabar + server logi ta'minlandi.
- **Topilgan ildiz sabablar (3 ta asosiy):** (1) `setWebhook`/`deleteWebhook` da `drop_pending_updates: true` — HAR deploy/restart oynasida yozilgan xabarlar Telegram navbatidan JIMGINA tashlanardi (eng katta "tasodifiy yo'qolish" sababi); (2) SIGTERM'da darhol `process.exit(0)` — redeploy paytida yarim yozilgan amallar o'lardi; (3) webhook rejimida bir user xabarlari PARALLEL ishlanardi (sequentialize yo'q) — Conversation/session holati poygada buzilardi. Qo'shimcha: Mini App ro'yxat sahifalari yuklash xatosida jim bo'sh ro'yxat ko'rsatardi — foydalanuvchi buni "yozuv saqlanmagan" deb qabul qilardi.
- **Backend o'zgarishlar:** `index.js` (drop_pending olib tashlandi ×2; 8s graceful shutdown; API error handler 5xx'da stack+metod+yo'l), `bot/bot.js` (per-user navbat middleware — media_group ISTISNO, aks holda albom settle-timeri bilan o'zaro kutish; bot.catch endi stack log + egaga xabar), `bot/handlers/message.js` (location handler try/catch; getConversation atomar upsert), `bot/handlers/callbacks.js` (getOrCreateConversation upsert), `ai/agent.js` (executeToolFlow tool xatosini stack bilan loglaydi; enterPostSaveState + multi-entry post-save: yozuv saqlangach holat-saqlash yiqilsa ham "saqlandi" xulosasi qaytadi — faqat tugmalarsiz).
- **Mini App:** YANGI `components/LoadError.jsx`; Home/Finance/Services/Clients/Items/Reminders/Categories load()larida `loadError` holati + banner ("yozuvlaringiz bazada turibdi") + Qayta urinish; i18n `common.loadError`/`common.retry` uz+ru (ikkala fayl!).
- **YANGI test:** `backend/scripts/write-read-test.mjs` (`npm run test:write-read`; mongodb-memory-server devDep — production bazaga TEGMAYDI). Har kiritish turi yozish→o'qish: xizmat (kelajak: balansga tushmaydi→bajarilgach tushadi; tarixiy: darhol daromad, sanasi voqea kuni), kirim, chiqim (kalit so'z toifa), shtraf (dinamik kategoriya kanonik), material (nom kanonik + kategoriya sahifasi), buyum (entry/sale kategoriya 'buyum'/giveaway), qarz (balans ayiriladi→hal bo'lgach tiklanadi); xato yo'llari (manfiy summa, identifikatsiyasiz xizmat, noto'g'ri sana) THROW qiladi; tenant izolyatsiyasi + fail-closed. Natija: 34/34 PASS.
- **Muhim invariant (tekshirildi):** barcha "saqlandi" javoblari DB amalidan KEYIN quriladi (finalizeEntry → executeToolFlow → savedRefFromResult → xulosa); Mini App yozuvlari `alert(e.message)` bilan xatoni ko'rsatadi va faqat 2xx'da ro'yxatni yangilaydi.
- **Jonli tekshirish (deploy'dan keyin):** deploy KETAYOTGANDA botga xabar yozib ko'ring — server ko'tarilgach o'sha xabar qayta ishlanishi kerak (avval yo'qolardi). Railway logida "Agent tool xatosi"/"Bot xatosi (handler)" yozuvlari endi stack bilan chiqadi.

## 2026-07-05 Multi-entry: bitta ovozda bir nechta yozuv (aralash turlar)
- **Maqsad (foydalanuvchi):** bitta ovozda "ovqatga 60 ming, benzinga 100 ming" desa faqat birinchisi saqlanardi. Endi bitta xabarda NECHTA yozuv bo'lsa hammasi aniqlanib, har biri O'Z turi (chiqim/kirim/xizmat/material/buyum) va qoidalari bilan alohida saqlanadi; bitta umumiy raqamli ro'yxat-xulosa; tahrir/bekor butun to'plamga ("2-sini 120 ming qil", "2-sini bekor qil", "hammasini bekor qil").
- **Ildiz sabab:** Gemini classify funksiyasi BITTA fields obyekti qaytaradi — bir nechta yozuv uchun joy yo'q edi. Yechim: `fields.entries[]` massivi (kind + o'z maydonlari), server har bo'lakni alohida qayta ishlaydi.
- **O'zgargan fayllar:** gemini.js (entries sxemasi barcha kind maydonlari bilan; normalizeMultiEntries har bo'lakni o'z intent normalizatsiyasidan o'tkazadi; MULTI_ENTRY_KIND_TO_INTENT/MULTI_ENTRY_INTENTS eksport), prompts.js (MULTI-ENTRY qoidasi + svalka/Sardor/paxta-televizor misollari), agent.js (resolveMultiEntries + handleMultiEntry 2-bosqichli tayyorlash/saqlash; buildMultiRecord meta; undoSavedEntry 'multi'; editMultiSavedEntry + findMultiEntryTarget (eksport) + handleMultiSavedText qisman bekor; classifyPostSaveMessage MULTI sameIntent; cancelSavedEntry ko'plik matni), ui.js (multiSavedSummaryText keycap ro'yxat + multiRecordLine), message.js (routeSavedEntry boshida handleMultiSavedText).
- **Dizayn qarorlari:** har bo'lak YAKKA oqimdagi tayyorgarlikdan o'tadi (sana korreksiyasi, ovoz-manba, defaults, hamkor standartlari, USD konvertatsiya — kurs yo'q bo'lsa hech narsa saqlanmaydi); saqlash mavjud `executeToolFlow` orqali (yangi saqlash yo'li YO'Q — barcha qoidalar meros); chala bo'lak boshqalarini bloklamaydi (saqlangach birinchi chalasi uchun odatiy slot-filling); DEBT_REMINDER/PAYMENT_UPDATE ataylab multi qamrovidan tashqarida (yakka intent).
- **Tekshiruv:** sof mantiq 30/30 (goal 3 stsenariysi: 2 chiqim / xizmat+chiqim / 3+ aralash; post-save new-vs-edit; target topish — raqam/so'z-tartib/toifa/nom; xulosa matni jami hisoblari), node --check 5 fayl. Jonli test deploy'dan keyin: bitta ovozda "ovqatga 60, benzinga 100" → 2 yozuv; "Sardorga bordim 200 oldim, benzinga 50" → xizmat+chiqim; "2-sini bekor qil" → faqat 2-yozuv o'chadi.

## 2026-07-04 Dinamik xarajat kategoriyalari + "Oziq-ovqat 650 000" bug
- **Maqsad (foydalanuvchi, rasmdagi bug):** ovoz orqali qanday xarajat kiritilmasin, hammasi "650 000 | Oziq-ovqat" bo'lib qolardi. Talab: user istalgan xarajatni kiritadi; kategoriya yo'q bo'lsa dastur AVTOMATIK yaratadi ("benzinga 100 ming" → "Benzin" kategoriyasi); toifasiz kirim-chiqimlar "Boshqa kirim-chiqimlar" bo'limida saqlanadi; ovozli kiritilgan xarajatning OVOZI o'sha kategoriyaga biriktiriladi va Mini App'da eshitiladi.
- **Ildiz sabab 2 ta:** (1) normalizeExpenseCategory regexida "osh" pattern "b-OSH-qa_chiqim"ga mos kelib har noaniq xarajat oziq-ovqat bo'lardi (flow.js + gemini.js nusxasi); (2) post-save holatda xuddi shu intentdagi yangi xarajat 'edit' deb tasniflanib OLDINGI yozuvni yangilardi — shu sabab summa 650 000 va toifa turib qolardi.
- **YANGI fayl:** `backend/src/models/ExpenseCategory.js`. **O'zgargan:** flow.js (legacy-map + dinamik nom + >40 belgi guard; QUESTIONS.category), gemini.js (category enum yo'q ×2, extraction faqat clean.category, normalize yagona manbadan), prompts.js (EXPENSE CATEGORY bo'limi qayta yozildi + benzin/svalka misollar), agent.js (SOURCE_ATTACH_INTENTS + voice hamma tx'ga + classifyPostSaveMessage same-intent 'new' qoidasi + CORRECTION_RE + isSelfContainedEntry + label fallback), message.js (routeSavedEntry sourceMeta), ui.js/queries.js (label fallback), Transaction.js (enum olib tashlandi, OTHER_* konstantalar), financeService.js (normalizeCategory→flow, ensureExpenseCategory create/update'da, voice hamma tx'ga, keyword \b regexlar), categoryService.js (ensureExpenseCategory/listKnownExpenseCategories/expenseKey/overview expenses+other/records), routes/categories.js (expense/:name/records, other/records), Mini App Categories.jsx (2 yangi bo'lim + ExpenseDetail/OtherDetail + TxRecordCard audio), Finance.jsx (categoryLabel helper, dinamik CategorySelect), i18n uz+ru.
- **Dizayn qarori:** 3 asosiy toifa DB'da eski slug ('yoqilgi'/'tamirlash'/'oziq-ovqat') bilan qoladi (i18n/eski ma'lumot buzilmaydi); dinamik toifalar kanonik nom bilan ("Benzin") — `expenseKey` dublikatni oldini oladi. 'qarz' kategoriya statistikadan chetda. Rasm (OCR) oqimi daftar-xizmat yozuvlari uchun — xarajat manbasi ovoz/matn (sourceType 'text' default).
- **Tekshiruv:** normalize testlari 20/20 (shu jumladan "boshqa_chiqim"≠oziq-ovqat regressiyasi); node --check 12 fayl; vite build OK. Jonli test (deploy'dan keyin): ovozda "svalkaga 50 ming berdim" → "Svalka" kategoriyasi yaratilishi, ketma-ket ikkinchi xarajat ALOHIDA yozuv bo'lishi, Mini App Kategoriyalar → Svalka ichida ovoz pleer chiqishi.

## 2026-07-03 Hamkorlik/shartnomaviy mijozlar funksiyasi
- **Maqsad (foydalanuvchi):** doimiy hamkor mijozlar: (1) bir marta "X bilan shartnoma tuzdim, narxi 300 ming, lokatsiya ..." — shartnomaviy deb belgilanadi, standart narx/manzil saqlanadi (Mini App'dan qo'lda ham); (2) keyin "X ga bordim" — standartlar bilan darhol saqlanib balansga qo'shiladi, "X ga boraman" — faqat vaqt so'raladi, mavjud eslatma (3h oldin/keyin) ishlaydi; (3) farqli narx/manzil aytilsa standart yangilanadi; (4) oylik tashrif hisobi (oy almashsa 0'dan, tarix saqlanadi); (5) Mijozlar ro'yxatida 🤝 belgisi bilan, sahifada standart qiymatlar + joriy oy tashrifi, qo'lda tahrirlanadi; (6) hisobotlarda alohida bo'lim; (7) AI standart/yangi qiymatni farqlaydi.
- **YANGI fayl:** `backend/src/services/partnerService.js` — hamkorlik mantig'ining yagona manbasi (bot+API baham ko'radi): findClientByExactName/findPartnerByName/upsertPartnerContract/syncPartnerDefaultsFromVisit/revertPartnerContract/countMonthVisits/getPartnerReportRows.
- **O'zgargan backend:** `models/Client.js` (isPartner/partnerPrice/partnerLocation/partnerSince; phone optional; unique index `phone $gt:''` bilan — syncIndexes almashtiradi), `serviceService.js` (createService hamkor avto-to'ldirish+standart sinxron; editService eng so'nggi tashrif tahririda standart sinxron; ism-lookup ci), `clientService.js` (updateClient partner maydonlari, hamkorda bo'sh tel; getClientDetail currentMonthVisits; findOrCreateClient telsiz mijozga tel biriktirish), `routes/clients.js` (POST isPartner), `routes/reports.js` + `utils/pdf.js` (hamkor bo'limi PDF/Excel), `ai/intents.js`/`prompts.js`/`gemini.js`/`agent.js`/`bot/flow.js`/`bot/ui.js` (PARTNER_CONTRACT subIntent + SERVICE_ENTRY hamkor tashrifi oqimi).
- **Muhim dizayn qarori:** hamkor TASHRIFI alohida intent emas — SERVICE_ENTRY ichida `applyPartnerVisitDefaults` (agent) + createService'dagi hamkor bloki. Standart yangilash NUQTASI — service qatlamida (`createService`/`editService`), shuning uchun bot ham, Mini App ham bir xil ishlaydi.
- **Mini App:** Clients.jsx (badge, hamkor kartasi, Edit/Add modallarda hamkor rejimi), i18n uz+ru, styles.css.
- **Tekshiruv:** node --check 13 fayl; to'liq index.js modul yuklash OK; smoke-testlar (intent taksonomiya, PARTNER_CONTRACT normalize, nextMissing tartibi, post-save 'new'/'edit' routing) PASS; vite build OK. Jonli Telegram/Gemini testi foydalanuvchi zimmasida (deploy'dan keyin): "Salat sex bilan shartnoma tuzdim, narxi 300 ming" → "Salat sexga bordim" → balans tekshirish.
- **Diqqat (deploy):** birinchi deploy'da `Client.syncIndexes()` eski `telegramUserId_1_phone_1` indeksini yangi partialFilterExpression bilan qayta quradi — bu normal va kutilgan.

## 2026-07-02 Lokatsiya pin koordinatalari bugfix
- **Maqsad:** bot orqali kelgan Telegram location pin original lat/lng koordinatalarini yo'qotmasin; reverse-geocode address matni va coords bir recordda saqlansin. Eski records backfill qilinmaydi.
- **Backend:** Service.location va Client.locations[] schema'lariga coordinates qo'shildi. serviceService/clientService normalizerlari address + manual mapUrl + coords'ni birga saqlaydi; service yaratilganda yoki keyin clientga bog'langanda koordinata client locationga ham o'tadi.
- **Bot:** loc_confirm_* va loc_rename_* callbacklar rounded callback coordni lookup uchun ishlatadi, saqlashda pending original coordni ustuvor qiladi. Location rename text handler LOCATION_QUESTION yes/no oqimidan oldin ishlaydi.
- **Mini App:** LocationDisplay address matnini link qiladi: manual mapUrl bo'lsa o'sha, bo'lmasa https://maps.google.com/?q={lat},{lng}. Home/Clients/Services list/history qatorlari shu komponentga o'tdi; edit formalari existing coordinates'ni saqlab qoladi.
- **Tekshiruv:** backend node --check o'zgargan fayllar OK; npm run build OK; Mongoose smoke check service va client location coordinates precision'ini saqladi.
- **Davomi (audit + mustahkamlash):** to'liq oqim qayta tekshirildi (pin → reverse geocode → tasdiq/rename → slot-fill/LOCATION_QUESTION → createService → Mini App link) — koordinata hech qayerda yo'qolmaydi. 3 zaif joy tuzatildi: (1) `LocationDisplay` eski string ko'rinishdagi manzilni ham ko'rsatadi (avval `-` chiqarardi); (2) `normalizeLocationData` yaroqsiz koordinatada `{lat:NaN}` obyekt o'rniga `coordinates:null` qaytaradi; (3) `findOrCreateClient` bir xil NOMLI manzilga yangi pin kelsa dublikat qator ochmaydi — mavjud yozuvni coords/mapUrl bilan boyitadi (yangi pin ustuvor). Ishlatilmay qolgan `sameLocation` o'chirildi.
- **Davomi tekshiruvi:** real Atlas Mongo smoke-test (alohida `musoryoq_loc_test` db, keyin tozalandi) 13/13 — pin precision, dublikatsiz boyitish, service→client ko'chish, object-edit coords saqlaydi / matn-edit tozalaydi, manual mapUrl. Brauzer (Vite preview) render testi 5/5 — pin link, manual link, string manzil, null coords, `javascript:` URL rad etiladi. `node --check` + `vite build` OK.

## 2026-07-02 Sana/vaqt ko'rsatish bugfix
- **Maqsad:** Mini App, bot va reportlarda sana faqat kun sifatida yoki raqamli oy bilan chiqmasin; `serviceDateTime` va `createdAt` alohida ko'rinsin; uz/ru oy nomlari ishlatilsin.
- **Tegilgan joylar:** frontend central formatter (`miniapp/src/utils/format.js`), Home/Clients/Services/Finance/Categories/Items/Reminders/Settings, shared `ServiceDetailModal`, i18n `common.createdAt`; backend `utils/dates.js`, bot UI/callbacklar, AI service summaries, PDF/Excel reports.
- **Natija:** xizmat tarixlari/listlari va AI search natijalari `serviceDateTime`ni soati bilan ko'rsatadi; service detailda `Kiritilgan` (`createdAt`) alohida chiqadi; report oylari `YYYY-MM`/numeric emas, oy nomlari bilan chiqadi.
- **Tekshiruv:** backend `node --check` barcha `backend/src/**/*.js`; Mini App `npm run build`; `git diff --check` - hammasi OK.
- **Davomi (qoldiq joylar tuzatildi):** qarz eslatma xulosalari (`ui.savedFieldLines` DEBT_REMINDER, `agent.debtReminderSummary`) endi dueDate'ni soat bilan ko'rsatadi; `deleteService` bekor/o'chirish izohlari ISO (`2026-07-02`) o'rniga `formatDateTime`; yangi kategoriya bildirishnomasi va balans hisobotidagi eng katta/kichik xarajat sanalari soat bilan; Mini App Buyumlar kartasi/tafsiloti va Kategoriyalar material yozuvlari `formatDateTime`ga o'tdi. Ishlatilmay qolgan `formatBotDate` (ui.js) va `reportDate` (pdf.js) o'chirildi.
- **Davomi tekshiruvi:** `node --check` tahrirlangan 7 backend fayl OK; Mini App `vite build` OK; Vite preview'da `formatDateTime` brauzerda uz `4-iyul 2026, soat 11:00` / ru `4 июля 2026, 11:00` qaytardi, sahifalar konsol xatosiz ochildi; `serviceDateTime` saqlanishi audit qilindi — `parseRequiredDate` to'liq `Date` saqlaydi, soat yo'qolmaydi.

## 2026-07-02 Darhol saqlash + ixtiyoriy maydonlar (tasdiqlash bosqichi olib tashlandi)
- **Maqsad (foydalanuvchi):** "Ha, to'g'ri / Yo'q" tasdig'i olib tashlansin — ma'lumot yig'ilgach DARHOL saqlansin; keyin [✏️ Tahrirlash][❌ Bekor qilish][📱 Ilovaga o'tish] tugmalari. Maydonlar ixtiyoriy: "boshqa narsa so'rama" desa qolganlari bo'sh qoldirilib saqlanadi (kamida bitta identifikatsiya sharti bilan); narx keyin kiritilsa balans o'sha payt qo'shiladi. Balansga yozilmaslik bug'i sababi topilsin.
- **Oqim (agent.js):** `finalizeEntry` → `executeToolFlow` (DARHOL yozadi) → `ENTRY_SAVED` holati + `ui.savedSummaryText`/`savedEntryKeyboard`. `startEntry`/`continueEntry` da stop-signal (`flow.detectStopSignal` + Gemini `stopAsking`); identifikatsiya yetmasa `askMinimumIdentity`. Tahrir: `editSavedEntry`→`applySavedEntryUpdate` (joyida, yangi yozuv yo'q); Bekor: `cancelSavedEntry`→`undoSavedEntry` (kodsiz soft-delete/revert). `classifyPostSaveMessage` — post-save xabar tahrirmi/yangi buyruqmi.
- **Service qatlami:** createService (ism YOKI tel kifoya; manzil/sana/narx optional; telefonsiz → mijozsiz, keyin bog'lanadi), completeService (price 0 → income yozilmaydi), editService (price 0→X DONE'da ensureServiceIncome; telefon kelsa client link), createTransaction (amount 0 OK), updateTransaction (+materialName/quantityKg/pricePerKg), softDeleteTransaction, sellUsefulItem (summasiz), updateUsefulItem/updateItemSale/revertItemSale/revertItemGiveaway/softDeleteUsefulItem, createDebtReminder (dueDate/amount optional), updateDebtReminder (balans tx sinxron: yaratish/yangilash/bekor), deleteService.softDeleteServiceCascade (kodsiz eksport).
- **Bot qatlami:** ui.js savedSummaryText (faqat aytilgan maydonlar + "❕Aytilmagan:" ro'yxati; stopped→"Tushunarli oka..."), savedEntryKeyboard (webApp `?tab=` deep-link); answers.interpretSavedReply (cancel/edit/ack); callbacks saved_edit/saved_cancel (+eski entry_* "eskirgan"); message.js routeSavedEntry/routeSavedEdit, universal "bekor" ENTRY_SAVED'da yozuvni o'chiradi; sendAgentResult endi keyboard'ni ustuvor yuboradi. Mini App App.jsx `?tab=` bilan ochiladi.
- **BUG (aniqlangan sabab):** eski ENTRY_CONFIRM bosqichida yozuv DB'ga yozilmay kutilardi; "bo'ldi" kabi javob interpretEntryConfirm'da YO'Q edi va har qanday tanilmagan matn tahrir-loop'ga tushib xulosa qayta ko'rsatilaverardi — saqlash hech qachon bo'lmasdi → summa balans/Mini App'da ko'rinmasdi. Darhol-saqlash bilan bosqich yo'q qilindi; integratsiya testi buni isbotladi.
- **Tekshiruv:** node --check 15 fayl OK; import graph OK; sof mantiq 58/58; REAL Mongo integratsiya (alohida `musoryoq_flow_test` db, keyin tozalandi) 35/35 — T1 xarajat darhol DB+balans, T2 material kirim (soft-ask saqlangan), T3 "boshqa so'rama"→bo'sh maydonlar bilan saqlash, T4 tahrir joyida (yozuv soni o'zgarmadi), T5 bekor soft-delete, T6 qarz balans + bekorda tiklash, T7 narxsiz tarixiy xizmat→narx kiritilganda daromad, T8 summasiz xarajat→keyin summa, T9 summasiz buyum sotuvi. Mini App build OK.

- **Yakuniy self-check (2026-07-02):** post-save tahrir mappingi intentga moslandi (`narx/summa` -> service `price`, tx/item-sale/debt `amount`, item-entry `estimatedPrice`; `izoh` -> `notes` yoki `description`/`note`; sana edit parse qilinadi). Giveaway `closedAt` ham tahrirlanadi. Hozirgi tekshiruv: backend `node --check` 69 fayl OK; o'zgargan backend import graph OK; flow logic self-check OK; `git diff --check` OK; `npm run build` OK; runtime grepda eski `ENTRY_CONFIRM` funksiyalari yo'q.

## 2026-06-30 Qarz eslatma funksiyasi (DEBT_REMINDER) + Mini App "Eslatmalar"
- **Maqsad (foydalanuvchi):** egasi "Sardorga 100 ming qarz berdim, 30 iyunda olaman" desa — 100 ming balansdan avtomatik ayirilsin, egaga xabar (balans -100, 30 iyun kuni eslataman), 30 iyun kuni eslatma kelsin. "...lekin balansdan minus qilma" desa — balansga tegmasin, lekin eslatma baribir yuborilsin. Mini App'da ham qulay, xalaqit bermaydigan eslatma bo'limi.
- **YANGI fayllar:** `models/Reminder.js` (tenant+soft-delete: type/direction/person/amount/affectsBalance/transactionId/eventDate/dueDate/remindAt/remindSent/status), `services/reminderEntryService.js` (createDebtReminder/list/getById/markDone/cancel/snooze/delete + balans tx mexanikasi), `routes/reminders.js`, `miniapp/src/pages/Reminders.jsx`.
- **Balans mexanikasi (eng muhim):** affectsBalance=true → alohida `Transaction` (given=chiqim 'qarz', taken=kirim 'qarz', category enum'ga qo'shildi) → `getSummary` darhol balansni o'zgartiradi. Hal bo'ldi/bekor/o'chirishda o'sha tranzaksiya SOFT-DELETE → balans tiklanadi. `Reminder` qarz tarixini saqlab qoladi. skipBalance=true (yoki Mini App toggle off) → tranzaksiya yaratilmaydi.
- **AI integratsiya:** `intents.js` DEBT_REMINDER (MOLIYA); `prompts.js` ta'rif+3 misol (given/skipBalance/taken) + DATA EXTRACTION CONTRACT + INCOME_ENTRY'dan farq ("qarz qaytdi"=kirim, kelajak sanasiz); `flow.js` ENTRY_REQUIRED(person/amount/dueDate)+QUESTIONS+hasValue(dueDate)+applyRawValue(dueDate)+mergeFields(person/dueDate/eventDate); `agent.js` to'liq wiring (AMOUNT_KEY, WRITE_ACTIONS, hasConcreteSignal, TOOL_BY_INTENT→create_debt_reminder, startEntry switch, applyEntryDefaults, executeAgentTool, fallbackToolCall, fallbackResponse→debtReminderSummary). `skipBalance` boolean true mergeFields'da saqlanadi (false tashlanadi — shu sabab "skip" bayrog'i, "affects" emas).
- **Bot/cron:** `ui.js` entrySummaryText(DEBT_REMINDER) tasdiq kartasi + `debtReminderDueText`/`debtReminderKeyboard`; `cron/reminders.js` `fireDebtReminders` (atomar claim, at-most-once); `callbacks.js` `debt_done_*`/`debt_snooze_*`. Bot callbacklar `runWithUser` ichida — tenant scope to'g'ri.
- **Mini App:** `BottomNav` 7-tab `🔔 Eslatmalar`; `App.jsx` render; `Reminders.jsx` (segment faol/hal/barchasi, summary, qo'shish modal: yo'nalish/kim/summa/sana/balans toggle/izoh, Hal bo'ldi, delete kodli); i18n uz+ru.
- **Tekshiruv:** `node --check` 12 fayl OK; import graph OK (barcha eksportlar); sof-mantiq testlari PASS (parseMoney "100 ming"→100000, nextMissing null/person, skipBalance saqlanadi, applyRawValue("ertaga") valid, summary affects/skip, dueText given/taken); Mini App `npm run build` OK. Push qilindi.
- **Edit-loop:** person/dueDate ENTRY_FIELD_KEYS'ga qo'shilgan (tahrirda saqlanadi).
- **2-bosqich self-check (deep audit) + tuzatish:** (1) `dates.js parseUzbekDate` qo'shildi — slot-fill javobida "30 iyun"/"30-iyunda"/"5-may"/"30 июня" deterministik parse bo'ladi (o'zbek+rus oy nomlari; o'tgan KUN→kelasi yil; aniq soat bo'lmasa 09:00). FAQAT qarz dueDate oqimida (xizmat correctServiceDateTime/reschedule TEGMAYDI — regress yo'q). (2) BUG tuzatildi: `applyRawValue('dueDate')`/mergeFields'da parseUzbekDate AVVAL sinaladi — chunki `parseHumanDateTime` ning yumshoq `new Date("5-may")` si V8'da 2001-yilga aylantirib yuborardi; endi qat'iy oy parseri birinchi. Bonus: `answersCurrentField('dueDate')` endi to'g'ri ishlaydi → slot-fill javobida noto'g'ri intent-pivot bo'lmaydi. (3) Tasdiqlandi: cron `runGlobal` tenant filtrini o'chiradi (qarz eslatmasi barcha egalarga yetadi, fail-closed emas); `env.js process.env.TZ=Asia/Tashkent` (computeRemindAt getHours to'g'ri); markDone idempotent (status!==done guard); balans soft-delete→`getSummary` notDeleted bilan tiklanadi. (4) Tekshiruv: 11/11 sof-mantiq + 9 date-parse testi PASS; node --check 9 fayl OK; Mini App build OK. Push qilindi.

## 2026-06-28 Sotuv-klassifikatsiya tuzatuvchisi mustahkamlandi (lotin/kirill/rus + chegaralar)
- **Sabab:** foydalanuvchi yana o'sha skrinshotni yubordi (muzlatgich sotdim → Oziq-ovqat). Tuzatish allaqachon `correctSaleClassification`da bor (commit 0994eb2) — skrinshot deploy'dan oldingi. Lekin "yanada xatosiz" uchun tuzatuvchi kengaytirildi.
- **gemini.correctSaleClassification (qayta yozildi, mustahkamroq):** (1) buyum/material noun ro'yxati LOTIN + KIRILL-o'zbek (музлатгич, телевизор, пахта, темир...) + RUS (холодильник, телевизор) + imlo variantlari (x/h, l/r: xaladelnik/halodelnik); (2) sotuv fe'llari lotin+kirill (сотдим/сотилди) + rus (продал); xarid (сотиб олдим/купил) ALMASHTIRILMAYDI; (3) noto'g'ri sotuv TURINI ham tuzatadi (Gemini ITEM_SALE deganini "tekinga" bo'lsa ITEM_GIVEAWAY ga, aksincha); (4) SAVOL (`?`/qachon/qancha...) va SERVICE/PAYMENT/SEARCH/ANALYTICS niyatlariga TEGMAYDI (savol-sotuvni yozuvga aylantirmaydi); (5) eski xato `category` (oziq-ovqat) tozalanadi.
- **TRANSCRIBE_PROMPT:** transkripsiyaga domen maslahati — material/buyum nomlari va sotuv fe'llarini aynan yozsin, maishiy texnikani oziq-ovqat so'ziga "to'g'rilamasin".
- **Tekshiruv:** correctSaleClassification 23/23 (lotin/kirill/rus sotuv→to'g'ri; sotib oldim/yoqilg'i/savol/xizmat/to'lov tegilmaydi); import graph OK; Mini App build OK. Push qilindi. (Kategoriyalar restrukturizatsiyasi 0994eb2'da allaqachon — Railway deploy'dan keyin ko'rinadi.)

## 2026-06-28 BARCHA daromad turlari — o'tgan sana bo'yicha kiritish (tarixiy yozuv)
- **Maqsad:** "20 iyunda televizorni 3 mln sotdim" / "kecha 30 kg paxta sotdim" / "o'tgan hafta musor olib chiqdim 200 ming oldim" kabi O'TGAN voqealar — voqea YUZ BERGAN sanaga yozilsin (bugungi sana emas), pul darhol balansga, eslatma yo'q, va oylik hisobot voqea oyiga hisoblasin. Xizmat, material, buyum, qo'lda kirim — hammasida izchil.
- **Prompt (gemini):** NORMALIZATION'ga global "EVENT DATE" qoidasi — o'tgan zamon yoki o'tgan sana bo'lsa, SERVICE_ENTRY → serviceDateTime + isHistorical; MATERIAL_SALE/ITEM_*/INCOME/EXPENSE → `date` (ISO). "o'tgan hafta"≈7 kun oldin, "20 iyunda"→shu yil o'sha sana qo'shildi. 4 yangi misol (kecha/20 iyun/o'tgan hafta).
- **KODdagi asosiy tuzatish (serviceService.completeService):** TARIXIY xizmat daromad tranzaksiyasi endi `serviceDateTime`ga (voqea sanasi) yoziladi, AVVAL bugungi (`new Date()`) edi → oylik hisobot noto'g'ri oyga tushardi. `completionDateFor(service)` helper: historical→serviceDateTime, aks holda hozir; `completedAt` va income `date` shunga teng. Oddiy (kelajak) xizmat o'zgarmaydi (hozir).
- **Material/item/income plumbing:** Gemini ajratgan `date` butun oqimda saqlanadi (normalizeExtractedFields → collected → fallbackToolCall → createTransaction/sellUsefulItem). applyEntryDefaults faqat date YO'Q bo'lsa bugunni qo'yadi. `usefulItemService.sellUsefulItem`: sotilgan buyum `closedAt` ham voqea sanasiga. Mini App qo'lda kiritishlarga sana maydoni qo'shildi (AddMaterialSaleModal, item SellModal — /finance/transactions va /items/:id/sold date'ni uzatadi).
- **Eslatma/tasdiq:** tarixiy xizmatda schedule maydonlari "sent" (eslatma/cron yo'q — avvaldan); material/item/income umuman reminder yaratmaydi.
- **Tekshiruv:** node --check + route graph OK; date testlari (extraction 4/4 event-date saqlaydi; agent confirm payload event-date; **historical service income Jun20ga, bugunga emas**; oddiy xizmat ~hozir) PASS; Mini App build OK. Push qilindi.

## 2026-06-28 Kategoriyalar restrukturizatsiya + sotuv→xarajat xato tuzatildi + material ovozi
- **Kritik bug (skrinshot):** ovozda "eski muzlatgich/haladelnik bor edi, Sardorga 1 800 mingga sotdim" → bot uni Oziq-ovqat XARAJAT deb tushunardi. **Tuzatish:** (1) prompt — SOTISH hech qachon xarajat emas, maishiy texnika (muzlatgich/televizor...) buyum, oziq-ovqat emas; skrinshot misoli qo'shildi. (2) Deterministik xavfsizlik to'ri `gemini.correctSaleClassification(understanding, text)` — matnda sotish/berib-yuborish fe'li + tanilgan tovar bo'lsa EXPENSE/INCOME/ITEM_ENTRY → MATERIAL_SALE/ITEM_SALE/ITEM_GIVEAWAY ga to'g'rilaydi ("sotib oldim"=xarid — tegmaydi). classifyIntent oxirida qo'llanadi.
- **Material ovozi:** Transaction'ga `voice{telegramFileId,...}` + `sourceText`; attachEntrySource MATERIAL_SALE'ga ham; createTransaction ovoz/sana saqlaydi + `ensureMaterialCategory` (yangi bo'lsa bot xabar beradi). Mini App'da material yozuvida ovoz qayta eshitiladi (/items/audio/:fileId).
- **Kategoriya modeli + bot xabar:** `models/MaterialCategory.js` (default bo'lmagan kategoriyalar saqlanadi), `services/categoryService.js` (listKnownMaterialNames, ensureMaterialCategory+notifyOwner, getCategoryOverview, getMaterialCategoryRecords), `routes/categories.js` (GET / POST /, GET /material/:name/records). Yangi kategoriya (bot sotuvda yoki Mini App qo'lda) → "🆕 Yangi kategoriya yaratildi: ... sana ✅".
- **Mini App:** "Buyumlar" tab → "Kategoriyalar" (id 'categories', 🗂️). Yangi `pages/Categories.jsx`: material kategoriyalari (statistika) + "Kerakli buyumlar" bo'limi; material kategoriyasiga kirilganda yozuvlar (sana/kg/narx/jami + balans bayrog'i + asl ovoz + matn); kategoriya yaratish; qo'lda material sotuv qo'shish. "Kerakli buyumlar" → mavjud Items (onBack bilan). i18n uz+ru (nav.categories, categories.*).
- **Tekshiruv:** correctSaleClassification 9/9 (fridge/material/giveaway tuzatadi; sotib oldim/yoqilg'i/xizmat tegmaydi); categoryService (ovoz, balans, overview merge) PASS; Mini App build OK.

## 2026-06-27 Yangi funksiyalarni AI tizimiga to'liq integratsiya (audit + qotirish)
- **Maqsad:** material sotish + kerakli buyumlar mavjud AI niyat tizimiga (MOLIYA/MIJOZ/SUXBAT) tabiiy, uzilishsiz qo'shilgani — matn/ovoz javob (tugmasiz), "oka" ohang, saqlashdan oldingi tasdiq (Ha/Yo'q tahrirlash/Bekor) — barchasi izchil ishlashini ta'minlash.
- **Audit natijasi:** integratsiya avvalgi goallarda asosan qilingan va PUXTA — ITEM_ENTRY/ITEM_SALE/ITEM_GIVEAWAY/MATERIAL_SALE hammasi MOLIYA subIntent (intents.js), bir xil entry oqimi (startEntry→finalizeEntry→ENTRY_CONFIRM 3-tugma), bir xil matn/ovoz routing (routeEntryConfirmation/continueEntry/ITEM_MATCH_CONFIRM — hammasi intent-agnostik), bir xil "oka" tasdiq matnlari. Alohida/uzilgan tizim YO'Q.
- **Qotirish (yangi):** (1) prompts.js STEP 1 MOLIYA ta'rifiga material/buyum SOTUVI va buyum qo'shish aniq kiritildi ("All money/sale/inventory actions belong here ... not a separate world") — yuqori darajada ishonchli MOLIYA routing. (2) commands.js HELP_TEXT'ga material/buyum imkoniyatlari + 3 misol qo'shildi (discoverability). (3) agent.js "Tushunmadim" fallback hint'iga material/buyum qo'shildi.
- **Tegilgan:** `ai/prompts.js`, `bot/handlers/commands.js`, `ai/agent.js` (faqat matn/hint — mantiq o'zgarmadi, allaqachon to'g'ri edi).
- **Tekshiruv (integratsiya isboti):** `node --check` + full import graph OK; **integratsiya testlari**: 4 yangi subIntent ENTRY_CONFIRM + tugma (Ha/Yo'q/Bekor); tahrir loop (material summa 350k, item oluvchi Akmal); **mid-entry pivot** (SERVICE→material/item, EXPENSE→item-entry — maybeCorrectIntent); material soft-ask pivotdan keyin ham ishlaydi (javob→confirm, rad→confirm nag yo'q); ITEM_ENTRY ovoz fileId confirm payloadda saqlanadi. Hammasi PASS. Push qilindi.

## 2026-06-27 Hisobot — qo'shimcha chuqur tahlil (Insights)
- **Maqsad:** hisobotga foydalanuvchi so'ramagan, lekin qiymatli biznes ko'rsatkichlari (tanlangan davr ichida) — eng daromadli material/buyum, eng ko'p to'lagan mijoz, eng band oy, + qo'shimcha (o'rtacha xizmat narxi, eng faol kun, eng daromadli oy). Sodda, emoji bilan, uz/ru.
- **Service (YANGI `services/reportInsightsService.js`):** `getReportInsights({from,to})` — parallel agg: `topMaterial`/`topItem` (income category material/buyum, group by materialName/itemName, top-1), `topClient` (xizmat income $lookup services → clientId, top-1), `bestIncomeMonth` (income by month, max), `avgServicePrice` (xizmat income total/count), `busiestMonth` (Service.serviceDateTime by month, max orders), `mostActiveWeekday` ($dayOfWeek, max). Xom data — til/format render qatlamida.
- **reports.js:** `INSIGHT_LABELS` (uz/ru) + `WEEKDAYS` (uz/ru, $dayOfWeek 1=yakshanba) + `formatInsights(insights,language)` → `[{emoji,label,value}]` (faqat mavjudlari) + `makeInsightsRows` (Excel) + `buildInsightLines`. `buildReportData` → `data.insights` (finance/full). Excel: yangi "Tahlil"/"Анализ" varag'i (emoji bilan). Eksportlar qo'shildi.
- **pdf.js:** `drawInsights` — rangli marker + qalin label + qiymat (EMOJI YO'Q: PDF Helvetica emoji'ni chizolmaydi — Excel'da emoji bor, PDF toza tipografik). Source-analysis'dan keyin. LABELS.insights uz/ru.
- **Til:** Mini App `/reports/send language` (oldingi ishdan). 7 ko'rsatkich ham uz, ham ru.
- **Tegilgan:** YANGI `services/reportInsightsService.js`; o'zg. `routes/reports.js`, `utils/pdf.js`.
- **Tekshiruv:** `node --check` 3 fayl OK; insights agg 7/7 (stub: top material/item/client, busiest/best month, avg 200k, active weekday); formatInsights uz/ru 7 qator + emoji + qiymatlar (Seshanba/Вторник); Excel qatorlar emoji bilan; **HAQIQIY PDF render** (insights bilan → valid %PDF 2921 bayt). Push qilindi.

## 2026-06-27 Hisobot (PDF/Excel) — daromad manbasi bo'yicha oylik foiz tahlili
- **Maqsad:** mavjud PDF/Excel hisobotga YANGI bo'lim (eski ma'lumotlar joyida) — har oy uchun: nechta xizmat, jami kirim, va kirimning necha foizi xizmatdan / necha foizi material+buyum sotuvidan (son+foiz). Grafik + matn birga; sarlavhada aniq sana oralig'i; til (uz/ru).
- **Agg (asos kengaytirildi):** `incomeSourceService.getMonthlyIncomeBreakdown({from,to})` — income tx'larni {yil,oy,category} bo'yicha guruhlaydi → har oy: `servicesCount` (xizmat-income soni), `totalIncome`, `sources[{key,total,count,pct}]`, `servicePct`, `salesTotal/salesPct` (material+buyum), `otherTotal/otherPct`. Noma'lum kategoriya 'other'ga (forward-compatible). Til YO'Q — render qatlami localize qiladi.
- **reports.js:** `MONTH_NAMES`/`MONTH_GENITIVE` (uz+ru) + `buildPeriodTitle(range,language)` ("1-maydan 30-maygacha bo'lgan hisobot (2026)" / "Отчёт с 1 мая по 30 мая 2026"; all→"Umumiy"; cross-year→ikkala yil) + `monthLabel` + `buildMonthlyIncomeRows` (oy nomini biriktiradi). `buildReportData`: `periodLabel`=buildPeriodTitle (PDF header'da "Davr:"), `monthlyIncomeBySource` qo'shildi (faqat finance/full). Excel: yangi "Manba tahlili"/"Источники" varag'i (`makeSourceAnalysisRows` + `unicodeBar` "██████░░░░ 60%"). Yangi yordamchilar EXPORT qilindi (keyingi hisobot promptlari uchun).
- **pdf.js:** `SOURCE_COLORS` (xizmat=yashil/material=ko'k/buyum=sariq/boshqa=kulrang) + `drawSourceAnalysis` (har oy: stacked-bar foiz diagrammasi + "N xizmat · Jami: X" + "Xizmat: A (P%) · Material/Buyum sotuvi: B (Q%) · Boshqa: C (R%)") + `drawSourceLegend`. Summary'dan keyin, jadvallardan oldin (yuqorida). LABELS uz+ru.
- **Til:** Mini App `/reports/send` allaqachon `language: lang` yuboradi (Finance.jsx:193) — butun hisobot shu tilda. Bot pdf callback 'uz'. Mini App o'zgartirilmadi (server-side hisobot).
- **Tegilgan:** `services/incomeSourceService.js` (+getMonthlyIncomeBreakdown), `routes/reports.js`, `utils/pdf.js`.
- **Tekshiruv:** `node --check` 3 fayl OK; agg 8/8 (oylik son/total/servicePct/salesPct, future→other folding); titlelar uz/ru/all/cross-year aniq; unicodeBar 3/3; Excel qatorlar; **HAQIQIY PDF render** (mock data, createReportDoc → valid %PDF 3095 bayt, drawSourceAnalysis xatosiz); reports route import OK. Jonli DB + Telegram fayl yuborish foydalanuvchida.

## 2026-06-27 Daromad manbalarini ajratish (4 manba taksonomiyasi) + Moliya sahifasi kengaytirildi
- **Asos (keyingi 2 hisobot prompti uchun):** har kirim tranzaksiyasi qaysi manbadan kelganini `category` orqali ALLAQACHON saqlaydi (`xizmat`/`material`/`buyum`/`boshqa_kirim` — service income `serviceService.js:166,239` da `category:'xizmat'`). Buni rasmiylashtirish uchun YANGI yagona modul `services/incomeSourceService.js`: `INCOME_SOURCES` (key↔category↔label↔emoji↔hasQuantity), `incomeSourceKey(category)` (noma'lum→'other'), `incomeSourceMeta(key)`, `getIncomeBySource(period)` (manba bo'yicha total+count agg; ro'yxatda yo'q kategoriyalar 'other'ga yig'iladi — forward-compatible). Kelajakda yangi manba = Transaction enum'iga income kategoriya + INCOME_SOURCES'ga 1 qator (boshqa joy o'zgarmaydi).
- **API:** `GET /api/finance/income-sources?period=` → `{ period, totalIncome, sources:[{key,category,label,emoji,hasQuantity,total,count}] }`.
- **Moliya sahifasi (Finance.jsx):** 3 yangi kartochka tartibda — `IncomeSourcesCard` (📊 Daromad manbalari: har manba emoji+nom+soni+jami, faqat summasi bor manbalar), mavjud `MaterialsCard` (♻️ material kategoriyalar: nom+kg+jami — material goal'dan), `StockItemsCard` (📦 Kerakli buyumlar: nechta saqlanmoqda + nomlari, `GET /items?status=available`). load() endi 6 parallel chaqiruv.
- **i18n (uz+ru ikkalasi):** `finance.incomeSources`, `finance.itemsInStock`, `finance.sources.{service,material,item,other}`.
- **Tegilgan:** YANGI `services/incomeSourceService.js`; o'zg. `routes/finance.js`, `pages/Finance.jsx`, `i18n/uz.js`, `i18n/ru.js`.
- **Tekshiruv:** `node --check` OK; taksonomiya 10/10 (har category→source + null/noma'lum→other); `getIncomeBySource` agg mapping (stub) — service/material/item to'g'ri, noma'lum kategoriya 'other'ga yig'iladi, totalIncome to'g'ri; i18n ikkala tilda resolve; Mini App `npm run build` OK. Jonli DB sinovi foydalanuvchida.

## 2026-06-27 Kerakli buyumlar — audit + ruscha i18n to'ldirildi
- Funksiya (commit 4df84b9) spec bo'yicha to'liq tekshirildi: model/service/route/agent/bot/Mini App hammasi mavjud va spec'ning 5 bandiga mos (qo'shish+ovoz biriktirish, sotuv+balans+ro'yxatdan chiqarish, tekinga berish, ro'yxatda yo'q sotuvga ogohlantirish, Mini App o'chirish+qo'lda sotildi). Asosiy oqimlarda xato topilmadi.
- **YAGONA KAMCHILIK (tuzatildi):** commit faqat `i18n/uz.js` ni yangilagan, `ru.js` da `nav.items`, butun `items` bloki va `category.buyum` YO'Q edi — rus tilida xom kalitlar (`items.title` h.k.) ko'rinardi. `miniapp/src/i18n/ru.js` ga qo'shildi (Полезные вещи / Продано / Отдано / Предмет ...). Desktop `SidebarNav` `NAV_TABS`ni baham ko'radi — items tab avtomatik bor.
- Tekshiruv: `node --check` 11 backend fayl + uz/ru OK; sinonim moslik 10/10 (muzlatgich↔haladelnik↔холодильник, suffiks "televizorni"→Televizor, yangi buyum saqlanadi); agent end-to-end 4/4 (ITEM_ENTRY ovoz fileId biriktirildi, ITEM_SALE/ITEM_GIVEAWAY confirm xulosa, query-mode bot'ga yo'naltirish); Mini App `npm run build` OK (56 modul); i18n kalitlari ikkala tilda resolve. Jonli Telegram/DB sinovi foydalanuvchida.

## 2026-06-27 YANGI FUNKSIYA: Kerakli buyumlar
- Prompt talabi bajarildi: materiallardan alohida dona inventar. Yangi model `UsefulItem` (tenant-scoped, soft-delete) + `services/usefulItemService.js` + `routes/items.js`.
- AI subIntentlar: `ITEM_ENTRY` ("menda yangi muzlatgich bor"), `ITEM_SALE` ("televizorni Sardorga 1 mln ga sotdim"), `ITEM_GIVEAWAY` ("divanni opamga tekinga berdim"). `flow.js` qo'shishda narx so'ramaydi; faqat nom majburiy. `ui.entrySummaryText` yakuniy tasdiq matnlari qo'shildi.
- Voice support: `message.js` voice/audio transkripsiyani `sourceMeta` bilan `runAgent`ga uzatadi; `ITEM_ENTRY` `sourceText` va `voice.telegramFileId/mime/duration/messageId`ni buyumga biriktiradi. Mini App detail audio URL `initData` query bilan ochiladi; kamida transcript har doim ko'rinadi.
- Smart matching: alias/fuzzy normalizer (`haladelnik/xolodilnik/holodilnik` -> `Muzlatgich`, `tv/telik` -> `Televizor`, `stiralka` -> `Kir yuvish mashinasi`). Ambiguous match bo'lsa `ITEM_MATCH_CONFIRM` conversation state: bot nomzodlarni raqam bilan so'raydi; foydalanuvchi raqam/nom/ha/yo'q bilan javob beradi.
- Finance: `Transaction` `category='buyum'`, `itemName/usefulItemId`. Sotuv income yaratadi va mavjud buyumni `sold` qiladi; ro'yxatda yo'q bo'lsa ham income yoziladi + ogohlantirish. Tekinga berish `given_away`, balansga pul yozmaydi.
- Mini App: `pages/Items.jsx`, `App.jsx`, `BottomNav.jsx`, `i18n/uz.js`. Bo'lim: list/search, add, detail, manual sold+amount, give away, delete (confirm code).
- Self-check: `Get-ChildItem backend/src/**/*.js | node --check` OK; `npm run build` OK; item logic smoke OK; import graph OK; `git diff --check` OK.

## 2026-06-27 Railway log audit - npm warning + clean deploy start
- Railway pasted log tahlili: container crash yo'q. `[err] npm warn config production Use --omit=dev instead` npm'ning deprecated config warning'i; Railway stderr sabab `err` deb belgilagan. App keyin `Server ishlayapti`, `MongoDB ulandi`, webhook/cron va `Backend tayyor`gacha yetgan.
- Fix: `railway.json` qo'shildi (`buildCommand=npm run build`, `deploy.startCommand=node backend/src/index.js`, `/health` healthcheck, ON_FAILURE restart). Bu runtime'da npm wrapper'ini chetlab o'tadi.
- Qo'shimcha cleanup: runtime console loglaridagi em dash ASCII `-` ga almashtirildi (`db/migrateTenancy.js`, `db/connect.js`, `services/exchangeRateService.js`) va haqiqiy mojibake comment qoldiqlari tozalandi. `backend/.env.example` `smash :)`dan to'liq normal env namunasiga qaytarildi.
- Self-check: `railway.json` JSON parse OK; backend JS `node --check` OK; material flow smoke OK; `npm run build` OK; `git diff --check` OK (CRLF warninglar xato emas).

## 2026-06-27 YANGI FUNKSIYA: Material sotish (paxta/temir/plastik...) — kirim tizimiga integratsiya
- **Maqsad:** musordan chiqqan materiallar sotuvi yangi daromad manbai. "30 kg paxtani 300 mingga sotdim" → income Transaction (category='material'), balansga darhol qo'shiladi, oylik hisobot + kategoriya statistikasiga to'liq kiradi.
- **Niyat (`ai/intents.js`):** MOLIYA ostida 4-subIntent `MATERIAL_SALE` (SUB_INTENTS, SUB_TO_HIGH, HIGH_TO_SUBS). `gemini.js` classify schema'ga `materialName/quantityKg/pricePerKg` maydonlari; `normalizeExtractedFields('MATERIAL_SALE',...)`. `prompts.js`: MATERIAL_SALE ma'nosi + 10 asosiy kategoriya ro'yxati + 3 misol (paxta total, mis per-kg, "chyorniy taxta" yangi kategoriya).
- **Model (`models/Transaction.js`):** `TX_CATEGORIES` ga `'material'` (+`INCOME_CATEGORIES`, `MATERIAL_CATEGORY` eksport); yangi maydonlar `materialName`(String), `quantityKg`(Number), `pricePerKg`(Number) — faqat material sotuvida to'ladi.
- **Service (`services/materialService.js` — YANGI):** `DEFAULT_MATERIALS` (10), `materialKey` (taqqoslash kaliti), `resolveMaterialName` (kanonik nom: asosiy ro'yxat morfologik mos "paxtani"→"Paxta" → avval ishlatilgan nom → yangi kategoriya), `listKnownMaterials`/`listUsedMaterialNames` (`Transaction.distinct`, tenant-scoped), `buildMaterialDescription` ("Paxta · 30 kg"), `formatKg`, `getMaterialStats(period)` (materialName bo'yicha jami/kg/soni agg).
- **Slot-filling (`bot/flow.js`):** `ENTRY_REQUIRED.MATERIAL_SALE=['materialName','amount']`; QUESTIONS materialName/pricePerKg; hasValue/mergeFields/applyRawValue ga quantityKg/pricePerKg (parseMoney) + materialName (trim). YANGI `nextSoftAsk(intent,collected)` — material'da miqdor+summa bor, kilo narxi yo'q bo'lsa 'pricePerKg' (ixtiyoriy).
- **Agent (`ai/agent.js`):** MATERIAL_SALE → startEntry (entry intent); `AMOUNT_KEY/TOOL_BY_INTENT/WRITE_ACTIONS/hasConcreteSignal/ENTRY_FIELD_KEYS/EDIT_FIELD_TO_ENTRY/defaultClarifyOptions` kengaytirildi. `applyEntryDefaults`: umumiy summa yo'q bo'lsa miqdor*kilo narxidan hisoblaydi (foydalanuvchi aytgan summa USTUN). `maybeAskSoft` (start+continue) — kilo narxini bir marta yumshoq so'raydi (`_softAsked`). **MUHIM:** soft-ask javobi `continueEntry` BOSHIDA (pivot/correct'dan OLDIN) qisqa-tutashtiriladi — raqam bo'lsa pricePerKg yoziladi, bo'lmasa (rad) darhol finalize (qistab so'rash YO'Q, spec talabi). `fallbackToolCall`/`createAgentTransaction` material → create_transaction (type=income, category='material', material maydonlari). `fallbackResponse`: "Bo'ldi oka, 30 kg Paxta — 300 000 so'mga sotilgani yozildi ✅".
- **financeService.createTransaction:** `normalizeCategory` income'da 'material' qo'llab-quvvatlaydi; material bo'lsa `resolveMaterialName` (kanonik), quantityKg/pricePerKg saqlash, izoh `buildMaterialDescription` bilan quriladi.
- **UI/hisobot/i18n/Mini App:** `ui.entrySummaryText` MATERIAL_SALE xulosasi (♻️ qty material — summa, 1 kg narxi, To'g'rimi?); `reports.js` PDF kategoriya ustunida materialName; i18n `category.material` (uz/ru) + `finance.materials`; `routes/finance.js` `GET /materials` + `/materials/categories`; `Finance.jsx` "♻️ Material sotuvi" kartochkasi (`MaterialsCard`, /finance/materials?period=).
- **Tegilgan fayllar:** YANGI `services/materialService.js`; o'zg. `models/Transaction.js`, `ai/{intents,prompts,gemini,agent}.js`, `bot/{flow,ui}.js`, `services/financeService.js`, `routes/{finance,reports}.js`, `miniapp/src/i18n/{uz,ru}.js`, `miniapp/src/pages/Finance.jsx`. (`gemini.chooseAgentTool` o'lik kod — tegilmadi.)
- **Tekshiruv:** `node --check` 11 fayl OK; pure-logic (flow+material) 23/23 PASS; agent end-to-end mock (S1 to'liq→ENTRY_CONFIRM, S2 qty+total→kilo narxi yumshoq so'rovi, S3 javob→confirm+1kg, S4 "yo'q"→confirm nag yo'q, S5 faqat nom→summa so'rash) 5/5 PASS; gemini import-graf + MATERIAL_SALE extraction (ppk 0→null, custom nom saqlanadi); Mini App Finance.jsx esbuild OK. **Jonli Gemini + Mongo testi foydalanuvchi zimmasida** (.env kerak). Yangi `materialName/quantityKg/pricePerKg` eski yozuvlarda null — migratsiya shart emas.

## 2026-06-26 Oddiy suhbat (salom/rahmat/xayr) qidiruv deb tushunilmasin
- **Muammo (skrinshot):** "ee rhamat ukam" → bot "Oka, qidiruv amalga oshirildi 🔍 ... hech qanday ma'lumot topilmadi" derdi. Sabab: Gemini salom/rahmatni SUXBAT→SEARCH_QUERY deb tasniflaydi, `answerReadQuery` null qaytarib `search_data` ishlardi.
- **Tuzatish:** `ai/queries.js` ga `smallTalkReply(rawText)` + `SMALL_TALK`/`SMALL_TALK_REPLY`. `answerReadQuery` tartibi: balans → next-client → mijozlar → xizmatlar → **suhbat** → null. Suhbat bo'lsa iliq "oka" javob (`tool:'small_talk'`), qidiruvga umuman bormaydi. Pure (DB yo'q).
- **Guard (false-positive yo'q):** raqam bo'lsa null; data so'zi (qancha/nechta/qachon/qayer/qaysi/kim/balans/daromad/xarajat/qarz/mijoz/xizmat/hisob/royxat/manzil/narx/telefon/bor) bo'lsa null; >6 so'z null; "ack" (zo'r/ok/yaxshi) faqat ≤3 so'z. Regex nozikliklari: stemlar (qalays-, yaxshimi-) trailing \b SIZ (qo'shimchani ushlaydi); `\bxayr\b` (xayrlashuv) "xayrli kun" (salom) bilan chalkashmaydi; `\brahmat\b` "Rahmatga" (mijoz ismi) bilan emas.
- Bot (matn/ovoz) + Mini App AI chat ikkalasiga tegishli (umumiy modul). Tekshiruv: `node --check src/ai/queries.js` OK; detection 19 talk + 9 non-talk PASS; `answerReadQuery('ee rhamat ukam')`→thanks reply, 'salom'→greeting, 'xayr oka'→bye; agent.js import-graf resolve. (Skrinshotdagi 1-xabar "menga mijozlar hawida malumot ber" allaqachon to'g'ri — MIJOZLAR shabloni, bugun mijoz yo'qligi uchun "barcha ishlar tugadi 🎉".)

## 2026-06-26 So'rov shablonlari yakuni — XIZMATLAR + get_next_client + umumiy modul + Mini App xarita tugmalari
- **Maqsad (spec 3-6):** XIZMATLAR so'rovini yangi qisqaroq formatga keltirish, "Endi qaysi mijoz uyiga boraman?" uchun alohida `get_next_client()` tool, 4 turdagi so'rov bot+Mini App'da BIR XIL modulni chaqirsin (takror yo'q), va Mini App mijoz formasida Google/Yandex xarita tezkor tugmalari.
- **Umumiy modul (`backend/src/ai/queries.js` — YANGI):** barcha o'qish-shablonlari (BALANS, MIJOZLAR, XIZMATLAR, KEYINGI MIJOZ) + detection shu yerda. Yagona eksport `answerReadQuery({rawText, fields, isAnalytics})` → `{text, tool}` | `null`. `agent.runAgent` SEARCH/ANALYTICS endi faqat shuni chaqiradi (eski inline shablonlar/konstantalar agent.js'dan o'chirildi; `getBalanceReport`/`getTodayPendingServices`/`formatTime` importlari ham). Bot (`handlers/message.js`→runAgent) va Mini App (`routes/ai.js`→runAgent, mode:'query') AYNAN bir modul/mantiq.
- **Routing (queries.answerReadQuery):** isAnalytics → `buildBalanceReport`; keyin `looksLikeNextClient` → `buildNextClientReport`; `looksLikeTodayClients` → `buildTodayClientsReport`; `looksLikeTodayServices` → `buildTodayServicesReport`; aks holda null. "kim/qayer ...bor(ish|a)" MIJOZLAR'dan KEYINGI MIJOZ'ga ko'chdi (bitta aniq javob mantiqan to'g'riroq).
- **XIZMATLAR (yangi):** `buildTodayServicesReport` → `getTodayPendingServices()`. "📦 Bugun N ta ish bor oka:\n\n1️⃣ {soat} — 📍{manzil}\n…\n\n👉 Hozir {eng_yaqin} ga borish vaqti keldi". Ism/tel yo'q (MIJOZLAR'dan qisqaroq). Bo'sh → "Bugun uchun barcha ishlar tugadi oka 🎉". Eski `getTodayServices` (pending+done, 🧹) butunlay olib tashlandi.
- **get_next_client:** `serviceService.getNextClient()` = `pickNearestByTime(await getTodayPendingServices())`. `pickNearestByTime(services)` — joriy vaqtga |Δt| eng kichik xizmat (lokatsiya emas, faqat vaqt); MIJOZLAR/XIZMATLAR tavsiyasi ham SHUNI ishlatadi (yagona manba, takror yo'q). `buildNextClientReport`: "👉 Hozir {ism} ga borishingiz kerak, oka\n📍 {manzil}  💰 {price} so'm  ⏰ soat {vaqt}". Bo'sh → "🎉".
- **Mini App xarita tugmalari:** `miniapp/src/components/MapQuickLinks.jsx` (umumiy komponent) — input ostida 2 ta 28px chip [🗺️ Google][🗺️ Yandex] → `window.open(url, '_blank', 'noopener,noreferrer')` (google.com/maps, yandex.uz/maps). FAQAT saytni ochadi; havolani QO'LDA nusxalab formaga PASTE qilish foydalanuvchida (tashqi platformada avtomatik qaytarish yo'q — ataylab o'zgartirilmadi). 3 joyga ulandi: `Clients.jsx` (qo'shish + tahrirlash), `Services.jsx` (xizmat formasi). CSS `styles.css` `.map-quick-links/.map-quick-btn` (theme tokenlari — ikkala mavzu). i18n shart emas (brend nomlari).
- **Tegilgan fayllar:** YANGI `ai/queries.js`, `components/MapQuickLinks.jsx`; o'zg. `ai/agent.js` (import+routing+inline o'chirish), `services/serviceService.js` (−getTodayServices, +pickNearestByTime, +getNextClient), `pages/Clients.jsx`, `pages/Services.jsx`, `styles.css`.
- **Tekshiruv:** backend `node --check` (agent/queries/serviceService) OK; import-graf resolve (runAgent/answerReadQuery/getNextClient/pickNearestByTime); routing 18/18 PASS (NEXT/CLIENTS/SERVICES/SEARCH + o'tgan-zamon "borganman"/joy "Chilonzordagi"/dateFrom rad); yangi XIZMATLAR+NEXT shablon mock render mos; Mini App `npm run build` OK (55 modul); Vite preview'da Mijoz qo'shish formasi'da chip'lar 28px, `window.open` to'g'ri URL+`_blank`+`noopener`, konsol xatosiz. Jonli DB/Telegram testi foydalanuvchi zimmasida.
- **Bug:** "100$" deyilganda bot "dollarni saqlay olmayman" deb RAD ETARDI (`agent.requiresSomConfirmation`). Olib tashlandi.
- **Aniqlash:** Gemini `currency` ('USD'|'UZS') maydonini ajratadi (prompt + classify schema); `normalizeExtractedFields` `resolveCurrency` orqali ('currency' yoki eski 'hasDollar'). Deterministik zaxira: `agent.detectUsd` regex (`$|dollar|dollor|usd`). `parseMoney("100$")=100` (belgini tashlaydi) — shuning uchun valyuta `rawText`dan ALOHIDA kuzatiladi (`trackEntryCurrency`: summa shu turda kelgan/o'zgargan bo'lsa USD/UZS belgilanadi; keyingi som korreksiya USD'ni bekor qiladi).
- **Konvertatsiya:** `agent.applyCurrencyConversion(intent, collected)` — USD bo'lsa `getUsdToUzsRate()` (kurs infra) bilan `convertUsdToUzs(amount, rate)=Math.round(amount*rate/100)*100`. IDEMPOTENT (keyin currency='UZS'). Joylar: `finalizeEntry` (service/expense/income), `handlePaymentUpdate`, `handleServiceEdit` + `editAgentService` (narx), `editPendingEntry` (tahrir loop). Kurs YO'Q bo'lsa `currencyFallback` — summani bo'shatib so'mda qayta so'raydi.
- **Saqlash:** `originalAmount/originalCurrency/exchangeRateUsed` Service + Transaction modeliga; `serviceArgs`/`createAgentTransaction`/`fallbackToolCall`/`createService`/`createTransaction` orqali o'tadi. **Balans/hisobotlarda DOIM so'm.**
- **Shaffoflik:** `entrySummaryText` va `serviceConfirmationText` da `money.formatConversionLine`: "💵 100$ → 1 205 200 so'm (kurs: 1$ = 12 052 so'm)".
- **Mini App:** bosh sahifada kichik real-time kurs (`Home.RateChip` → `GET /exchange-rate`).
- **Tekshiruv:** butun backend `node --check` OK; import-graf OK; konvertatsiya+UI test 7/7; Mini App `npm run build` OK (54 modul); eski "dollarni saqlay"/`requiresSomConfirmation` grep 0. Jonli Gemini sinovi foydalanuvchida.

## 2026-06-26 AI so'rov-javob standart shablonlari — BALANS + MIJOZLAR + XIZMATLAR (3/3 TAYYOR)
- **Maqsad:** bot/Mini App AI chatdagi erkin savollar (balans, mijozlar, xizmatlar) har biriga ANIQ, o'qish oson, emojili standart shablon javob bersin. Deterministik (Gemini matnni qayta yozmaydi → format barqaror, tezroq, call-budget'ga mos).
- **XIZMATLAR so'rovi** ("xizmatlar haqida"/"bugungi xizmatlar"/"bugun qanday ishlarim bor" — aniq sana/filtrsiz, QISQAROQ): SEARCH_QUERY ichida MIJOZLAR'dan KEYIN `looksLikeTodayServices(rawText, fields)` tekshiriladi → `buildTodayServicesReport`. Detection "xizmat/ish/reja" so'zlariga tayanadi (MIJOZLAR "mijoz/navbat/borish"ga — kalit so'z bo'yicha ajraladi, ustma-ust kelmaydi). RAD etadi: dateFrom/dateTo, aniq joy ("Chilonzordagi xizmatlar"). `serviceService.getTodayServices()` — bugun, status {kutilmoqda, bajarildi} (bekor chiqmaydi), vaqt asc. Shablon: "🧹 Bugungi xizmatlar (N ta)\n\n1️⃣ ism — soat ✅/⏳\n…\n\n✅ X bajarildi · ⏳ Y kutilmoqda". Bo'sh → "Bugun uchun xizmat yo'q oka 📭". MIJOZLAR clause 3 dan "ish/reja" olib tashlandi (endi XIZMATLAR'ga ketadi).
- **BALANS so'rovi** ("balansim haqida", "o'tgan oydagi balans", "may oyidagi hisobot"): `agent.runAgent` ANALYTICS_QUERY'ni `executeToolFlow` o'rniga `buildBalanceReport(balancePeriod(fields))`ga yo'naltiradi. `financeService.getBalanceReport(period)` REAL aggregatsiya — `getSummary` (kirim/chiqim/balans) ustiga: eng katta xarajat (`$match expense + $sort amount:-1 + $limit 1`), eng kichik (`amount:1`), eng qimmat xizmat (Service `$sort price:-1`), `Service.countDocuments` done/pending. **Davr:** `analyticsPeriod` bo'lsa o'sha, bo'lmasa `all` (= JORIY/umumiy, spec: "davr aytilmasa joriy balans"). Pending: `all`da `serviceDateTime>=from` (kelajak ham), aniq davrda oraliq. `tenantScopePlugin` aggregate'ni avtomatik scope qiladi (getSummary kabi).
- **MIJOZLAR so'rovi** ("mijozlar haqida ma'lumot ber" — aniq sana/filtrsiz): SEARCH_QUERY ichida `looksLikeTodayClients(rawText, fields)` aniqlasa `buildTodayClientsReport`. Detection: present/future "kimga/qayerga borish/boraman", "navbatdagi", "bugun…ish/mijoz", "mijoz* + bugun/hozir/haqida/royxat/malumot/kim/qaysi/necha". RAD etadi: `dateFrom/dateTo` bor (aniq sana), o'tgan zamon ("qayerga borganman", "kecha bordim"), aniq joy ("Chilonzordagi mijozlar"). `serviceService.getTodayPendingServices()` — bugun (Asia/Tashkent startOfDay..endOfDay), status kutilmoqda, vaqt asc. Shablon: "Ha bo'ldi oka… 📋\n\nBugungi mijozlar:\n1️⃣ ism — soat — 📍manzil…\n\n👉 Hozir siz {eng_yaqin} xizmatiga borishingiz kerak". **Eng yaqin:** joriy vaqtga serviceDateTime bo'yicha eng kichik |Δt| (faqat vaqt, masofa emas). Bo'sh kun → "Bugun uchun barcha ishlar tugadi oka 🎉" (tavsiyasiz).
- **Tegilgan fayllar:** `services/financeService.js` (+`getBalanceReport`, +SERVICE_STATUS import), `services/serviceService.js` (+`getTodayPendingServices`, +`getTodayServices`, +startOfDay/endOfDay import), `ai/agent.js` (3 routing tekshiruvi + `buildBalanceReport`/`buildTodayClientsReport`/`buildTodayServicesReport`/`looksLikeTodayClients`/`looksLikeTodayServices`/`balancePeriod`/`PERIOD_LABEL`/`listNumber`/`SERVICE_STATUS_ICON`, +getBalanceReport/getTodayPendingServices/getTodayServices/formatTime importlar). Mavjud `analyticsSummary`/`searchSummary` (executeToolFlow fallback, pivot) o'zgarmadi.
- **Tekshiruv:** `node --check` 3 fayl OK; routing 15/15 PASS (MIJOZLAR vs XIZMATLAR vs SEARCH ajratish + o'tgan-zamon "borganman"/aniq joy "Chilonzordagi"/dateFrom rad); 3 shablon (BALANS/MIJOZLAR/XIZMATLAR) + 2 bo'sh holat mock data bilan format mosligi tasdiqlandi (formatMoney "so'm" qo'shadi — qo'sh yozilmaydi); `getBalanceReport`/`getTodayPendingServices`/`getTodayServices` import bilan resolve. Jonli DB testi `.env`+Mongo talab qiladi (foydalanuvchi zimmasida).
- **DIQQAT (push):** bu ish bilan PARALLEL ravishda USD→UZS konvertatsiya integratsiyasi `ai/agent.js`, `ai/gemini.js`, `services/financeService.js`, `services/serviceService.js`, `models/Service.js`, `models/Transaction.js`, `utils/money.js` ni o'zgartirdi (commit qilinmagan). Bir fayllarni baham ko'radi — push qilinsa ikkala oqim birga ketadi.

## 2026-06-26 USD→UZS valyuta kursi infratuzilmasi (CBU rasmiy API + kesh)
- **Maqsad:** dollar/so'm konvertatsiya uchun backend infra (hozircha faqat infra; bot'da ishlatish keyingi ish).
- **Manba:** CBU rasmiy bepul API (kalit kerak emas) — `https://cbu.uz/uz/arkhiv-kursov-valyut/json/USD/`. Javob `[{Ccy:'USD', Rate:'12345.67', Nominal:'1', Date}]`.
- **Model — GLOBAL singleton:** `models/ExchangeRate.js` (kolleksiya `exchange_rate_cache`, `{base:'USD', usdToUzsRate, rateUpdatedAt, source}`). Kurs hamma uchun bir xil — shaxsiy emas, shuning uchun **tenantScopePlugin QO'YILMADI** (Settings'ga emas, alohida kolleksiyaga: per-user takror bo'lmasin). Kontekstsiz ishlaydi (startup warm, har qanday joydan).
- **Xizmat — `services/exchangeRateService.js`:**
  - `getUsdToUzsRate()` — fallback zanjiri: (1) kesh <12 soat → o'shani; (2) eski/yo'q → CBU asosiy URL, bo'lmasa CBU "barcha valyuta" zaxira URL (ikkalasi ham CBU rasmiy), keshga yoz; (3) CBU ishlamasa → ESKI keshni qaytar; (4) kesh ham yo'q → `null` (chaqiruvchi foydalanuvchidan so'rashga o'tadi). **Hech qachon throw qilmaydi.**
  - `fetch` 5s timeout (`AbortSignal.timeout`), xato otmasdan fallbackga o'tadi.
  - `parseUsdRate` — massiv yoki obyekt, USD ni topadi, Nominalga bo'ladi, vergulli/nuqtali formatni tushunadi, yaroqsizda null.
  - `getRateInfo()` — endpoint uchun: `{usdToUzsRate, rateUpdatedAt, stale, source}`.
- **Endpoint:** `GET /api/v1/exchange-rate` (va `/api/exchange-rate`) — `routes/exchangeRate.js`, authMiddleware ortida (barcha API kabi). Kesh modeli pluginsiz, shuning uchun tenant wrapper ichida ham muammosiz.
- **Startup warm:** `index.js` deploy'dan keyin fonda `getUsdToUzsRate()` chaqiradi (bloklamaydi) — birinchi foydalanuvchi kutmasin.
- **Tekshiruv:** `node --check` 5 fayl OK; import-graf OK; parse+live test 10/10 PASS — **jonli CBU so'rovi haqiqiy kurs qaytardi (1 USD = 12013.52 UZS)**, nominalga bo'lish, vergul format, yaroqsizda null hammasi tasdiqlandi.

## 2026-06-26 BUG 2 — TO'LIQ MULTI-TENANT IZOLYATSIYA (har ega alohida ma'lumot)
- **Maqsad:** bir nechta ruxsatli Telegram ID — har biri BUTUNLAY alohida ma'lumot to'plami (mijoz/xizmat/moliya). Avval baza ajratmas edi (biriniki boshqada ko'rinardi).
- **Arxitektura (fail-closed, qo'lda har query'ni o'zgartirmasdan):** `backend/src/db/tenantScope.js` — AsyncLocalStorage konteksti (`runWithUser(userId, fn)` / `runGlobal(fn)` / `currentUserId()`) + Mongoose **plugin**. Plugin scoped modellarning (Client/Service/Transaction/DebtPayment) HAR BIR query/aggregate/save'iga avtomatik `telegramUserId` filtrini qo'shadi va create'da uni yozadi. **Kontekst yo'q bo'lsa XATO tashlaydi** — ya'ni filtrlanmagan global so'rov tasodifan ishlamaydi; global kerak bo'lsa ATAYLAB `runGlobal`. Birorta joyni "unutib" sizdirib bo'lmaydi (eng yomoni xato, sizish emas).
- **Kontekst o'rnatiladigan 6 joy:** (1) `bot/bot.js` owner-guard → `runWithUser(ctx.from.id, next)` (butun bot oqimi: session, handlerlar, AI agent, callbacklar shu ichida); (2) `routes/index.js` authMiddleware'dan keyin → `runWithUser(req.telegramUser.id, next)` (barcha API); (3) `cron/reminders.js` → `runGlobal`; (4) `cron/cleanup.js` purgeOld → `runGlobal`; (5) `serviceService.repairMissingServiceIncome` → `runGlobal`; (6) `db/migrateTenancy` → `runGlobal`. Service/route/agent/bot-handler/search/analytics/PDF kodi O'ZGARMADI — plugin avtomatik scope qiladi.
- **Schema:** Client/Service/Transaction/DebtPayment ga `telegramUserId {String, required, index}` (plugin orqali). Client unique index `{phone}` → `{telegramUserId, phone}` compound partial-unique (2 egada bir xil tel bo'lishi mumkin). Settings/Conversation allaqachon o'z kaliti bilan (telegramUserId/telegramId) — pluginsiz; `Settings.getSingleton` endi `currentUserId()`ga default (reminder/deleteCode to'g'ri egadan oladi). Settings default theme 'auto'→'light' (spec).
- **Auth/env:** `ALLOWED_TELEGRAM_IDS` (eski `OWNER_TELEGRAM_ID` ham qabul qilinadi — Railway o'zgarmasdan ishlaydi). `legacyOwnerId()` migratsiya uchun. `ownerIds()/isOwnerTelegramId()` shu yangi manbadan. Mini App o'zgarmadi — initData'ni har so'rovga yuboradi, server `req.telegramUser.id` bilan scope qiladi.
- **Migratsiya:** `db/migrateTenancy.js` — IDEMPOTENT startup backfill (connectDB'dan keyin, bot/API yozuvlaridan oldin): `telegramUserId` yo'q/null har bir eski yozuvga asosiy egani (`legacyOwnerId`) yozadi. Bir martalik skript o'rniga idempotent qildik — qayta deploy xavfsiz, qo'lda qadam yo'q.
- **Cron (BUG 1 bilan birga):** eslatma endi FAQAT `service.telegramUserId` egasiga yuboriladi (avval hammaga broadcast). `sendToOwner()` 403/400 (bloklagan/chat yo'q) — at-most-once tufayli qayta urinmaydi, faqat loglaydi. Bu Railway logidagi "har daqiqada 403 spam"ni butunlay yopadi (claim-first + rollbacksiz + per-owner).
- **Qo'shimcha izolyatsiya teshiklari (audit'da topilib yopildi):** (a) `notify.js notifyOwner` — Mini App'da xizmat bajarilganda xabar `ownerIds()`ga (HAMMA egaga) ketardi → mijoz nomi/summasi boshqa egalarga ko'rinardi; endi FAQAT `currentUserId()`ga. (b) `financeService.createTransaction` — qo'lda yuborilgan `serviceId` boshqa egaga tegishli bo'lsa, analitika `$lookup`'i orqali o'sha eganing mijozi ko'rinishi mumkin edi → endi faqat O'Z xizmatiga bog'lanadi (scoped findOne). (c) `bot.js` ga `ctx.userId` (spec literal).
- **Tekshiruv:** `node --check` 14 fayl OK; import-grafi 10/10 OK (circular yo'q); tenant-test 29/29 PASS — ALS async propagation, plugin scope-injection (find/updateMany/deleteMany/countDocuments/aggregate), fail-closed throw, save-stamp (+aniq qiymat ustun), haqiqiy modellarda required maydon, Client compound unique partial index, eski phone-only index yo'q, end-to-end izolyatsiya (B↔A ko'rmaydi, telefon bo'yicha ham). **To'liq runtime: 2 Telegram akkaunt bilan jonli test (foydalanuvchi bajaradi) — birida mijoz qo'shilsa ikkinchisida ko'rinmasligi.**

## 2026-06-26 BUG 1 — eslatma bir necha marta yuborilishi tuzatildi (at-most-once)
- **Belgi:** bitta eslatma (oldindan / xizmat vaqtida / tasdiq so'rovi) TAKRORLANIB, har daqiqada qayta yuborilardi.
- **Ildiz sabab (asosiy):** `cron/reminders.js` har xabarni atomar claim qilardi (`findOneAndUpdate sent:false→true`) — bu to'g'ri — LEKIN yuborish xato bersa bayroqni QAYTARARDI (`$set sent:false`). `broadcast` esa `Promise.all` ishlatardi: bir nechta owner bo'lsa (`OWNER_TELEGRAM_ID` allowlist), BITTA owner botni bloklagan/Start bosmagan bo'lsa `Promise.all` butunlay reject bo'lardi → bayroq qaytarilardi → keyingi tik QAYTA claim qilib HAMMAGA qayta yuborardi. Natija: yetib boradigan owner(lar) har daqiqada spam. Bitta owner holatida ham: Telegram timeout xabar AKTUAL yetkazilgandan KEYIN kelsa → rollback → dublikat.
- **Tuzatish (claim-first + rollback YO'Q = ko'pi bilan bir marta):**
  - `broadcast` endi `Promise.allSettled` — har oluvchiga MUSTAQIL yuboradi, bittasi xato bersa qolganlari spam bo'lmaydi; yetkazilgan oluvchilar sonini qaytaradi (0 = hech kimga yetmadi, loglanadi). Bo'sh `OWNER_TELEGRAM_ID` da throw o'rniga log+0.
  - Uchala `fire*` funksiyada send xatosida bayroq QAYTARILMAYDI (3 ta `Service.updateOne(... sent:false)` rollback olib tashlandi). Claim qilingach bayroq doimiy. Sabab: xato yetkazishdan keyin ham kelishi mumkin → qaytarish = dublikat. Tradeoff: juda kamdan-kam yo'qotish (claim bilan send orasida crash) dublikatdan afzal; 3 turdagi eslatma bir-birini qisman qoplaydi.
- **Parallel cron tekshiruvi:** cron faqat bir marta start bo'ladi (`index.js:95`); intra-process `withLock`; cross-instance (Railway deploy overlap) atomar claim bilan himoyalangan — faqat bitta instans har yozuvni claim qiladi. Rollback olib tashlangani claim'ni qayta ochmaydi, shuning uchun cross-instance ham endi dublikatsiz.
- **Tekshiruv:** `node --check src/cron/reminders.js` OK; in-memory simulyatsiya (`scratchpad/reminder_sim.mjs`) 4 senariy PASS — (1) 2 owner, biri bloklagan, 5 tik → yetib boradigan owner aniq 1 marta (spam yo'q); (2) 1 owner 3 tik → 1 marta; (3) 1-tik xato → 2-tik bot tuzaldi → 0 resend (at-most-once); (4) 2 instans parallel → 1 marta (atomar claim). To'liq runtime sinovi `.env` + Telegram + MongoDB talab qiladi.
- **KEYINGI ISH (BUG 1 emas, ogohlantirish):** hozir model "allowlist" — `broadcast` BARCHA `OWNER_TELEGRAM_ID` larga yuboradi va `Service/Client/Transaction` da `ownerId` YO'Q (umumiy baza). "Har biri o'z mustaqil biznesi" uchun haqiqiy multi-tenant kerak: `ownerId` ni Service/Client/Transaction ga qo'shib, barcha query/cron'ni egasiga scope qilish + eslatma faqat o'sha egaga. Bu alohida katta ish.

## 2026-06-24 Xizmat vaqtida eslatma + Mini App bajarildi bot xabari + balans o'z-o'zini tuzatish
- **So'rov:** (1) 3 soat oldin eslatma har doim mumkin emas (ish vaqtidan <3 soat oldin kiritilsa) — shu holatda xizmat VAQTIDA eslatsin; 3 soat bo'lsa 3 soat oldin HAM, vaqtida HAM eslatsin. (2) Mini App'da bajarildi belgilansa — bot Telegram'da ham xabar bersin va daromad balansga yozilsin. (3) "Bajarildi deb yozsam ham balansga pul tushmayapti" xatosini tuzat.
- **(1) Xizmat vaqtidagi eslatma — YANGI:** `Service.startReminderSent` (default false). Cron `fireStartReminders` har daqiqada `serviceDateTime <= now & startReminderSent=false & PENDING & !historical` ni atomar claim qilib "⏰ hozir borish vaqti keldi" (tugmasiz) yuboradi. `reminderAt` (oldindan) bilan MUSTAQIL — ikkalasi ham kerak bo'lsa ikkalasi yuboriladi. Yaratishda (`buildScheduleFields`) va reschedule'da (`applyServiceSchedule`) `startReminderSent = serviceDateTime <= now` (vaqti o'tib ketgan/tarixiy — yuborilmaydi). **Grace 2 soat:** bot uzoq o'chiq bo'lib kech qolgan eslatma "hozir vaqti" demaydi — jimgina belgilab o'tadi (burst oldini oladi; eski PENDING yozuvlar deploy'da bir marta tozalanadi). `ui.reminderInfoLine` endi 3 satr: oldindan (agar kelajak+vaqtidan oldin) + vaqtida + tasdiq.
- **(2) Mini App bajarildi → bot xabari:** `routes/services.js PATCH /:id/complete` endi `completeService(...).created===true` bo'lsa `notifyOwner("✅ ... bajarildi ... 💰 ... balansga yozildi")` yuboradi. Yangi `bot/notify.js` (`attachNotifierBot`/`notifyOwner`, `index.js`'da `bot` ulanadi — `reports.js` namunasi, sikl yo'q). Cron "bajarildimi?" so'rovi va vaqt eslatmasi `status=PENDING` filtrida — bajarildi bo'lgach o'z-o'zidan so'ramaydi.
- **(3) Balans bug — ILDIZ SABAB:** `completeService` "allaqachon DONE" va "race-lost" tarmoqlari income yo'q bo'lsa FAQAT qidirardi, YARATMASDI. Demak DONE bo'lib, lekin income yozuvi yo'q xizmat (legacy/qisman muvaffaqiyatsiz yozuv) hech qachon balansga tushmasdi — qayta "bajarildi" qilinsa ham. **Tuzatish:** `ensureServiceIncome(service)` helper — bog'langan/faol income bo'lsa qaytaradi, bog'lanmagan faol bo'lsa bog'laydi, hech qanday income yo'q bo'lsa yaratadi (o'z-o'zini tuzatish). Qasddan o'chirilgan (soft-deleted) income'ni TIKLAMAYDI (bekor/o'chirishdagi qaytarishni hurmat qiladi). "DONE" tarmog'i shuni ishlatadi. Race-lost tarmog'i ataylab faqat qidiradi (g'olib tik dublikatsiz yaratadi). Startup'da `repairMissingServiceIncome()` (fonda) barcha DONE+income-yo'q xizmatlarni balansga tiklaydi — mavjud yo'qolgan pullarni qaytaradi.
- **Tekshiruv:** `node --check` 8 fayl OK; ESM import OK (sikl yo'q, eksportlar bor); `reminderInfoLine` 3 senariy render: 4 soat oldin → 3 satr; 1 soat oldin (3 soat mumkin emas) → oldindan YO'Q + vaqtida + tasdiq; tarixiy → null. To'liq runtime sinovi `.env` + Telegram + MongoDB talab qiladi.

## 2026-06-24 Javob tezligini oshirish + gemini-2.5-flash + emoji
- **Belgi:** ovoz/matn javoblari "juda juda sekin"; model flash-lite; javoblar quruq (emoji kam).
- **Sekinlik sababi (analiz):** har bir amal AI quvurida KETMA-KET bir nechta Gemini chaqiruvi qilardi. `agent.js executeToolFlow`: `chooseAgentTool` (tool tanlash, Gemini) + `formulateToolResponse` (javob yozish, Gemini). Lekin: (a) `chooseAgentTool` natijasi FAQAT deterministik `TOOL_BY_INTENT` tanloviga mos kelganda ishlatilardi — aks holda tashlanardi, ya'ni ko'pincha bekorga kechikish; (b) `create_service` uchun `formulateToolResponse` javobi `sendAgentResult` da `serviceConfirmationText` shabloni bilan almashtirilib, baribir TASHLANARDI. Ya'ni xizmat yozish/tasdiqlashda 2 ta to'liq Gemini chaqiruvi behuda kechikish berardi. Ovozda yana + transkripsiya + klassifikatsiya.
- **Tuzatish (TEZLIK):** `executeToolFlow` endi `fallbackToolCall(intent, fields, rawText)` bilan toolни deterministik tanlaydi (niyat allaqachon tasniflangan, maydonlar normallashtirilgan — qo'shimcha LLM tool-planner kerak emas). Javob: yozuv amallari shablon (`fallbackResponse`, emoji bilan), `formulateToolResponse` faqat `LLM_RESPONSE_TOOLS` (search_data/get_analytics/get_balance/get_services_by_identifier) uchun. Endi: xizmat/xarajat tasdig'i 2→0 qo'shimcha Gemini chaqiruvi; matn qidiruv 3→2; ovoz qidiruv 4→3. O'lik kod (`mergeToolArgs`, `cleanArgs`) va ishlatilmaydigan `chooseAgentTool` importi olib tashlandi (chooseAgentTool gemini.js'da export sifatida qoldi).
- **Tuzatish (MODEL):** standart `gemini-2.5-flash` (aqilliroq, tabiiyroq). `env.js DEFAULT_GEMINI_MODEL='gemini-2.5-flash'`; `gemini.js PRIMARY_MODEL` fallback flash; `CANDIDATE_MODELS = [primary, flash, flash-lite, flash-latest]` (flash band bo'lsa lite — tez muqobil). `.env` va `.env.example` yangilandi. **Railway: `GEMINI_MODEL=gemini-2.5-flash` qo'ying yoki o'chiring** (aks holda eski `flash-lite` qiymati saqlanib qoladi — kod aniq berilgan qiymatni hurmat qiladi).
- **Tuzatish (EMOJI):** `prompts.js BOT_PERSONA` ga "kam-kam mos emoji" ko'rsatmasi (💰💸📅👤📞📍✅📊) — search/analytics LLM javoblari va `buildAnswerPrompt` shu personadan foydalanadi. `flow.js QUESTIONS` slot-savollariga emoji prefikslari. Yozuv shablonlari (`serviceConfirmationText`, `serviceSummary`, `analyticsSummary`, `fallbackResponse`) allaqachon emoji bilan.
- **Tradeoff:** yozuv amallari uchun LLM javob o'rniga shablon — tezroq, lekin "ijodiy" matn yo'q (egasi tezlikni so'radi; shablonlar baribir samimiy + emoji). Search/analytics hamon jonli LLM xulosa oladi.
- **Tekshiruv:** `node --check` (agent/gemini/env/prompts/flow) OK; `agent.js`+`gemini.js`+`flow.js` import OK; `env.GEMINI_MODEL` → `gemini-2.5-flash`; `QUESTIONS.price` → "💰 Xizmat haqi qancha, oka?"; agent.js'da olib tashlangan simvollarga qoldiq murojaat yo'q. To'liq tezlik o'lchovi jonli Telegram + Gemini bilan.

## 2026-06-24 "Dollarni saqlay olmayman" soxta xato + ovoz xato muomalasi
- **Belgi:** dollar aytilmaganda ham bot "Oka, dollarni saqlay olmayman. ...so'mda aytib bering." deydi; ovozli xabarga "Ovozni tushunolmadim" chiqadi (process endi yiqilmaydi — oldingi tuzatishdan keyin).
- **Ildiz sabab (dollar, DETERMINISTIK):** `agent.js requiresSomConfirmation()` qidiruv matnini `rawText` + `JSON.stringify(understanding.fields)` dan yasab `/(\$|dollar|usd)/i` ni ishlatardi. `SERVICE_ENTRY` uchun `gemini.js normalizeExtractedFields` DOIM `hasDollar` kalitini qaytaradi → JSON'da `"hasDollar":false` bo'ladi → regex **kalit nomidagi "dollar" qismiga** mos keladi → HAR xizmat yozuvi (matn yoki ovoz) soxta dollar-rad javobini olardi. Shuning uchun ovoz "umuman ishlamaydi"dek tuyulardi: transkripsiya to'g'ri bo'lsa ham xizmat yozuvi shu devorga urilardi.
- **Ildiz sabab (ovoz xato muomalasi):** `message.js` da download+transkripsiya+`handleTextInput` BITTA try/catch'da edi; har qanday downstream xato ham "Ovozni tushunolmadim" bo'lib chiqib, asl sababni (NLU/agent xatosi yoki kalit muammosi) yashirardi.
- **Tuzatish:**
  - `agent.js`: `requiresSomConfirmation` endi faqat foydalanuvchi MATNINI tekshiradi: `/(\$|dollar|dollor|\busd\b)/i.test(rawText)` (+ Gemini'ning aniq `hasDollar===true` bayrog'i). fields JSON umuman qo'shilmaydi. Bonus: o'zbekcha "dollor" imlosi ham ushlanadi (eski regex o'tkazib yborardi).
  - `message.js`: ovoz/audio uchun yagona `handleVoiceLikeMessage(ctx, fileId, mime)` — transkripsiya o'z try/catch'ida ("Ovozni tushunolmadim"/`replyAiError`); bo'sh transkripsiya → "...so'z chiqmadi, sekinroq yuboring"; keyin `handleTextInput` alohida try/catch'da (matn bilan bir xil umumiy xato). Endi log'da transkripsiya xatosi va NLU xatosi alohida ko'rinadi.
- **Eslatma:** dollar-rad qoidasi ataylab qoldi (tizim faqat so'm saqlaydi) — faqat soxta ishga tushish olib tashlandi. Haqiqiy "$/dollar/dollor/usd" hamon so'm so'raydi.
- **Tekshiruv:** `node --check` `agent.js`/`message.js`/`gemini.js` OK; eski-vs-yangi regex testi: xizmat yozuvi (dollar yo'q) eski=`true` (bug) → yangi=`false`; "100 dollar"=`true`; "200 dollor"=`true`; "150$"=`true`; xarajat (dollar yo'q)=`false`. To'liq runtime sinovi `.env` + Telegram talab qiladi.

## 2026-06-24 Railway crash + ovozli xabar tuzatildi (Railway loglaridan)
- **Belgi:** (1) server 11:22:37 da yiqilgan — `Error: Request timed out after 10000 ms` (grammy `webhook.js`); (2) 13:05:18 da "MongoDB uzildi" dan keyin jimlik; (3) ovozli xabarga bot umuman javob bermaydi, faqat matnga.
- **Ildiz sabab (1 va 3 bitta bug):** Railway webhook rejimida `index.js` `webhookCallback(bot, 'express')` ni grammy default'lari bilan ulardi — `onTimeout: 'throw'`, `timeoutMilliseconds: 10000`. grammy `timeoutIfNecessary` 10s dan oshsa `reject(...)` qiladi; Express 4 async middleware'dagi rejected promise'ni ushlamaydi → **unhandled rejection** → Node process'ni o'ldiradi (log'dagi "npm error / Lifecycle script start failed" / Railway restart). Ovoz oqimi: download OGG + Gemini audio transkripsiya + intent classify + agent tool + javob formulate = 3-4 ketma-ket, chegarasiz Gemini chaqiruvi — deyarli har doim 10s dan oshadi. Shuning uchun **har ovozli xabar process'ni yiqitadi, `catch` ichidagi `ctx.reply` ishlamay qoladi** → egaga hech narsa kelmaydi. Telegram javob (200) olmagani uchun update'ni qayta yuboradi → crash-loop. Matn bitta tez chaqiruv, 10s ichida ulguradi — shuning uchun ishlardi.
- **Ildiz sabab (2):** `db/connect.js` faqat `error`/`disconnected` ni tinglardi, `reconnected` yo'q edi. Mongoose 8 avtomatik qayta ulanadi, lekin log bo'lmagani uchun "MongoDB uzildi" dan keyin jimlik — katta ehtimol jim qayta ulangan, kuzatib bo'lmasdi.
- **Tuzatish:**
  - `index.js`: webhook `{ onTimeout: 'return', timeoutMilliseconds: 25_000 }` — timeout'da Telegram'ga 200 qaytaramiz, handler fonda davom etib javobni baribir yuboradi (alohida `bot.api` chaqiruvi orqali), crash yo'q.
  - `index.js`: global `process.on('unhandledRejection')` + `process.on('uncaughtException')` — bitta xato butun botni o'ldirmaydi (so'nggi himoya chizig'i).
  - `gemini.js`: har `generateContent`'ga `{ timeout: 15_000 }` — osilib qolgan Gemini chaqiruvi uziladi. Timeout/abort/tarmoq xatosi endi DARHOL throw qilinmaydi: `classifyGeminiError` uni `'fallthrough'` deb baholaydi va `generate()` keyingi zaxira modelni sinab ko'radi (faqat hamma model osilsa egaga xato chiqadi). 4xx (kalit/so'rov) — `'fatal'`, darhol uzatiladi; 429/5xx — `'retry'`, qisqa backoff. (15s tanlandi: asosiy osilsa ham webhook oynasida (25s) zaxirani sinashga ulguramiz.)
  - `db/connect.js`: `connected`/`reconnected` tinglovchilari qo'shildi (connect'dan oldin ulanadi); "MongoDB qayta ulandi ✅" loglanadi. `index.js` health endpoint endi `mongoose.connection.readyState` ni jonli o'qiydi (statik bayroq emas).
- **Vaqt byudjeti:** Gemini per-call 15s < webhook ack 25s; bitta osilgan chaqiruv 15s ichida uziladi va zaxira modelga o'tadi (15s + ~2-3s zaxira ≈ webhook oynasida). Ko'p chaqiruvli ovoz oqimi 25s dan oshsa — Telegram 200 oladi, ish fonda tugab javob keladi.
- **Tekshiruv:** `node --check` `index.js`/`connect.js`/`gemini.js` — OK. (Bot/DB runtime testi haqiqiy `.env` + Telegram talab qiladi.)

## 2026-06-24 Yangi yozuvga YAKUNIY TASDIQLASH bosqichi (3 tugma + tahrir loop)
- **Maqsad:** SERVICE_ENTRY / EXPENSE_ENTRY / INCOME_ENTRY — barcha majburiy maydon yig'ilgach
  DARHOL saqlamaydi; avval xulosa + 3 tugma ko'rsatiladi, tasdiqdan keyingina MongoDB'ga yoziladi.
- **Bug tekshiruvi:** "maydon to'lgach bot hech narsa qaytarmaydi" — joriy kodda
  `agent.finalizeEntry` (bot mode) allaqachon `ENTRY_CONFIRM` + xulosa qaytaradi (continueEntry/startEntry →
  finalizeEntry, save_yes/text "ha" → confirmPendingEntry → executeToolFlow → createService/createTransaction).
  Static traceda saqlash zanjiri uzilmagan; muammo eski 2-tugmali (Saqlash/Bekor) UX yoki eskirgan deploy edi.
  Shunга qaramay oqim spec bo'yicha aniq 3-tugmali + tahrir-loop bilan QAYTA yozildi, eski kod tozalandi.
- **Yangi oqim:** `ui.entrySummaryText(intent, fields)` (Service: 👤📱📍/📅💰💳 + "Hammasi to'g'rimi?";
  Xarajat/kirim: 💸/💰 summa | toifa + 📝izoh + "To'g'rimi?") + `ui.entryConfirmKeyboard()`
  [✅ Ha, to'g'ri=entry_save][✏️ Yo'q, tahrirlash kerak=entry_edit][❌ Bekor qilish=entry_cancel].
  `agent.finalizeEntry` endi shularni qaytaradi (eski `entryConfirmationText`/`locationText` o'chirildi).
- **Callbacklar (`callbacks.js`):** `entry_save`→`confirmPendingEntry` (saqlaydi, "Saqlandi ✅", sessiya reset);
  `entry_edit`→`awaitingField='editEntry'` + "Nimani tahrirlash kerak, ayting oka"; `entry_cancel`→reset +
  "Bo'ldi, bekor qildim oka, hech narsa saqlanmadi". Eski `save_yes` ichidagi o'lik ENTRY_CONFIRM shoxi olib
  tashlandi (save_yes/save_no endi faqat OCR rasm tasdig'i uchun).
- **Matn/ovoz (Prompt 9 qoidasi):** `message.routeEntryConfirmation` `answers.interpretEntryConfirm`
  (save/edit/cancel) bilan tugma bilan bir xil ishlaydi; aniqlanmagan matn ("narxi 200 ming") to'g'ridan
  `routeEntryEdit`ga boradi. **Tahrir loop:** `routeEntryEdit`→`understandText(text, history)`→
  `agent.editPendingEntry` AI ajratgan maydonni `collected.fields` USTIGA yozadi (`flow.mergeFields(...,{overwrite:true})`
  + editField→entry map + sana `parseHumanDateTime`), yangilangan xulosani xuddi shu 3 tugma bilan QAYTA ko'rsatadi
  ("Ha, to'g'ri" bosilmaguncha). Tahrirdan keyin majburiy maydon yetishmasa — normal so'rashga qaytadi.
- **Tekshiruv:** barcha backend `node --check` OK; modul-load smoke OK; offline xulosa/merge/interpret testi OK;
  fake-conversation orqali to'liq zanjir integratsiya testi 16/16 (SERVICE/EXPENSE/INCOME → ENTRY_CONFIRM →
  editField/direct/phone overwrite, boshqa maydonlar saqlanadi). Mini App (mode='query') tegilmadi.

## 2026-06-24 Umumiy suhbat qoidalari: matn/ovoz = tugma + oxirgi 10 xabar konteksti
- **Qoida 1 (tugma o'rniga matn/ovoz):** har qanday tugmali savolga endi matn/ovoz bilan ham javob
  bersa bo'ladi, callback bilan AYNAN bir xil natija. `message.handleTextInput` `conv.pendingIntent`ga
  qarab yangi handlerlarga yo'naltiradi: `routeEditConfirmation` (EDIT_CONFIRM ↔ edit_confirm/edit_cancel),
  `routeLocationQuestion` (LOCATION_QUESTION ↔ location_service_yes/no), `routeClarifyChoice`
  (CLARIFY ↔ clarify_N, `matchClarifyOption` orqali ordinal/label), `routeClientDisambiguation`
  (CLIENT_DISAMBIGUATION ↔ pick_client_, ism/tartib bo'yicha). Cron "bajarildimi?" so'rovi:
  `routeServiceConfirm` `interpretConfirmAction` (done/cancel/reschedule) + `conv.lastConfirmServiceId`
  (cron `markConfirmContext` yozadi; 24h oyna; xizmat hali `kutilmoqda` bo'lsa). To'lov usuli/ENTRY tasdiq
  allaqachon matn qabul qilardi. `answers.js` helperlari (avval o'lik) endi ulangan.
- **Qoida 2 (oxirgi 10 xabar konteksti):** `Conversation.history` (rolling, `pushHistory` $push/$slice -10)
  endi yoziladi va Gemini'ga beriladi. Egasi xabari `handleTextInput`da, botning HAR bir chiqar xabari
  `bot.js` `bot.api.config.use` transformeri orqali (sendMessage/editMessageText, owner-only) yoziladi.
  `understandText(text, history)` → `classifyIntent` → `prompts.buildClassificationPrompt` endi
  "RECENT CONVERSATION (oldest→newest)" blokini joriy xabardan oldin qo'yadi. Mini App (`routes/ai.js`)
  history bermaydi — orqaga mos. Joriy xabar tarixga qo'shilishidan OLDIN `priorHistory` olinadi (dublikat yo'q).
- **O'zgargan fayllar:** `ai/prompts.js`, `ai/gemini.js`, `bot/bot.js`, `cron/reminders.js`,
  `bot/handlers/callbacks.js` (reschedule tugmasi lastConfirm tozalaydi), `bot/handlers/message.js`.
  `models/Conversation.js` (history/pushHistory/lastConfirm* — o'tgan sessiyada qo'shilgan, endi ulangan).
- **Tekshiruv:** 6 ta o'zgargan backend fayl `node --check` OK; modul-load smoke (message/callbacks/cron/bot/agent)
  barcha yangi importlar resolve OK; offline xulq testi 16/17 (1 "fail" — test stringi noto'g'ri edi, "boshqa"
  tokeni label bilan to'g'ri mos keldi; kod mavjud `matchClarifyOption` xulqiga sodiq).

## 2026-06-24 Responsive shell + barcha yangi yozuvlarga yakuniy tasdiq
- Responsive Mini App shell: `App.jsx` viewport listener bilan desktop/mobile rejimni aniqlaydi; `SidebarNav.jsx` desktop uchun sticky left nav (collapse localStorage), `BottomNav` faqat mobileda render bo'ladi. `Modal` va Home AI panel `useNavigationView` orqali internal back stackga ulandi.
- Bot create flow: `agent.finalizeEntry()` endi bot mode'da `ENTRY_CONFIRM` yaratadi va xulosa + `saveKeyboard()` qaytaradi. `confirmPendingEntry()` tasdiqdan keyin saqlaydi. `message.js` matn/ovoz `ha|saqla|tasdiq` va `yo'q|saqlama|yozma` javoblarini, `callbacks.js` esa `save_yes/save_no` tugmalarini ushlaydi.
- Mini App create flow: yangi `FinalConfirmModal.jsx`; `Clients.jsx`, `Services.jsx`, `Finance.jsx` create `POST`lari avval preview modalga o'tadi. Tasdiqlashsiz APIga yangi mijoz/xizmat/kirim/chiqim yuborilmaydi; edit/patch oqimlari avvalgidek.
- Tekshiruv: `miniapp npm run build` OK (54 modul); backend barcha `*.js` `node --check` OK; `git diff --check` OK. Playwright: 390px mobileda bottom nav va final confirm modal (2 modal, preview rows, column buttons), 1024px desktopda sidebar=true, bottomNav=false, confirm actions row. Vite port 5177 keyin to'xtatildi.

## 2026-06-24 Rate limiting - xarajat nazorati
- `backend/src/bot/mediaLimits.js` qo'shildi: rasm limiti 10 ta/60 soniya, RAM Map counter, 10 daqiqalik bypass (`limitni ochib qo'y`), umumiy reply matnlari va test uchun reset/export helperlari.
- `backend/src/bot/handlers/message.js`: voice `duration > 90` bo'lsa yuklab olish/transkripsiyasiz rad qilinadi; photo handler download/AI'dan oldin limit tekshiradi; media group/albom 1s yig'iladi, >10 bo'lsa butun to'plam rad qilinadi; limitdan o'tgan 11-rasm qancha kutishni aytadi.
- Unsupported media: video uchun alohida iliq javob; document/sticker/animation/video_note uchun umumiy `matn/ovoz/rasm yuboring` javobi.
- Bypass trigger faqat aniq `limitni ochib qo'y` iborasi (case-insensitive string matching); `oka` hech narsani trigger qilmaydi.
- Tekshiruv: media limiter Node REPL self-test OK; backend `src/**/*.js` `node --check` OK; root `npm run build` OK.

## 2026-06-24 Moliya qo'shimcha mantiq + bot shaxsiyati ("oka" ohangi)
- **Aqlli toifalash:** `prompts.js` xarajat toifasini KALIT-SO'Z ro'yxati emas, MAZMUN bo'yicha tanlashga
  yo'naltirildi ("yog' va guruch oldim"→oziq-ovqat, "magazinga ishlatdim"→boshqa_chiqim); toifa/tafsilot so'ralmaydi
  (EXPENSE_ENTRY faqat `amount` talab qiladi), description ixtiyoriy. Server enum'ni downgrade qilmaydi.
  Tasdiqlash: `agent.fallbackResponse` → "Boldi oka, {summa} so'm chiqim qo'shdim ✅ Toifa: {nom}" (`CATEGORY_LABEL`).
- **Soxta CLARIFY tuzatildi:** jonli testda model ravshan xarajatlarni ("yog' va guruch...") yuqori ishonch bilan
  ham `intent=CLARIFY` qaytarardi → bot so'rab qolardi. `agent.resolveClarify`: CLARIFY faqat HAQIQIY 2 tomonlama
  tanlov (`clarifyOptions` 2+ farqli subIntent) yoki past ishonch (<0.7) bo'lsa hurmat qilinadi; aniq subIntent +
  ishonch≥0.7 + fork yo'q bo'lsa so'ramay bajaradi. Jonli e2e: 3 xarajat→PROCEED, "Sardor 300 ming berdi"→CLARIFY ✓.
- **Mini App "📥 Yuklab olish" (Moliya):** Balans ostida tugma → modal: 1) format (PDF/Excel) 2) davr (oxirgi 12 oy
  yoki ixtiyoriy oraliq) → `POST /reports/send` (reportType=finance) backend generatsiya qilib Telegram CHATGA yuboradi
  (Mini App ichida link YO'Q). Xato bo'lsa do'stona xabar + 🔄 Qayta urinish. `reports.js` fayldan keyin samimiy xabar
  yuboradi: "Mana oka, {oy} uchun {format} tayyor bo'ldi. Pastga qarab qo'ying 👇"; oy nomi o'zbekcha (`UZ_MONTHS`).
- **Bot shaxsiyati (global "oka" ohangi):** yagona `prompts.BOT_PERSONA` (yaqin/hurmatli, raqamlar aniq) `gemini.js`
  `formulateToolResponse` + `buildAnswerPrompt`ga ulandi. Barcha statik xabarlar moslandi: `commands.js` (/start,
  /help, /cancel, /pdf), `ui.js` (saqlash/eslatma/tasdiq), `agent.js` (fallback/ask/xato), `callbacks.js`, `message.js`,
  `flow.js` (QUESTIONS). Pul/sana/telefon HAR DOIM aniq va tartibli qoldi.
- **Bonus:** tool ijro biznes xatosi (mas. "xizmat topilmadi") endi umumiy "AI xato" o'rniga aniq do'stona xabar
  sifatida chiqadi (`executeToolFlow` try/catch).
- **Tekshiruv:** backend 48/48 `node --check` OK; modul load OK; jonli NLU e2e (toifalash + CLARIFY) OK;
  `cd miniapp && npm run build` OK.

## 2026-06-24 Yakuniy audit — niyat korreksiyasi + o'lik kod tozalash
- **Edge case (niyat korreksiyasi) — TUZATILDI:** slot-filling o'rtasida AI niyatni xato aniqlasa-yu, foydalanuvchi
  darhol boshqa aniq niyatni aytsa (mas. SERVICE_ENTRY o'rtasida "yo'q, benzinga 50ming"), eski sessiya tashlanib
  yangisiga o'tadi. `agent.js`: `maybeCorrectIntent`/`hasConcreteSignal`/`answersCurrentField` — juda ehtiyotkor gating
  (ishonch ≥0.7, boshqa WRITE amal, o'ziga xos konkret maydon, joriy maydonga sof javob EMAS). `continueEntry` cancel +
  pivot dan keyin tekshiradi → `conversation.reset()` + `runAgent` rekursiya. Offline truth-table 8/8 OK (redirect
  service↔expense ishlaydi; ism/sof narx/sana javoblari korreksiya deb xato olinmaydi).
- **O'lik kod tozalandi:** `styles.css` dan eski reminder UI qoldiqlari olib tashlandi — `.reminder-presets`,
  `.reminder-select(.active)`, `.chip-list`, `.reminder-chip(+button)`, `.failed-reminders` (hech bir JSX ishlatmaydi;
  `.reminder-presets-card` va `.debt-text` ishlatiladi — qoldi). CSS 21.69→20.83 kB.
- **Audit tasdiqlari (kod o'qib):** `gemini.js` yagona `classify_business_input` (intent+subIntent, 7-intent enum yo'q);
  "." trigger yo'q; backend'da `defaultReminders`/`service.reminders[]` qoldig'i yo'q. Lokatsiya bot va Mini App'da bir
  xil `{address,mapUrl}` (`normalizeLocation`/`normalizeLocationInput`). Reschedule (bot+API) `editService`→
  `applyServiceSchedule` eski jadvalni bekor + qayta hisoblaydi. done→bekor_qilindi `cancelService.reverseIncome`
  income tx'ni soft-delete qiladi. reminderAt o'tgan bo'lsa `reminderSent=true` (xatosiz, faqat confirm). Confirm/eslatma
  cron har xizmatga ALOHIDA `confirmServiceKeyboard(service._id)` — callback data serviceId aniq.
- **Tekshiruv:** backend 48/48 `node --check` OK; `cd miniapp && npm run build` OK (51 modul, CSS kichraydi).

## 2026-06-24 Prompt 3-4 verifikatsiya — eslatma/tasdiq + lokatsiya spec'ga to'liq mos
- **Eslatma/tasdiq (Prompt 3):** to'liq spec'ga mos tasdiqlandi. `confirmServiceKeyboard` = [✅ Bajarildi][❌ Bekor qilindi]
  [📅 Vaqt surildi]; `serviceReminderText` (tugmasiz, `⏰ {kun} soat {HH:mm}da {ism}ga borish kerak / 📍 manzil 💰 narx so'm`),
  `serviceConfirmText` (`❓ Bu xizmat bajarildimi?` + 👤📱 / 📍💰). Callbacklar: `complete_`→income+balans,
  `cancel_direct_`→balansga ta'sir yo'q (sabab so'ralmaydi), `reschedule_`→"Qachonga surildi? Matn yoki ovoz orqali ayting".
  Reschedule javobi `message.routeServiceReschedule` (matn/ovoz, `parseHumanDateTime`) → `editService` →
  `applyServiceSchedule` reminderAt/confirmAt'ni QAYTA hisoblaydi, `*Sent` nollanadi (eski jadval bekor). Tarixiy xizmat:
  jadval yo'q, darhol `bajarildi`. Cron har xizmatga alohida xabar + atomar claim (ikki marta yubormaydi).
- **Lokatsiya (Prompt 4):** DB `{address, mapUrl}`. Bot: matn/ovoz→`{address,mapUrl:null}`, pin→Nominatim→tasdiq.
  Mini App 2 maydon: `common.locationName` (Manzil nomi) + `common.mapUrl` (ixtiyoriy, placeholder, `shouldWarnMapUrl`
  yumshoq ogohlantirish). Ko'rsatish: `LocationDisplay`/`ServiceDetailModal` → 📍address + xavfsiz [Xaritada ochish].
  Tahrir: status'dan qat'i nazar ikkala maydon alohida tahrirlanadi (`updateClient`/`editService` mapUrl saqlaydi).
- **Kichik UX tuzatish:** xizmat yaratuvchi 2 formaga (`Clients` ClientForm, `Services` ServiceForm) mijoz tomonida
  `Manzil nomi` majburiy guard qo'shildi (`common.locationRequired` uz/ru) — eski xom backend "Manzil kerak" 400 alert
  o'rniga darhol do'stona xabar. Edit-client formasi tegilmadi (u yerda manzil ixtiyoriy).
- **Tekshiruv:** backend 48/48 `node --check` OK (o'zgarmadi); `cd miniapp && npm run build` OK (51 modul).

## 2026-06-24 Goal verifikatsiya — 3-intent + eslatma + lokatsiya to'liq tekshirildi
- Goal (3 toifali niyat aniqlash + eski mantiqni olib tashlash) bo'yicha butun kod qayta o'qib chiqildi va
  amalda bajarilgani tasdiqlandi: `intents.js` (HIGH/SUB + CONFIDENCE_THRESHOLD=0.7), `prompts.js` (STEP1 high-level
  MOLIYA|MIJOZ|SUXBAT, STEP2 subIntent, STEP3 CLARIFY+clarifyOptions), `agent.js` (resolveClarify past-ishonch to'ri,
  maybePivot SUXBAT pivoti, resolveAction orqaga-moslik).
- Eski mantiq runtime koddan yo'qligi qayta tasdiqlandi: "." nuqta-niyat belgisi yo'q; `defaultReminders`/
  `service.reminders[]`/`parseReminderOffset`/`scheduleRemindersForService`/`awaitingReminderConfig` faqat eski
  changelog matnida qoldi, kodda emas. Reminder oqimi to'liq `reminderAt/confirmAt` (Settings 3/3, 1..168) +
  atomar `*Sent` claim; serviceService create/reschedule va deleteService restore `applyServiceSchedule` chaqiradi.
- Lokatsiya DB formati `{address,mapUrl}`; Mini App `mapUrl.js` yumshoq warning + `LocationDisplay` xavfsiz havola.
  Settings route ikkala soatni 1..168 validatsiya qiladi; flow.ENTRY_REQUIRED tartibi ism→tel→manzil→sana→narx→to'lov.
- Doc tuzatish: `AI_CONTEXT.md` "current state" snapshotidagi eskirgan faktlar yangilandi (7 niyat→3 high-level+subIntent,
  Gemini 1.5-flash→gemini-2.5-flash-lite, agent.js routeri tavsifi, intents.js qo'shildi).
- Tekshiruv: backend 48/48 fayl `node --check` OK; `cd miniapp && npm run build` OK (51 modul).

## 2026-06-23 Prompt 3-4 reminder/location yakunlandi
- 3 high-level intent oqimi mustahkamlandi: past confidence (<0.7) barcha high-level natijada CLARIFY; write high-level intent subIntent bermasa default yozuv qilmaydi. Eski `maybeRouteFuzzyClientPayment` olib tashlandi, shuning uchun "Sardor 300 ming berdi" Gemini CLARIFY qoidasini chetlab o'tmaydi.
- Eski ko'p qatlamli reminder runtime oqimi olib tashlandi: `defaultReminders`, `service.reminders[]` retry/delete endpointlari, failed-reminder Home banneri, restore'dagi `computeReminders` qoldig'i yo'q.
- Yangi jadval: `Settings.reminderHoursBefore/confirmHoursAfter` default 3; Mini App ikkalasini alohida sozlaydi. Service `reminderAt/confirmAt` maydonlari cron orqali atomar yuboriladi.
- Lokatsiya: DB formati `{address,mapUrl}`; Mini App manzil nomi + ixtiyoriy mapUrl beradi, noaniq havolada warning chiqadi, detail/client modal xavfsiz `Xaritada ochish` linkini ko'rsatadi.
- Tekshiruv: barcha backend `backend/src/**/*.js` fayllari `node --check` OK; asosiy runtime importlar OK; mapUrl smoke test OK; `npm run build` OK; eski reminder runtime va DB `coordinates` qidiruvi kodda toza.

## 2026-06-23 Yangi niyat aniqlash: 3 high-level intent (MOLIYA/MIJOZ/SUXBAT) + CLARIFY (1/5-prompt)
- **Maqsad (1-bosqich):** AI har xabarni belgisiz/komandasiz, mazmundan 3 asosiy niyatga ajratadi:
  MOLIYA (kirim/chiqim/to'lov), MIJOZ (xizmat/mijoz tahriri/status), SUXBAT (qidiruv/analitika/gap).
  Ishonch past yoki 2 niyatga teng mos bo'lsa — taxmin qilmay CLARIFY (aniqlashtiruvchi savol + tezkor tugmalar).
- **Arxitektura (ikki qatlam):** Gemini endi `intent` (high-level: MOLIYA|MIJOZ|SUXBAT|CLARIFY) **va**
  `subIntent` (aniq amal: SERVICE_ENTRY/SERVICE_EDIT/CLIENT_EDIT/STATUS_UPDATE/EXPENSE_ENTRY/INCOME_ENTRY/
  PAYMENT_UPDATE/SEARCH_QUERY/ANALYTICS_QUERY) qaytaradi. subIntent mavjud ishonchli agent ijro qatlamini
  (slot-filling, edit, payment, tools) buzilmasdan boshqaradi. Yagona manba: yangi `backend/src/ai/intents.js`.
- **CLARIFY oqimi:** `agent.startClarify` conversationga `pendingIntent='CLARIFY'` + `{rawText, fields, options}`
  yozadi; `ui.clarifyKeyboard` → `clarify_0/clarify_1/...` + `clarify_cancel`; `callbacks.js` tugma bosilganda
  saqlangan matn/maydonlar bilan tanlangan subIntentni `runAgent` orqali davom ettiradi. Gemini clarifyOptions
  bermasa — mazmunli zaxira tugmalar. Past-ishonchli (`<0.7`) barcha high-level natijalar uchun server xavfsizlik to'ri ham CLARIFY qiladi.
- **SUXBAT pivoti:** slot-filling o'rtasida savol berilsa (`agent.maybePivot`) — javob beriladi, keyin to'xtagan
  maydon qayta so'raladi; sessiya yo'qolmaydi. Erkin matnli maydon (ism/manzil) faqat aniq savolda pivot bo'ladi.
- **MIJOZ maydon tartibi:** `flow.ENTRY_REQUIRED.SERVICE_ENTRY` endi **ism → tel → manzil → sana → narx → to'lov**
  (oldin tel birinchi edi). Lokatsiya oqimi (callbacks) ham qattiq `clientPhone` o'rniga `nextMissing` ishlatadi (ism birinchi).
- **Analitika regressiyasini oldini olish:** "bu oyda qancha topdim" SUXBAT bo'ladi; subIntent SEARCH_QUERY chiqsa ham
  `analyticsMetric/analyticsPeriod` signali bo'lsa routing get_analytics'ga o'tadi (prompt + agent ikki qavat himoya).
- **"." (nuqta) niyat belgisi:** kodda topilmadi (allaqachon yo'q) — olib tashlash shart bo'lmadi.
- **O'zgargan fayllar:** `ai/intents.js`(yangi), `ai/prompts.js`, `ai/gemini.js`, `ai/agent.js`, `bot/flow.js`,
  `bot/ui.js`, `bot/handlers/callbacks.js`, `routes/ai.js`. Mini App o'zgarmadi (javob orqaga-mos, `subIntent` qo'shildi).
- **Tekshiruv:** `node --check` 9 fayl OK; offline xulq-atvor testi 27/27 OK (CLARIFY/ism-birinchi/past-ishonch/legacy
  sub-intent); **real Gemini e2e** (`gemini-2.5-flash-lite`): SERVICE_ENTRY 0.98, EXPENSE 0.95, ANALYTICS 0.95,
  SEARCH 0.9, "Sardor 300 ming berdi"→CLARIFY (2 tugma), STATUS_UPDATE/SERVICE_EDIT to'g'ri.
- **Eslatma/lokatsiya promptlari:** joriy qilindi. Runtime kodda `defaultReminders`/`service.reminders[]` eski oqimi qolmadi; Mini App lokatsiyasi 2 maydon.

## 2026-06-23 "salom" hali ham xato — SEARCH_QUERY crash + Gemini 503 resilience
- Model fixi (gemini-2.5-flash-lite) dan keyin ham botda "salom" "AI bilan bog'lanishda xatolik" berardi.
  Jonli `/api/v1/ai/chat` (bot token bilan imzolangan initData orqali) test qilib aniqlandi: "salom" ->
  SEARCH_QUERY -> `searchAgentData`. `listClients`/`listTransactions` sahifasiz ham `{items}` obyekt qaytaradi
  (massiv qaytaruvchi shox dead-code: `Math.max(1, page)`), shuning uchun `.filter`/`.slice` "is not a function"
  -> 500 -> umumiy AI xato. Batafsil gotcha: memory `list-service-return-shape`.
- Tuzatish (`agent.js`): `asArray()` — `searchServices`/`listClients`/`listTransactions` natijasi massivga keltiriladi.
  Route'lar hamon `{items}` obyektni frontendga beradi (o'zgartirilmadi).
- Gemini 503 "high demand" o'tkinchi xatosi: `gemini.js` `generate()` helperi har modelni qisqa backoff bilan
  qayta uriniydi, keyin zaxira modellarga o'tadi: `[primary, gemini-2.5-flash, gemini-2.5-flash-lite, gemini-flash-latest]`.
  6 ta chaqiruv shu orqali ketadi; 4xx (kalit/model) darhol uzatiladi.
  **(2026-06-29 kengaytirildi)** Timeout/abort/tarmoq xatosi (HTTP status'siz, mas. "This operation was aborted")
  ham endi zaxira modelga o'tadi — eski kodda `status` yo'qligi sabab darhol throw bo'lib egaga xato chiqarar edi.
  Yangi `classifyGeminiError`: abort/tarmoq → `'fallthrough'` (shu modelni tashlab keyingisiga), 429/5xx → `'retry'`,
  boshqa 4xx → `'fatal'`.
- Tekshirildi: lokal e2e (DB+Gemini) salom 5/5 OK; jonli deploy salom 4/5 OK (5-chi Railway 502 infra blip, AI emas),
  Sardor/analytics 200. Commitlar: `04945cb` (asArray+retry), `941e061` (model fallback). Faqat `agent.js`+`gemini.js`
  push qilindi (multi-user/redesign WIP aralashtirilmadi).

## 2026-06-23 Mini App premium redesign
- Promptdagi dizayn paketi `_design_extracted/design_handoff_miniapp_redesign` oqildi; HTML referens lokal server orqali brauzerda ochildi.
- Mini App file structure saqlandi; asosiy ozgarishlar `miniapp/src/styles.css`, `Home.jsx`, `Clients.jsx`, `Services.jsx`, `Finance.jsx`, `Settings.jsx`, `i18n/uz.js`, `i18n/ru.js`. Yangi dependency qoshilmadi.
- Home/Services/Finance/Settings va yangi mijoz bottom-sheet README bolim 4 spetsifikatsiyasiga yaqinlashtirildi; light default + Settings orqali dark toggle ishlaydi (`data-theme=dark` tekshirildi).
- Services `Bugun` segmenti endi bugungi sana oraligini soraydi; Home bugungi xizmat checkboxi mavjud complete APIni chaqiradi.
- Tekshiruv: `npm run build` OK; Playwright production build static serverda Home, Services, Finance, Settings, Add Client modal, mobile/desktop screenshots tekshirildi. Backend ishlamagani uchun `Failed to fetch` banneri kutilgan, runtime UI crash kuzatilmadi.

## 2026-06-23 Multi-user Telegram allowlist
- `OWNER_TELEGRAM_ID` endi comma-separated allowlist: `6028715926,606578823`. Railway Variables'da shu formatda yozilsa, shu ID egalari bot va Mini Appdan foydalana oladi.
- O'zgargan joylar: `backend/src/config/env.js`, `backend/src/bot/bot.js`, `backend/src/middleware/auth.js`, `backend/src/models/Settings.js`, `backend/src/routes/settings.js`, `backend/src/middleware/deleteCode.js`, `backend/src/bot/handlers/commands.js`, `backend/src/cron/reminders.js`, `backend/src/routes/reports.js`.
- Settings/delete-code endi so'rov yuborgan Telegram user bo'yicha olinadi. Eslatmalar barcha allowlist IDlarga ketadi; Mini Appdan "hisobotni botga yuborish" faqat so'rov yuborgan userga ketadi.
- README va `backend/.env.example` yangi format bilan yangilandi.


> Oxirgi yangilanish: 2026-06-23.

## 2026-06-23 AI ishlamasligi — 2 ta sabab: kalit typo + to'xtatilgan model + Mini App fullscreen
- **1-sabab (kalit typo):** `GEMINI_API_KEY` dastlab `PAQ.Ab8R...` edi -> Gemini API `400 API_KEY_INVALID`.
  Aslida to'g'ri kalit `AQ.Ab8R...` (yangi Google kalit formati; eski format `AIza...`). User boshidagi ortiqcha
  "P" harfini olib tashlagach kalit VALID bo'ldi (ListModels 200 qaytardi).
- **2-sabab (asosiy, isbotlangan):** `GEMINI_MODEL=gemini-2.0-flash` Google tomonidan TO'XTATILGAN ->
  generateContent `404 "This model ... is no longer available"`. `gemini-2.0-flash-001` ham 404. Shu sabab kalit
  to'g'ri bo'lsa ham matn/ovoz ishlamasdi. Build loglar toza edi (xato runtime'da). Jonli tekshiruv: ListModels
  bilan `gemini-2.5-flash-lite` 3/3 marta `200` (to'g'ri o'zbekcha javob); loyiha kodi (`understandText` +
  function calling) real kalit+yangi model bilan SERVICE_ENTRY'ni to'liq ajratdi, "salom" -> do'stona javob.
- **Tuzatish:** Model `gemini-2.5-flash-lite` ga o'tkazildi (`.env`, `.env.example`, `env.js` + `gemini.js`
  defaultlari). `env.js`ga `RETIRED_MODEL_MAP` qo'shildi: Railway'da eski `gemini-2.0-flash` qolib ketsa ham
  avtomatik `gemini-2.5-flash-lite` ga moslanadi (startup warning bilan). **USER HARAKATI (ixtiyoriy):** Railway
  Variables'da `GEMINI_MODEL` ni `gemini-2.5-flash-lite` ga yangilang yoki o'sha o'zgaruvchini o'chiring (auto-remap baribir ishlaydi).
- **Kod mustahkamlandi (diagnostika ko'rinadigan bo'ldi):**
  - `env.js`: `GEMINI_API_KEY` `AIza...` formatiga mos kelmasa startup warning beradi; `miniAppUrl()` helper qo'shildi
    (MINIAPP_URL bo'lmasa Railway public domenni ishlatadi).
  - `bot/handlers/message.js`: `isAiKeyError()` + `replyAiError()` — kalit/kvota/auth xatosida endi egaga aniq
    "GEMINI_API_KEY noto'g'ri ... aistudio.google.com/apikey" deb yozadi (4 handler: matn/ovoz/audio/rasm).
- **Mini App fullscreen (MENU tugmasi):**
  - `index.js`: `setupMenuButton()` — Telegram chat MENU tugmasini Mini App web_app'ga ulaydi (`miniAppUrl()`).
  - `miniapp/src/telegram.js`: `requestFullscreen()` (Bot API 8.0+, `isVersionAtLeast` guard) + `disableVerticalSwipes` +
    xavfsiz zona insetlari (`--tg-safe-top` CSS var, fullscreen/safeArea event'larida yangilanadi). Eski klientda `expand()`.
  - `miniapp/src/styles.css`: `.app` padding-top `calc(12px + var(--tg-safe-top))` — fullscreen'da kontent status bar ostiga tushmaydi.
  - `commands.js`: inline "Panelni ochish" ham `miniAppUrl()` fallback ishlatadi.
- Tekshirildi: `node --check` (env/index/message/commands/gemini) OK; `npm run build` (miniapp) OK; loyiha
  kodi orqali real NLU e2e test (`understandText` + function calling, `gemini-2.5-flash-lite`) = ISHLAYDI ✓.
  Eslatma: `env.js` kalit-format ogohlantirishi endi `AIza...` va `AQ....` ikkala formatni qabul qiladi.


## 2026-06-22 Bot Railway'da javob bermaslik — resilient polling fix
- Jonli Telegram diagnostikasi: token ✓ (`@Musor_yoq_bot`), webhook bo'sh, Atlas Mongo ✓ ulanadi.
  Lokal poll qilinganda Railway poller bilan real `409 Conflict` chiqdi -> Railway tirik, env/Mongo joyida.
- Ildiz sabab: public domain yo'q -> polling rejimi; eski `bot.start().catch()` bitta 409da pollingni butunlay
  o'chirardi (redeploy overlap yoki tashqi poller = bot o'lik). `backend/src/index.js`ga
  `startPollingResilient()` qo'shildi: 409/conflictda 5s interval bilan qayta uriniladi (max 30), muvaffaqiyatli
  startda hisoblagich nollanadi; `runtime.bot` haqiqiy holatga moslandi. Webhook auto-switch saqlanib qoldi.
- Tekshirildi: `node --check` (index/env/bot) OK; 2 lokal instance bilan real 409 -> qayta urinish -> tiklanish;
  1 instance toza polling (`bot:true`, warnings bo'sh); `npm run build` OK.
- USER UCHUN: redeploydan keyin bot o'zi tiklanadi. Maksimal ishonch uchun Railway service'ga public domain
  generate qiling (kod webhookga o'tadi, 409 umuman bo'lmaydi) va shu tokenni faqat BITTA service polling qilsin.
  Railway Variables to'liq bo'lsin: `BOT_TOKEN`, `OWNER_TELEGRAM_ID=6028715926`, `MONGODB_URI` (Atlas), `GEMINI_API_KEY`.

## 2026-06-22 Railway bot /start diagnostikasi
- `backend/src/config/env.js` `dotenv`ni endi `backend/.env` absolute path bilan yuklaydi; root workspace'dan ishlatilganda ham lokal env yo'qolmaydi.
- Env validator `BOT_TOKEN`, `OWNER_TELEGRAM_ID`, `MONGODB_URI`, placeholder `GEMINI_API_KEY`, va webhook URL formatlarini aniq tekshiradi.
- `backend/src/bot/bot.js` owner guard: `OWNER_TELEGRAM_ID` noto'g'ri bo'lsa `/start` endi butunlay jim qolmaydi, "Railway'da OWNER_TELEGRAM_ID ni tekshiring" deb javob beradi; boshqa access baribir bloklanadi.
- Tekshiruv: `node --check backend/src/config/env.js`, `node --check backend/src/bot/bot.js`, `npm.cmd run build`, real Mongo connect, va Telegram `getMe/getWebhookInfo` OK. Telegram webhook URL hozir bo'sh, ya'ni deploy polling rejimiga tayangan yoki Railway webhook hali set qilmagan.

## 2026-06-22 To'liq audit (KRITIK/MUHIM/KICHIK) — FIXLOG.md
Batafsil: `FIXLOG.md`. Asosiy o'zgarishlar (hammasi syntax + import + miniapp build bilan tekshirildi):
- KRITIK: `clients.phone` partial unique index (`isDeleted:false`) + startup `Client.syncIndexes()` (eski `phone_1` ni almashtiradi); initData'ga `auth_date` muddati + `timingSafeEqual`; failed eslatmalar Mini App'da (`/stats/home` + retry endpoint + Home banner); reminder cron umumiy `withReminderLock`. ("Bajarildi" yagona `completeService` — tekshirildi, dublikat yo'q.)
- MUHIM: bog'langan income `amount` to'g'ridan tahrirlash bloklandi (desync); OCR bitta yozuv majburiy maydon yetishsa SERVICE_ENTRY so'rash oqimiga ulanadi (save_yes + matn "ha"); universal "bekor" + session/conv stale holat tozalash; mijoz tiklashda xizmat sana/narx tahrirlash; `parseHumanDateTime` (reschedule nisbiy sana) + `parseMoney` "yarim mln"; ovoz disambiguation (`maybeDisambiguate` + `pick_client_`).
- KICHIK: Kanban mobil "✅ Bajarildi" tugmasi (drag touch'da ishlamaydi); Excel uz/ru lokalizatsiya; `/kod` bot komandasi (delete code recovery, owner-only). (SSE va tema — tekshirildi, muammo yo'q.)

## 2026-06-22 Ikkinchi audit tuzatishlari
- `FIXLOG.md` topilmadi; `CODEX_FIXLOG.md` yangi yaratildi.
- Pul/race: `completeService()` atomik guard bilan mustahkamlandi, double-click duplicate income transaction yaratmaydi.
- Konsistensiya: service soft-delete linked income transactionni ham o'chiradi; completed service price retry income amountni yangilaydi.
- Soft-delete/unique: deleted client telefoni qayta ishlatilsa client tiklanadi; active duplicate phone update 409.
- Validatsiya/error: service/finance sanalar va summalar, phone/location tekshiruvi kuchaydi; Cast/Validation/Duplicate errors 400/409.
- External API: Telegram file/image fetch timeoutlari, SSE AI search error event fallback qo'shildi.

## 2026-06-22 Gemini model 2.0 update
- `backend/.env` lokal model qiymati `gemini-2.0-flash` ga almashtirildi.
- GitHubga push qilinadigan defaultlar ham moslandi: `backend/.env.example`, runtime fallbacklar,
  README va agent kontekst fayllari endi `gemini-2.0-flash` ni ko'rsatadi.

## 2026-06-21 Railway diagnostika startup fix
- Yangi loglar o'qildi: `MONGODB_URI` hali ham yo'q. So'nggi kod xabarlari logda ko'ringani uchun bu code alias emas, Railway Variables/link muammosi.
- `backend/src/index.js` endi env/DB tayyor bo'lmasa process exit qilmaydi: Express start bo'ladi, `/health` authsiz diagnostika qaytaradi, API esa tayyor bo'lmaguncha 503 beradi.
- `startRuntime()` env check -> Mongo connect -> bot dynamic import -> webhook/polling -> cron tartibida ishlaydi. Bot static import olib tashlandi, shuning uchun env yetishmasa import vaqtida crash bo'lmaydi.
- `/api/v1` mount tartibi tuzatildi: `/api/v1` `/api`dan oldin gate qilinadi.
- `env.js` `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_PUBLIC_URL`, `PUBLIC_URL`, `APP_URL` ni public domain sifatida qabul qiladi; production + domain bo'lsa default `BOT_MODE=webhook`.
- README va `.env.example` Railway domain aliaslari va `/health` troubleshooting bilan yangilandi.
- Tekshiruv: `node --check backend/src/config/env.js`, `node --check backend/src/index.js`, `node --check backend/src/bot/bot.js`, missing-Mongo `/health` smoke test, va `npm run build` OK.
- User bajarishi kerak bo'lgan ish: Railway app service Variables bo'limida Mongo qiymatini ulash. Eng oson variant `MONGODB_URI=${{MongoDB.MONGO_URL}}` yoki Atlas/Railway real Mongo URL.

## 2026-06-21 Railway Mongo parts fix
- Yangi pasted loglar o'qildi: deploy so'nggi `XATO` xabarini chiqarayotganiga qarab `316297d` ishlayapti, lekin Mongo env hali topilmayapti.
- `backend/src/config/env.js` kengaytirildi: `MONGO_PUBLIC_URL`, `MONGODB_URL`, `MONGODB_PRIVATE_URL`, `MONGODB_PUBLIC_URL` aliaslari qo'shildi.
- To'liq Mongo URL bo'lmasa, `MONGOUSER`/`MONGOPASSWORD`/`MONGOHOST`/`MONGOPORT`/`MONGODATABASE` va shunga yaqin env nomlaridan connection string avtomatik yig'iladi.
- `backend/.env.example` va `README.md` yangi qo'llab-quvvatlanadigan Railway Mongo variantlari bilan yangilandi.
- Tekshiruv: `node --check backend/src/config/env.js`, `node --check backend/src/index.js`, runtime full-URL alias testi, runtime parts-to-URL testi, va root `npm run build` OK.
- Agar bundan keyin ham Railway log `MONGODB_URI` missing desa, kod tomondan emas: Railway Variables ichida Mongo qiymatlari app servicega ulanmagan. User Railway UI'da MongoDB service qo'shib/link qilib, app service Variables'da `MONGODB_URI=${{MongoDB.MONGO_URL}}` yoki haqiqiy Mongo URL kiritishi kerak.

## 2026-06-21 Railway MONGODB_URI runtime fix
- Pasted Railway log tahlil qilindi: konteyner start bo'lmoqda, lekin backend `MONGODB_URI` topilmagani uchun `validateEnv()` ichida chiqib ketyapti.
- `backend/src/config/env.js` Mongo connection stringni `MONGODB_URI`, `MONGO_URL`, `MONGO_PRIVATE_URL`, yoki mongodb bilan boshlanadigan `DATABASE_URL` dan oladi.
- Mongo env topilmasa xato xabari endi qaysi aliaslar qabul qilinishini aniq ko'rsatadi; emoji loglar olib tashlandi.
- `backend/src/db/connect.js` MongoDB loglari ASCII formatga o'tkazildi.
- `backend/.env.example` va `README.md` Railway Mongo aliaslari bilan yangilandi.
- Tekshiruv: `node --check backend/src/config/env.js`, `node --check backend/src/db/connect.js`, `node --check backend/src/index.js`, runtime `MONGO_URL` alias testi, va root `npm run build` muvaffaqiyatli.

## 2026-06-21 ExcelJS/data-delete prompt bajarildi
- Backendga `exceljs` dependency qo'shildi.
- `POST /reports/excel` endi haqiqiy `.xlsx` qaytaradi: `musir_yoq_eksport.xlsx`.
- Excel workbook 4 sheetdan iborat: `Mijozlar`, `Xizmatlar`, `Tranzaksiyalar`, `Xulosa`; header style,
  frozen first row, auto-width va oylik breakdown bor.
- `POST /reports/send` `{ format: "excel" }` bilan xlsx bufferni `bot.api.sendDocument` orqali egaga yuboradi.
- Mini App `.xls` nomlari `.xlsx`ga almashtirildi; Settings `Botga yuborish` endi Excel backupni yuboradi.
- Xavfli zona bulk delete Mini Appdan promptdagi contractga mos `POST /data/delete` `{ target, code }` chaqiradi.
- `ConfirmDeleteModal` o'chirishdan oldin backup savolini ko'rsatadi: `Ha, PDF olaman` yoki
  `Yo'q, to'g'ridan o'chirish`; keyin 4 xonali PIN kiritiladi.
- `PUT /settings/change-code` xatosi promptdagi aniq matnga moslandi:
  `Yangi kod 4 ta raqamdan iborat bo'lishi kerak`.
- Tekshiruv: `node --check` reports/data/settings OK; `reports.js` import OK; ExcelJS smoke test OK;
  `miniapp npm run build` OK.

## 2026-06-21 callback/reminder/PDF prompt bajarildi
- `backend/src/bot/handlers/callbacks.js`: `cancel_` endi darhol bekor qilmaydi, avval "Bekor qilasizmi?"
  deb `cancelConfirmKeyboard()` chiqaradi; haqiqiy bekor qilish `cancel_confirm_` orqali ishlaydi.
- `not_done_` oqimidagi `Uzaytirish` tugmasi `snooze_` callbackga ulanadi; `snooze_` va `reschedule_` ikkalasi
  `session.awaitingReschedule` va `Conversation.pendingIntent=SERVICE_RESCHEDULE` qo'yib, yangi sana/vaqt so'raydi.
- `disable_reminder_` qo'shildi (`mute_` aliasi bilan): service.reminders ichidan faqat `sent:false` lar o'chiriladi,
  yuborilganlari saqlanadi.
- `backend/src/services/reminderService.js`: reminder obyektlari endi `failed`, `retryCount`, `nextRetryAt` bilan
  yaratiladi; custom offset `0` qabul qilinadi; `scheduleRemindersForService()` helperi eksport qilindi.
- `backend/src/routes/reports.js` + `backend/src/utils/pdf.js`: PDF xulosasi `Jami kirim / Jami chiqim / Balans`
  ko'rsatadi; report summary income/expense/balance ni transactionlardan hisoblaydi; PDF jadval ranglari kuchaytirildi.
- Tekshiruv: changed backend fayllar `node --check` OK; `node -e import('./backend/src/bot/handlers/callbacks.js')`
  OK; minimal `createReportDoc()` smoke test `pdf ok`; `miniapp npm run build` OK.

## 2026-06-21 pages 4-6 davom ettirildi
- `miniapp/src/pages/Reports.jsx` qayta yig'ildi: type segment (`Mijozlar`/`Moliya`/`To'liq`), custom date range,
  `So'nggi N ta`, month picker, PDF download, Excel download, `Botga yuborish`.
- `backend/src/routes/reports.js` kuchaytirildi: umumiy PDF/Excel payload helperlari, Excel type filter,
  `POST /reports/send` orqali PDF yoki Excelni Telegram botga yuborish. `backend/src/index.js` `attachReportBot(bot)`
  bilan routerni bot instancega ulaydi.
- `miniapp/src/pages/Settings.jsx` bo'limlarga ajratildi: Ko'rinish, Eslatmalar, Xavfsizlik, Ma'lumot eksport,
  Xavfli zona, Tiklash. Export PDF/Excel/Bot; mijoz restore modalida related services checkbox bilan tanlanadi.
- `miniapp/src/styles.css` va `miniapp/src/i18n/uz.js` yangi UI kalitlari/klasslari bilan yangilandi.
- Tekshiruv: `cd miniapp && npm run build` OK; `node --check backend/src/routes/reports.js` OK;
  `node --check backend/src/index.js` OK. Vite `http://127.0.0.1:5175` da ochildi, Playwright Reports/Settings
  renderini tekshirdi. Backend dev server yoqilmagani uchun browserda `Failed to fetch` banner kutilgan holat.

## 2026-06-20 Mini App UI update
- Home: debounced client search, QuickStatsRow, floating AI button, SSE AI chat panel, AI result service detail.
- Clients: add client modal, ClientCard with last service/debt/deleted badges, detail bottom sheet, service history.
- Services: Kanban drag complete confirmation, list filters, expandable cards, complete/reschedule/cancel/edit/delete modals.
- Validation: `cd miniapp && npm run build` passed.

## 2026-06-20 bajarilgan ish
- REST API ENDPOINTLARI prompt bajarildi: router `/api` bilan birga `/api/v1` ostida ham mount qilindi.
- Clients contract qo'shildi: `page/limit`, `GET /clients/deleted`, restore preview (`POST /clients/:id/restore`), restore confirm (`POST /clients/:id/restore/confirm`), detail ichida `paymentHistory`.
- Services contract qo'shildi: `GET /services/upcoming`, `PATCH /services/:id/reschedule`, `PATCH /services/:id/complete` endi `{ service, transaction }` qaytaradi; list `page/limit` qabul qiladi.
- Transactions contract qo'shildi: `GET /transactions/balance`, `dateFrom/dateTo/category/page/limit` filterlari, expense category keyword auto-detect.
- Analytics contract qo'shildi: `GET /analytics/dashboard`, `/analytics/monthly`, `/analytics/clients`.
- Settings contract qo'shildi: `PUT /settings/change-code`, faqat 4 raqamli yangi kod.
- Reports/Data contract qo'shildi: `POST /reports/excel` Excel-compatible `.xls` XML eksport; `POST /data/restore` `{ collection, ids }` bilan ishlaydi.

## 2026-06-20 oldingi schema ishi
- MONGODB SXEMALARI + REST API prompt bajarildi: `Client`, `Service`, `Transaction`, `Settings` modellar promptdagi field/index maqsadlariga moslandi.
- `Client.totalDebt` olib tashlangan holda `isDeletedByClientDeletion` qo'shildi.
- `Service` schema kuchaytirildi: `price >= 0`, `paymentMethod` required, Telegram-only image (`telegramFileId`), cancellation/completion prompt fields, reminder retry fields (`failed`, `retryCount`, `nextRetryAt`).
- `Transaction` schema yangi enumlarga o'tdi: `xizmat`, `boshqa_kirim`, `yoqilgi`, `tamirlash`, `oziq-ovqat`, `boshqa_chiqim`; active field `description`, eski active `note/paymentMethod/clientId` olib tashlandi.
- `Settings.deleteCode` joriy field bo'ldi; `confirmDeleteCode` faqat virtual compatibility alias. Delete API tekshiruvi Settings kodini ishlatadi.
- Finance REST/API va Mini App transaction form/list `description` va yangi category enumlari bilan moslandi.
- Active REST/delete/restore oqimidan `DebtPayment/debtPayments` chiqarildi; model fayli o'chirilmagan, lekin active API/balance ishlatmaydi.

## 2026-06-20 oldingi master context ishi
- Pasted master context bajarildi: faol scope 2 modulga tekislandi: mijoz/xizmatlar va yagona balansli moliya.
- Moliya qoidasi: `balance = sum(Transaction income) - sum(Transaction expense)`.
- Kirim manbalari: xizmat `bajarildi` bo'lganda linked income transaction va qo'lda kiritilgan boshqa income.
- Chiqim manbalari: fuel/repair/food/other expense transaction.
- Alohida qarz yoki to'lov ledgeri faol emas. Xizmat ichida faqat `paymentStatus` va `paidAmount` bor.
- `record_payment` AI/bot compatibility tool nomi saqlandi, lekin endi yangi kirim yozmaydi; `recordServicePayment()` orqali xizmat to'lov holatini yangilaydi.
- `Client.totalDebt`, active debt UI labels, `/api/finance/debts` public route, and old debt transaction mixing active oqimdan olib tashlandi.
- PDF/report summary `totalDebt` o'rniga `unpaidTotal` ishlatadi.
- `README.md` va `AI_CONTEXT.md` yangi qoidalar bilan yangilandi.

## Tekshiruv
- Backend syntax: `node --check` o'zgargan backend fayllarda o'tdi.
- Mini App build: `cd miniapp && npm run build` muvaffaqiyatli.
- `rg` bo'yicha qolgan `debt/qarz` izlari faqat: yangi qoida matni, NLU misoli (`qarzini berdi` -> paymentStatus update), yoki legacy cleanup compatibility.

## Keyingi prompt uchun eslatma
- Foydalanuvchi keyingi prompt BALANS HISOBLASH haqida bo'lishini aytdi.
- Yangi qoidalarni `backend/src/services/` ichida markazlashtiring; bot/API/Mini App shu service layerdan foydalanishi kerak.
- Faol balans uchun faqat `Transaction income/expense` ishlatiladi. Mijozdan keyin olingan pul balansga ikkinchi marta kirim bo'lib yozilmasin.

## 2026-06-21 Mini App spec yakuni (5 sahifa kuchaytirildi)
- Bosh sahifa qidiruv natijalari endi bosiladi: mijozga tap → Mijozlar tabiga o'tib ClientDetail ochiladi (App-level `focusClientId`, Home `onOpenClient`, Clients `focusClientId`/`onFocusHandled`).
- Clients `EditClientModal` ga manzil maydoni qo'shildi; backend `updateClient()` endi `location` ni `locations[]` ga create bilan bir xil mantiqda qo'shadi.
- Xizmatlar List ko'rinishida kengaytiriladigan `ServiceCard` ga tezkor amallar qo'shildi: ✅ Bajarildi / 📅 Kechiktirish / ❌ Bekor / ℹ️ Batafsil (kartochkadan to'g'ridan-to'g'ri, modal ochmasdan). `services.detail` i18n kaliti uz/ru ga qo'shildi.
- Tekshiruv: `cd miniapp && npm run build` muvaffaqiyatli; `node --check src/services/clientService.js` o'tdi.

## 2026-06-21 Umumiy komponentlar kuchaytirildi
- `ConfirmDeleteModal`: ogohlantirish ikonasi + 4 xonali PIN (faqat raqam, autofocus); tasdiqlash 4 raqamgacha disabled; noto'g'ri kod → silkinish animatsiyasi + "Noto'g'ri kod ❌" + haptic; to'g'ri kod → onConfirm + medium haptic.
- Tema: `telegram.js` ga `applyTelegramTheme/clearTelegramTheme/onThemeChanged` qo'shildi — WebApp.themeParams strukturaviy CSS var'larga map qilinadi (brend ranglar saqlanadi). `AppContext` 'auto' rejimini qo'llab-quvvatlaydi (Telegram colorScheme + themeParams sinxron, themeChanged kuzatiladi); 'light'/'dark' o'z palitramiz. Settings'ga Avto/Yorug'/Tungi segmenti. Backend `Settings.theme` enum'iga 'auto' qo'shildi, default 'auto'.
- i18n: `confirm`/`ui` namespace'lari (uz+ru); ru.js'dagi buzilgan category qiymatlari ('???????') tuzatildi; ru.js'ga reports/paymentStatus/nav.reports/settings(auto,security,...) qo'shildi. Kartochkalardagi qotirilgan matnlar (O'chirilgan, So'nggi xizmat, Bu xizmatga borilmagan, "ta mijoz") t() ga o'tkazildi.
- Tekshiruv: `npm run build` OK; `node --check` Settings.js/clientService.js OK.

## 2026-06-21 Eslatma scheduler + bildirishnoma formatlari
- `bot/ui.js`: `reminderText` boyitildi — bo'luvchi chiziq + 👤/📱/📍/📅/💰(narx | to'lov) + 📝izoh; minutesBefore===0 → "⏰ XIZMAT VAQTI KELDI!" + "Bajardingizmi? To'lovni oldingizmi?". Yangi `remainingLabel()` ("1 kun"/"2 soat"/"30 daqiqa") va `reminderSnoozeKeyboard()` ([⏳ Eslatmani kechiktir → quick_snooze][🔕 O'chirib qo'y → mute]).
- `cron/reminders.js`: yagona `processReminder()` helper; ASOSIY cron (har daqiqa) vaqti kelgan eslatmalarni yuboradi va retry kutayotganlarni o'tkazib yuboradi; alohida RETRY cron (har 5 daqiqa) nextRetryAt kelganlarni qayta yuboradi. Kechikishlar [5,15,60] daqiqa, 3 urinishdan keyin failed=true. Oddiy eslatmalarga snooze/mute klaviaturasi biriktiriladi.
- `callbacks.js`: `mute_`/`disable_reminder_` — xizmatning yuborilmagan eslatmalarini o'chiradi (boshqa refactor bilan birga: cancel-confirm oqimi, snooze→reschedule, quick_snooze→30 daq).
- Doimiy o'chirish cron (cleanup → purgeOld 30 kun: Transaction/Service/Client) allaqachon spec'ga mos.
- Tekshiruv: `node --check` + runtime import OK; reminderText/keyboard namunalari spec formatida render bo'ldi.
## 2026-06-21 Lokatsiya callback oqimi
- `backend/src/bot/location.js` qo'shildi: koordinata encode/decode, koordinata solishtirish, location normalizatsiya,
  reverse geocode helperlari.
- Location yuborilganda bot endi manzilni darhol yozmaydi: `Ha, to'g'ri` (`loc_confirm_*`) yoki
  `Nomi o'zgartirish` (`loc_rename_*`) tugmalari orqali tasdiqlaydi. Rename javobi text handlerda ushlanadi;
  address o'zgaradi; koordinata faqat tasdiq sessiyasida ishlatiladi, DBga address + mapUrl yoziladi.
- Slot-filling `awaitingField === 'location'` bo'lsa, tasdiqdan keyin `runAgent()` bilan keyingi maydonga davom etadi.
  Suhbatsiz yuborilgan location esa `Bu manzil yangi xizmat uchunmi?` savoliga o'tadi. Eski `use_location` va
  `location_service_yes/no` callbacklari compatibility uchun qoldi.
- Tekshiruv: `node --check` (`message.js`, `callbacks.js`, `ui.js`, `location.js`) OK; `node -e import(...)`
  location/ui va handler modullari uchun OK.

## 2026-06-21 Lokatsiya: reverse geocode kuchaytirildi
- `bot/location.js` `reverseGeocode` endi o'zbekcha qulay formatda qaytaradi (road, neighbourhood, suburb, district, city) — display_name dump o'rniga; 8s timeout (AbortSignal.timeout) va koordinata fallback qo'shildi. Jonli test: (41.31, 69.28) → "Yunusobod Tumani, Qashqar mahalla".
- Lokatsiya oqimi (handler + locationReviewKeyboard + loc_confirm/loc_rename callbacklar + routeLocationRename) parallel tahrirda allaqachon to'liq yozilgan; men kanonik `location.js` ni yagona manba qildim.
- Dublikat fayllar olib tashlandi: `utils/coords.js`, `services/geocode.js` (location.js codec/geocode bor; ui.js+callbacks+message location.js dan import qiladi).
- Saqlash formati spec'ga mos: matn → `{address,mapUrl:null}`; Telegram pin → reverse geocode qilingan `{address,mapUrl:null}`. Coordinates DBga yozilmaydi.
- Tekshiruv: node --check + location.js load/encode/decode/sameCoords/normalize OK; miniapp build OK.

## 2026-06-21 Railway deploy fix
- Railway log sababi: Railpack repo rootini tahlil qilgan, lekin rootda `package.json`/build manifest yo'q edi; shu sabab "could not determine how to build the app" xatosi chiqqan.
- Root `package.json` qo'shildi: `workspaces` (`backend`, `miniapp`), `build` -> Mini App Vite build, `start` -> backend start.
- Root `package-lock.json` yaratildi (`npm install` workspace dependency graph uchun).
- README Railway bo'limi root deploy oqimiga moslandi.
- Tekshiruv: `npm run build` OK; `node --check backend/src/index.js` OK.
- Keyingi Railway build xatosi: Rollup Linux native optional package (`@rollup/rollup-linux-x64-gnu`) root lockfile'da yo'q edi, shuning uchun `vite build` Linux builderda modulni topolmadi.
- Root `package-lock.json` ga `miniapp/node_modules/@rollup/rollup-linux-x64-gnu` qo'shildi.
- Self-check: `npm ci` OK; `npm run build` OK; `node --check backend/src/index.js` OK; Linux dry-run (`npm_config_platform=linux`, `npm_config_arch=x64`, `npm ci --dry-run --ignore-scripts`) `add @rollup/rollup-linux-x64-gnu 4.61.1` ko'rsatdi.
