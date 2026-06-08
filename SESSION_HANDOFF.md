# SESSION_HANDOFF.md

> Oxirgi yangilanish: 2026-06-08.

## Hozirgacha nima qilindi
"Musir Yo'q" tizimi **noldan to'liq qurildi** — backend (bot + AI + API + cron + PDF) va
Mini App (5 sahifa). Real MongoDB'ga qarshi integratsiya testlari o'tdi.

## Qaysi fayllar yaratildi (asosiy)
- `backend/` — package.json, .env.example, .gitignore + `src/` (config, db, models, ai, bot,
  services, routes, middleware, cron, utils). ~40 fayl.
- `miniapp/` — package.json, vite.config.js, index.html, .env.example + `src/` (pages,
  components, i18n, store, api, utils, styles.css). ~25 fayl.
- `README.md` (yangi), `CLAUDE.md` (yangilandi), `AI_CONTEXT.md` (yangilandi).

## Tekshiruv holati
- ✅ Barcha JS fayllar `node --check` dan o'tdi.
- ✅ Modullar import/resolve toza (dummy env bilan).
- ✅ Biznes mantiq assertlari: money, phone, payment method, slot-filling.
- ✅ Integratsiya (real MongoDB 8.2): xizmat yaratish→bajarish→daromad/qarz→tahrir→to'lov→summary.
- ✅ API: routes, initData dev-bypass, 1990 o'chirish kodi gate.
- ✅ Mini App `npm run build` muvaffaqiyatli (52 modul).

## GitHub repo (eslab qoling)
- Remote: `origin` → **https://github.com/builder188/Musor-yoq.git** (branch: `main`)
- Hammasi lokal commit qilingan. Push qilish uchun `builder188` akkaunti huquqi kerak
  (bu kompyuterdagi git `xusniddin531` bilan kirgan — collaborator qo'shish yoki PAT kerak).
- Push: `git push -u origin main`

## Keyingi aniq qadam (egasi uchun)
1. `backend/.env` ni to'ldirish: `BOT_TOKEN`, `OWNER_TELEGRAM_ID`, `MONGODB_URI`, `GEMINI_API_KEY`.
2. `cd backend && npm install && npm run dev` → botni Telegramda sinash.
3. `cd miniapp && npm install && npm run dev` (brauzerda sinash uchun `AUTH_DEV_BYPASS=1`).
4. @BotFather'da Mini App URL ni o'rnatib, `MINIAPP_URL` ni to'ldirish.
5. Tayyor bo'lsa Railway'ga deploy (README'dagi qadamlar).

## Ixtiyoriy keyingi ishlar
- Ruscha tarjimalarni to'ldirish; ruscha PDF uchun TTF shrift qo'shish.
- Avtomatik testlarni doimiy `backend/tests/` ga ko'chirish.
- Mini App'da bulk-delete oldidan PDF eksport taklifini bevosita bog'lash.

## Boshqa AI uchun qisqa yo'riqnoma
- Avval `AI_CONTEXT.md` ni o'qing — to'liq arxitektura va qarorlar shu yerda.
- Biznes mantiq `backend/src/services/` da (bot + API umumiy ishlatadi).
- Har katta ishdan keyin shu faylni va `AI_CONTEXT.md` ni yangilang.
