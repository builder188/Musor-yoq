# AI_CONTEXT.md

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
- `Settings`: `telegramUserId`, `language`, `theme`, `deleteCode`, `defaultReminders`; old `confirmDeleteCode` remains only as a virtual compatibility alias.
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
- Intent classification: `gemini-1.5-flash` function calling, tool `classify_business_input`, 7 intentdan aynan bittasi.
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

> Boshqa AI yoki yangi sessiya uchun to'liq kontekst. Oxirgi yangilanish: 2026-06-08.

## Project overview
**Musir Yo'q** — O'zbekistondagi yakka tartibdagi musor olib ketish biznesi egasi uchun
Telegram bot + Mini App. Faqat bitta foydalanuvchi (egasi). Google Gemini AI markaziy aql:
o'zbekcha ovoz/matn/rasmni tushunadi, 7 niyatga ajratadi, maydonlarni chiqaradi, bazani yangilaydi.

## Tech stack
- Backend: Node.js + Express (ESM) · Mongoose/MongoDB · Grammy · Gemini (1.5-flash) · node-cron · PDFKit
- Frontend: React + Vite · Telegram Mini App SDK · Chart.js · i18n (uz to'liq, ru tayyor)

## Folder structure
```
backend/src/
  config/env.js          # env + validateEnv()
  db/connect.js
  models/                # Client, Service, Transaction, Settings, Conversation, softDelete
  ai/                    # gemini.js (multimodal), prompts.js, agent.js (7 intent router)
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
- To'liq backend: modellar, AI agent (7 niyat), bot (ovoz/matn/rasm/lokatsiya), slot-filling,
  REST API, cron (eslatma + tozalash), PDF hisobot, initData auth.
- To'liq Mini App: 5 sahifa, Kanban/List, Chart.js, til/mavzu, xavfli zona, tiklash.
- Tekshiruvlar: barcha fayllar syntax OK; biznes-mantiq assert testlari; **real MongoDB**ga
  qarshi integratsiya testi (moliya qoidalari + API + 1990 kod gate) — hammasi o'tdi.
- Hujjatlar: README.md (setup/deploy), CLAUDE.md yangilandi.

## Schema (oldingi 2026-06-08 snapshot; 2026-06-20 bo'limi ustuvor)
- **Client**: name, phone (unique, +998...), locations[{address, coordinates{lat,lng}}],
  soft-delete. Indekslar: phone(unique), isDeleted.
  totalSpent saqlanmaydi — bajarilgan xizmatlardan hisoblanadi (getClientDetail).
- **Service**: clientId(req), clientName/clientPhone (denorm), location{address(req), coordinates},
  serviceDateTime, isHistorical, price, paymentMethod('naqd'|'karta'|'otkazma' — apostrofsiz!),
  paymentStatus('tolanmagan'|'tolangan'|'qisman'), paidAmount, status, completedAt, notes,
  images[], reminders[{minutesBefore, scheduledAt, sent, sentAt}], incomeTransactionId, soft-delete.
  Indekslar: clientId, status, serviceDateTime, isDeleted.

- **Transaction**: 2026-06-20 dan boshlab yuqoridagi joriy schema ustuvor:
  `type`, `amount`, enum `category`, `description`, `serviceId`, `date`, soft-delete.
- **Legacy payment artifacts**: old `debt_payments` modeli fayli qolishi mumkin, lekin active REST/API/balance oqimida ishlatilmaydi.
- **Settings**: telegramUserId(String, unique, req), language, theme, `deleteCode`,
  defaultReminders[{minutesBefore}] (standart: 1440/60/0).
- **Hisob qoidasi**: summary daromadi faqat income tranzaksiyalardan hisoblanadi.
  qo'shilmaydi (xizmat bajarilganda to'liq narx yozilgan, ikki marta sanalmasin).
  listTransactions faqat active Transaction kolleksiyasini qaytaradi.

## Important decisions / assumptions
- **Daromad tan olinishi:** faqat `bajarildi` xizmat daromad tranzaksiyasini yaratadi.
- **To'lov holati:** xizmat ichida `paymentStatus` va `paidAmount`; alohida qarz modeli faol emas.
  Botdan "bajarildi" deyilsa, to'langan deb olinadi (markPaid=true).
- **Tarixiy yozuv** (o'tgan zamon): o'tmishdagi sana bo'lsa avtomatik `bajarildi` + to'langan deb yoziladi.
- **Bot rejimi:** `polling` (dev) va `webhook` (prod) — `BOT_MODE` orqali.
- **Kod tili:** identifikatorlar inglizcha, UI/bot matni o'zbekcha (i18n).
- **Ruscha i18n:** asosiy kalitlar tarjima qilingan, qolgani uz ga fallback.

## Current state
- Loyiha **ishlashga tayyor**. Kod to'liq. Faqat haqiqiy `.env` (BOT_TOKEN, OWNER_TELEGRAM_ID,
  MONGODB_URI, GEMINI_API_KEY) kerak. `backend/.env.example` va `miniapp/.env.example` mavjud.
- 2026-06-21: Bot lokatsiya oqimi kuchaytirildi. Location yuborilganda reverse geocode natijasi avval
  `Ha, to'g'ri` / `Nomi o'zgartirish` orqali tasdiqlanadi; koordinata saqlanadi, faqat address nomi
  almashtirilishi mumkin. Slot-filling davomida location tasdiqlansa agent keyingi maydonga davom etadi,
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

## Spec qamrovi (to'liq)
- Bot: ovoz/matn/rasm/lokatsiya · 7 niyat · bittalab savol · tasdiq xulosasi ✅
- Eslatmalar: standart (1kun+1soat+aniq vaqt) + **maxsus override** ("2 soat oldin eslat" -> 120 daq) + tugmalar ✅
- Mini App: 5 sahifa to'liq ✅
- Moliya: 5 qoida (daromad bajarilganda, narx tahriri, qisman to'lov, qo'lda daromad, xarajat kategoriyalari) ✅
- O'chirish: 1990 kod, soft-delete, 30 kun tiklash, tungi cron, bulk (clients/services/finance/all),
  **bulk oldidan PDF eksport taklifi** ✅

## Notes for another AI
- Biznes mantiqni `services/` da o'zgartiring — bot va API ikkalasi shu yerdan foydalanadi.
- Yangi maydon qo'shsangiz: model + `flow.js` (slot-filling) + `prompts.js` (AI sxema) + Mini App formani yangilang.
- Har katta ishdan keyin shu faylni va `SESSION_HANDOFF.md` ni yangilang.
