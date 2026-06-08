# 🗑 Musir Yo'q

O'zbekistondagi yakka tartibdagi **musor (chiqindi) olib ketish biznesi** egasi uchun
Telegram bot + Mini App tizimi. Egasi hamma narsani **faqat Telegram orqali** boshqaradi:
ovoz, matn, rasm yoki lokatsiya yuboradi — **Google Gemini AI** uni tushunadi va bazaga yozadi.

> Tizim faqat **bitta odam** (biznes egasi) uchun. Boshqa foydalanuvchilar yo'q.

---

## ✨ Asosiy imkoniyatlar

- 🎤 **Ovozli kiritish (o'zbekcha)** — Gemini transkripsiya qiladi va ma'lumotni ajratadi
- 📝 **Matn / 🖼 Rasm (daftar OCR) / 📍 Lokatsiya** orqali kiritish
- 🧠 **7 niyat (intent)**: xizmat, xarajat, daromad, holat yangilash, to'lov, qidiruv, analitika
- ❓ Yetishmayotgan maydonlarni **bittalab so'rash**
- 🔔 **Aqlli eslatmalar** (1 kun + 1 soat + aniq vaqt; sozlanadi)
- 📊 **Mini App** — 5 sahifa: Bosh sahifa, Mijozlar, Xizmatlar (Kanban/List), Moliya, Sozlamalar
- 💰 **Moliya mantig'i**: daromad faqat "Bajarildi" bo'lganda yoziladi; qarz hisobi
- 🗑 **Xavfsiz o'chirish**: 1990 kodi + 30 kunlik tiklash oynasi
- 🌗 Yorug'/Tungi mavzu, 🇺🇿/🇷🇺 til (o'zbekcha asosiy, ruscha tayyor)

---

## 🏗 Arxitektura

```
musor yoq/
├── backend/     # Node.js + Express + Grammy + Mongoose + Gemini + node-cron + PDFKit
│   └── src/
│       ├── index.js        # kirish nuqtasi
│       ├── config/         # env
│       ├── db/             # MongoDB ulanishi
│       ├── models/         # Client, Service, Transaction, Settings, Conversation
│       ├── ai/             # gemini.js, prompts.js, agent.js
│       ├── bot/            # bot.js, handlers/, flow.js
│       ├── services/       # biznes mantiq (bot + API uchun umumiy)
│       ├── routes/         # REST API (Mini App uchun)
│       ├── middleware/     # auth (initData), asyncHandler
│       ├── cron/           # reminders, cleanup
│       └── utils/          # phone, money, dates, pdf
└── miniapp/     # React + Vite + Telegram Mini App SDK + Chart.js + i18n
    └── src/
        ├── pages/          # Home, Clients, Services, Finance, Settings
        ├── components/     # Modal, BottomNav, ServiceDetailModal, ...
        ├── i18n/           # uz.js (to'liq), ru.js (tayyor)
        └── store/          # AppContext (til, mavzu, sozlamalar)
```

---

## 🚀 Ishga tushirish (lokal)

