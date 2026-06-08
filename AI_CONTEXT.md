# AI_CONTEXT.md

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

## Important decisions / assumptions
- **Daromad tan olinishi:** faqat `bajarildi` xizmat daromad tranzaksiyasini yaratadi.
- **Qarz modeli:** bajarilganda to'lanmagan qism `client.totalDebt` ga qo'shiladi; to'lov kamaytiradi.
  Botdan "bajarildi" deyilsa — to'langan deb olinadi (markPaid=true) — fantom qarz bo'lmasligi uchun.
- **Tarixiy yozuv** (o'tgan zamon): o'tmishdagi sana bo'lsa avtomatik `bajarildi` + to'langan deb yoziladi.
- **Bot rejimi:** `polling` (dev) va `webhook` (prod) — `BOT_MODE` orqali.
- **Kod tili:** identifikatorlar inglizcha, UI/bot matni o'zbekcha (i18n).
- **Ruscha i18n:** asosiy kalitlar tarjima qilingan, qolgani uz ga fallback.

## Current state
- Loyiha **ishlashga tayyor**. Kod to'liq. Faqat haqiqiy `.env` (BOT_TOKEN, OWNER_TELEGRAM_ID,
  MONGODB_URI, GEMINI_API_KEY) kerak. `backend/.env.example` va `miniapp/.env.example` mavjud.

## Known issues / TODO (ixtiyoriy yaxshilashlar)
- PDFKit standart shrift kirill (ruscha) matnni qo'llamaydi — ruscha PDF uchun TTF shrift kerak.
- Ruscha tarjimalar to'liq emas (uz ga fallback).
- Bulk delete oldidan PDF eksport taklifi UIda alohida bog'lanmagan (Sozlamalardagi hisobotdan olinadi).
- Avtomatik testlar repo'da saqlanmadi (vaqtinchalik yozildi, ishlatib o'chirildi).

## Notes for another AI
- Biznes mantiqni `services/` da o'zgartiring — bot va API ikkalasi shu yerdan foydalanadi.
- Yangi maydon qo'shsangiz: model + `flow.js` (slot-filling) + `prompts.js` (AI sxema) + Mini App formani yangilang.
- Har katta ishdan keyin shu faylni va `SESSION_HANDOFF.md` ni yangilang.
