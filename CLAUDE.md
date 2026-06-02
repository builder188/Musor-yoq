# CLAUDE.md

Bu fayl Claude Code (va boshqa AI) uchun loyiha bo'yicha asosiy qoidalar.

## Loyiha maqsadi
`unknown` — egasidan aniqlanishi kerak. (Papka nomi: `musor yoq`.)

## Tex stack
`unknown` — til, framework va asboblar hali tanlanmagan.

## Coding style
Stack tanlangach to'ldiriladi. Vaqtinchalik umumiy qoidalar:
- Kod sodda va o'qiladigan bo'lsin.
- Nomlar mazmunli bo'lsin (qisqartmalardan qoching).
- Bitta fayl/funksiya bitta ish qilsin.
- Kommentlar faqat "nima uchun" kerak bo'lganda.

## Muhim qoidalar
- Taxminlarni ko'paytirmang. Ishonch komil bo'lmasa `unknown` deb yozing.
- Har bir katta ish tugagach `AI_CONTEXT.md` va `SESSION_HANDOFF.md` ni yangilang.
- Matn qisqa, aniq va tartibli bo'lsin.
- Hech narsani so'rovsiz o'chirmang yoki tashqi servisga yubormang.

## Papkalar strukturasi
Hozir: faqat root va `.claude/`. Quyida taklif (majburiy emas):

```
musor yoq/
├── CLAUDE.md
├── AI_CONTEXT.md
├── SESSION_HANDOFF.md
├── README.md          # unknown (hali yo'q)
├── src/               # taklif: asosiy kod
├── tests/             # taklif: testlar
└── .claude/           # Claude Code sozlamalari
```
