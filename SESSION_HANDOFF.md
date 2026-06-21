# SESSION_HANDOFF.md

> Oxirgi yangilanish: 2026-06-21.

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
