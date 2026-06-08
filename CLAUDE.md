# CLAUDE.md

Bu fayl Claude Code (va boshqa AI) uchun loyiha bo'yicha asosiy qoidalar.

## Loyiha maqsadi
**Musir Yo'q** — O'zbekistondagi yakka tartibdagi musor olib ketish biznesi egasi uchun
Telegram bot + Mini App. Egasi faqat Telegram orqali (ovoz/matn/rasm/lokatsiya) ishlaydi,
Google Gemini AI xabarlarni tushunib bazaga yozadi. Tizim faqat bitta odam uchun.

Uchta asosiy maqsad: (1) mijoz va xizmatlarni boshqarish, (2) moliya (daromad/xarajat/qarz),
(3) aqlli eslatmalar.

## Tex stack
- **Backend:** Node.js + Express (ESM, `type: module`) → Railway
- **DB:** MongoDB + Mongoose
- **Bot:** Grammy
- **AI:** Google Gemini (`gemini-1.5-flash`, multimodal: matn/audio/rasm)
- **Mini App:** React + Vite + Telegram Mini App SDK + Chart.js
- **Scheduler:** node-cron · **PDF:** PDFKit

## Coding style
- Kod sodda va o'qiladigan bo'lsin; bitta fayl/funksiya bitta ish qilsin.
- **Identifikatorlar va kommentlar — inglizcha/o'zbekcha aralash:** kod nomlari inglizcha,
  foydalanuvchiga ko'rinadigan barcha matn **o'zbekcha** (i18n orqali).
- Biznes mantiq `backend/src/services/` da — bot va API uni umumiy ishlatadi (takrorlamang).
- Kommentlar faqat "nima uchun" kerak bo'lganda.
- O'chirish kodi: `1990` (env: `CONFIRM_DELETE_CODE`). Soft delete + 30 kun tiklash.

## Muhim qoidalar
- Taxminlarni ko'paytirmang. Ishonch komil bo'lmasa `unknown` deb yozing.
- Har bir katta ish tugagach `AI_CONTEXT.md` va `SESSION_HANDOFF.md` ni yangilang.
- Matn qisqa, aniq va tartibli bo'lsin.
- Hech narsani so'rovsiz o'chirmang yoki tashqi servisga yubormang.

## Papkalar strukturasi
```
musor yoq/
├── CLAUDE.md
├── AI_CONTEXT.md
├── SESSION_HANDOFF.md
├── README.md             # to'liq setup/run/deploy yo'riqnomasi
├── backend/              # Node + Express + Grammy + Gemini + cron + PDF
│   ├── .env.example
│   └── src/{config,db,models,ai,bot,services,routes,middleware,cron,utils}
├── miniapp/              # React + Vite Telegram Mini App
│   ├── .env.example
│   └── src/{pages,components,i18n,store,api,utils}
└── .claude/              # Claude Code sozlamalari
```

Batafsil: `README.md` (ishga tushirish, env, Railway deploy) va `AI_CONTEXT.md`.
