# SESSION_HANDOFF.md

## 2026-06-23 "salom" hali ham xato — SEARCH_QUERY crash + Gemini 503 resilience
- Model fixi (gemini-2.5-flash-lite) dan keyin ham botda "salom" "AI bilan bog'lanishda xatolik" berardi.
  Jonli `/api/v1/ai/chat` (bot token bilan imzolangan initData orqali) test qilib aniqlandi: "salom" ->
  SEARCH_QUERY -> `searchAgentData`. `listClients`/`listTransactions` sahifasiz ham `{items}` obyekt qaytaradi
  (massiv qaytaruvchi shox dead-code: `Math.max(1, page)`), shuning uchun `.filter`/`.slice` "is not a function"
  -> 500 -> umumiy AI xato. Batafsil gotcha: memory `list-service-return-shape`.
- Tuzatish (`agent.js`): `asArray()` — `searchServices`/`listClients`/`listTransactions` natijasi massivga keltiriladi.
  Route'lar hamon `{items}` obyektni frontendga beradi (o'zgartirilmadi).
- Gemini 503 "high demand" o'tkinchi xatosi: `gemini.js` `generate()` helperi har modelni qisqa backoff bilan
  qayta uriniydi, keyin zaxira modellarga o'tadi: `[primary, gemini-2.5-flash, gemini-flash-latest]`. 6 ta chaqiruv
  shu orqali ketadi; 4xx (kalit/model) darhol uzatiladi.
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
  address o'zgaradi, coordinates saqlanadi.
- Slot-filling `awaitingField === 'location'` bo'lsa, tasdiqdan keyin `runAgent()` bilan keyingi maydonga davom etadi.
  Suhbatsiz yuborilgan location esa `Bu manzil yangi xizmat uchunmi?` savoliga o'tadi. Eski `use_location` va
  `location_service_yes/no` callbacklari compatibility uchun qoldi.
- Tekshiruv: `node --check` (`message.js`, `callbacks.js`, `ui.js`, `location.js`) OK; `node -e import(...)`
  location/ui va handler modullari uchun OK.

## 2026-06-21 Lokatsiya: reverse geocode kuchaytirildi
- `bot/location.js` `reverseGeocode` endi o'zbekcha qulay formatda qaytaradi (road, neighbourhood, suburb, district, city) — display_name dump o'rniga; 8s timeout (AbortSignal.timeout) va koordinata fallback qo'shildi. Jonli test: (41.31, 69.28) → "Yunusobod Tumani, Qashqar mahalla".
- Lokatsiya oqimi (handler + locationReviewKeyboard + loc_confirm/loc_rename callbacklar + routeLocationRename) parallel tahrirda allaqachon to'liq yozilgan; men kanonik `location.js` ni yagona manba qildim.
- Dublikat fayllar olib tashlandi: `utils/coords.js`, `services/geocode.js` (location.js codec/geocode bor; ui.js+callbacks+message location.js dan import qiladi).
- Saqlash formati spec'ga mos: matn → coordinates null; Telegram pin → {address (reverse geocode), coordinates:{lat,lng}} (serviceService.normalizeLocation orqali).
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