### 0. Talablar
- Node.js 18+ va npm
- MongoDB (lokal yoki [Atlas](https://www.mongodb.com/atlas))
- Telegram bot tokeni va Gemini API key

### 1. Telegram bot yaratish
1. Telegram'da [@BotFather](https://t.me/BotFather) ga yozing → `/newbot` → token oling.
2. O'zingizning Telegram ID ingizni [@userinfobot](https://t.me/userinfobot) dan oling.

### 2. Gemini API key olish
[Google AI Studio](https://aistudio.google.com/app/apikey) → bepul API key.

### 3. Backend
```bash
cd backend
npm install
copy .env.example .env        # Windows  (Linux/Mac: cp .env.example .env)
#  -> .env ni to'ldiring (pastdagi jadvalga qarang)
npm run dev
```
Kutiladigan loglar:
```
✅ MongoDB ulandi
🚀 Server ishlayapti: http://localhost:3000
🤖 Bot polling rejimida: @sizning_bot
⏰ Eslatma cron ishga tushdi (har daqiqada)
🧹 Tozalash cron ishga tushdi (har kuni 03:00)
```

### 4. Mini App
```bash
cd miniapp
npm install
copy .env.example .env        # VITE_API_URL=http://localhost:3000
npm run dev                   # http://localhost:5173
```
> Brauzerda sinash uchun backend `.env` da `AUTH_DEV_BYPASS=1` qiling
> (Telegram tashqarisida initData bo'lmagani uchun). **Productionda 0 qiling!**

---

## 🔑 Muhit o'zgaruvchilari (`backend/.env`)

| O'zgaruvchi | Tavsif | Misol |
|---|---|---|
| `BOT_TOKEN` | @BotFather bergan token | `123456:AAE...` |
| `OWNER_TELEGRAM_ID` | Sizning Telegram ID | `123456789` |
| `MONGODB_URI` | MongoDB ulanish manzili | `mongodb://127.0.0.1:27017/musiryoq` |
| `GEMINI_API_KEY` | Google Gemini API key | `AIza...` |
| `GEMINI_MODEL` | Model nomi (ixtiyoriy) | `gemini-1.5-flash` |
| `NODE_ENV` | `development` / `production` | `development` |
| `PORT` | Server porti | `3000` |
| `TZ` | Vaqt mintaqasi | `Asia/Tashkent` |
| `BOT_MODE` | `polling` (dev) / `webhook` (prod) | `polling` |
| `RAILWAY_STATIC_URL` | Webhook uchun public domen | `app.up.railway.app` |
| `MINIAPP_URL` | Bot tugmasi ochadigan URL | `https://app.up.railway.app` |
| `CONFIRM_DELETE_CODE` | O'chirish tasdiq kodi | `1990` |
| `AUTH_DEV_BYPASS` | Dev'da initData tekshiruvini o'chirish | `0` |

---

## 📲 Mini App ni botga ulash
1. [@BotFather](https://t.me/BotFather) → `/setmenubutton` (yoki `/newapp`) → Mini App URL ni kiriting.
2. `backend/.env` da `MINIAPP_URL` ni o'sha URL ga tenglang.
3. Botda `/start` → "📊 Panelni ochish" tugmasi paydo bo'ladi.

---

## ☁️ Railway'ga deploy

1. GitHub repo'ni Railway'ga ulang. Ikki service yarating yoki bittasida ikkalasini build qiling.
2. **MongoDB** plugin qo'shing → `MONGODB_URI` ni oling.
3. Backend service muhit o'zgaruvchilarini Railway'da kiriting (yuqoridagi jadval).
4. Production uchun:
   - `NODE_ENV=production`
   - `BOT_MODE=webhook`
   - `RAILWAY_STATIC_URL` = Railway bergan domen (https:// siz)
5. Mini App'ni build qiling: `cd miniapp && npm run build` → `miniapp/dist`.
   Backend production rejimida `miniapp/dist` ni avtomatik statik tarzda beradi.

> Eslatma: bitta Railway service'da ishlatish uchun `miniapp` ni build qilib,
> backend'ni ishga tushiring — u `/` da Mini App'ni, `/api` da API'ni xizmat qiladi.

---

## 🧠 Qanday ishlaydi (qisqacha)

1. Egasi botga xabar yuboradi (ovoz/matn/rasm/lokatsiya).
2. Gemini xabarni **7 niyatdan** biriga ajratadi va maydonlarni chiqaradi.
3. Majburiy maydon yetishmasa — bot **bittalab** so'raydi.
4. Hammasi to'plangach — MongoDB'ga yoziladi, tasdiq xulosasi yuboriladi.
5. Kelajakdagi xizmatlar uchun **eslatmalar** rejalashtiriladi.

### Moliyaviy qoidalar
- Xizmat narxi **faqat "Bajarildi"** bo'lganda daromadga yoziladi.
- Bajarilgandan keyin narx tahrirlansa — bog'langan daromad va qarz **avtomatik** yangilanadi.
- To'lanmagan qism mijoz **qarziga** qo'shiladi; to'lov qarzni kamaytiradi.

### O'chirish
- Har qanday o'chirish **1990** kodini talab qiladi (soft delete).
- 30 kun ichida Sozlamalar → "O'chirilgan yozuvlar" dan tiklash mumkin.
- 30 kundan keyin tungi cron butunlay o'chiradi.

---

## 🛠 Texnologiyalar
Node.js · Express · Grammy · MongoDB/Mongoose · Google Gemini (1.5-flash) ·
node-cron · PDFKit · React · Vite · Chart.js · Telegram Mini App SDK
