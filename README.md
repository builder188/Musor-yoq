# 🗑 Musir Yo'q

O'zbekistondagi yakka tartibdagi **musor (chiqindi) olib ketish biznesi** egasi uchun
Telegram bot + Mini App tizimi. Egasi hamma narsani **faqat Telegram orqali** boshqaradi:
ovoz, matn, rasm yoki lokatsiya yuboradi — **Google Gemini AI** uni tushunadi va bazaga yozadi.

> Tizim faqat `.env` / Railway Variables ichidagi ruxsat berilgan Telegram IDlar uchun ochiladi.

---

## ✨ Asosiy imkoniyatlar

- 🎤 **Ovozli kiritish (o'zbekcha)** — Gemini transkripsiya qiladi va ma'lumotni ajratadi
- 📝 **Matn / 🖼 Rasm (daftar OCR) / 📍 Lokatsiya** orqali kiritish; lokatsiya DBda `address` + ixtiyoriy `mapUrl` sifatida saqlanadi
- 🧠 **3 asosiy niyat**: MOLIYA, MIJOZ, SUXBAT; noaniq xabarda CLARIFY tugmalari
- ❓ Yetishmayotgan maydonlarni **bittalab so'rash**
- 🔔 **Aqlli eslatmalar**: xizmatdan X soat oldin oddiy eslatma, X soat keyin tugmali tasdiqlash
- 📊 **Mini App** — sahifalar: Bosh sahifa, Xizmatlar (jadval — mijoz ma'lumoti shu yerda), Kategoriyalar, Moliya, Eslatmalar, Hisobotlar, Sozlamalar
- 💰 **Moliya mantig'i**: yagona balans = kirimlar - chiqimlar; alohida qarz moduli yo'q
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
| `OWNER_TELEGRAM_ID` | Ruxsat berilgan Telegram IDlar. Bir nechta user bo'lsa vergul bilan yozing. | `6028715926,606578823` |
| `MONGODB_URI` | MongoDB ulanish manzili. Kod `MONGO_URL`, `MONGO_PRIVATE_URL`, `MONGO_PUBLIC_URL`, mongodb bilan boshlanadigan `DATABASE_URL`, yoki Railway `MONGOUSER`/`MONGOPASSWORD`/`MONGOHOST`/`MONGOPORT`/`MONGODATABASE` qismlarini ham qabul qiladi. | `mongodb://127.0.0.1:27017/musiryoq` |
| `GEMINI_API_KEY` | Google Gemini API key | `AIza...` |
| `GEMINI_MODEL` | Model nomi (ixtiyoriy) | `gemini-2.0-flash` |
| `NODE_ENV` | `development` / `production` | `development` |
| `PORT` | Server porti | `3000` |
| `TZ` | Vaqt mintaqasi | `Asia/Tashkent` |
| `BOT_MODE` | `polling` (dev) / `webhook` (prod). Railway public domain bor bo'lsa `polling` avtomatik `webhook`ga almashtiriladi. | `polling` |
| `RAILWAY_STATIC_URL` | Webhook uchun public domen. `RAILWAY_PUBLIC_DOMAIN`, `RAILWAY_PUBLIC_URL`, `PUBLIC_URL`, `APP_URL` ham qabul qilinadi. | `app.up.railway.app` |
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

1. GitHub repo'ni Railway'ga ulang va service root'ini repo rootida qoldiring.
2. **MongoDB** plugin qo'shing -> `MONGODB_URI` ni kiriting. Agar Railway integratsiyasi `MONGO_URL`, `MONGO_PRIVATE_URL`, `MONGO_PUBLIC_URL`, yoki bo'lak `MONGOUSER`/`MONGOPASSWORD`/`MONGOHOST`/`MONGOPORT`/`MONGODATABASE` qiymatlarini bersa, backend ularni ham avtomatik ishlatadi.
3. Muhit o'zgaruvchilarini Railway'da kiriting (yuqoridagi jadval).
4. Production uchun:
   - `NODE_ENV=production`
   - `BOT_MODE=webhook` yoki bu variable'ni umuman bermang. Railway'da `BOT_MODE=polling` qoldirilsa ham backend webhookga o'tadi.
   - `RAILWAY_STATIC_URL` = Railway bergan domen (https:// siz)
5. Railway root `package.json` orqali avtomatik ishlaydi:
   - build: `npm run build` → `miniapp/dist`
   - start: `npm run start` → backend server

Deploydan keyin `https://<domain>/health` ni oching. `ok:false` va `MONGODB_URI` xatosi chiqsa,
app service MongoDB service bilan ulanmagan: Variables bo'limida `MONGODB_URI=${{MongoDB.MONGO_URL}}`
yoki Atlas/Railway Mongo URL ni qo'lda kiriting.
`mode:"polling"` ko'rinsa, Railway public domain variable'i (`RAILWAY_STATIC_URL` yoki `RAILWAY_PUBLIC_DOMAIN`)
app service Variables ichida yo'q. Polling Railway'da Telegram `getUpdates` 409 conflict berishi mumkin.

> Eslatma: bitta Railway service'da backend `/` da Mini App'ni, `/api` da API'ni xizmat qiladi.

---

## 🧠 Qanday ishlaydi (qisqacha)

1. Egasi botga xabar yuboradi (ovoz/matn/rasm/lokatsiya).
2. Gemini xabarni **MOLIYA / MIJOZ / SUXBAT** niyatlaridan biriga ajratadi; noaniq bo'lsa aniqlashtiradi.
3. Majburiy maydon yetishmasa — bot **bittalab** so'raydi.
4. Hammasi to'plangach — MongoDB'ga yoziladi, tasdiq xulosasi yuboriladi.
5. Kelajakdagi xizmatlar uchun `reminderAt` va `confirmAt` xizmat vaqtiga nisbatan hisoblanadi.

### Eslatma va lokatsiya
- `reminderAt = serviceDateTime - reminderHoursBefore` va oddiy matn xabari yuboriladi.
- `confirmAt = serviceDateTime + confirmHoursAfter` va `Bajarildi / Bekor qilindi / Vaqt surildi` tugmalari yuboriladi.
- `Vaqt surildi` yangi vaqtni matn yoki ovozdan olib, jadvalni qayta hisoblaydi.
- Tarixiy xizmat darhol `bajarildi`, eslatma/tasdiqlash yuborilmaydi.
- Mini App lokatsiya formati: `Manzil nomi` majburiy, `Xarita havolasi` ixtiyoriy. Noaniq xarita havolasi ogohlantiradi, lekin tasdiqlansa saqlanadi.

### Moliyaviy qoidalar
- Xizmat narxi **faqat "Bajarildi"** bo'lganda daromadga yoziladi.
- Boshqa kirimlar bot yoki Mini App orqali qo'lda `income` tranzaksiya sifatida yoziladi.
- Chiqimlar `expense` tranzaksiya sifatida yoziladi: benzin, ta'mirlash, oziq-ovqat yoki boshqa.
- Yagona balans formulasi: **barcha kirimlar - barcha chiqimlar**.
- Bajarilgandan keyin narx tahrirlansa, bog'langan daromad avtomatik yangilanadi.
- Alohida qarz yoki to'lov ledgeri yo'q. Xizmat ichida faqat `tolangan` / `tolanmagan` / `qisman` holati saqlanadi.

### O'chirish
- Har qanday o'chirish **1990** kodini talab qiladi (soft delete).
- 30 kun ichida Sozlamalar → "O'chirilgan yozuvlar" dan tiklash mumkin.
- 30 kundan keyin tungi cron butunlay o'chiradi.

---

## 🛠 Texnologiyalar
Node.js · Express · Grammy · MongoDB/Mongoose · Google Gemini ·
node-cron · PDFKit · React · Vite · Chart.js · Telegram Mini App SDK
