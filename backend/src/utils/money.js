// Pul summalarini tahlil qilish va formatlash (so'mda).

// "400 ming" -> 400000, "1.5 mln" -> 1500000, "400000" -> 400000, "400 000" -> 400000
export function parseMoney(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') return Math.round(raw);

  let text = String(raw).toLowerCase().trim();
  if (!text) return null;

  // Birlik ko'paytiruvchilari.
  let multiplier = 1;
  if (/(mln|million|millon|milion)/.test(text)) multiplier = 1_000_000;
  else if (/(ming|tysm|tysyach|k\b)/.test(text)) multiplier = 1_000;

  // Raqam qismini ajratib olamiz: vergul -> nuqta, raqamlar orasidagi bo'shliqlarni
  // olib tashlaymiz ("400 000" -> "400000", "1 500 000" -> "1500000").
  const cleaned = text.replace(',', '.').replace(/(\d)\s+(?=\d)/g, '$1');
  const numMatch = cleaned.match(/[\d.]+/);

  // "yarim mln" / "yarim million" -> 0.5 * birlik. Faqat birlik bilan ("yarim"
  // yolg'iz pul summasi emas).
  let base;
  if (numMatch) {
    base = parseFloat(numMatch[0]);
  } else if (/yarim/.test(text) && multiplier > 1) {
    base = 0.5;
  } else {
    return null;
  }
  if (Number.isNaN(base)) return null;

  // Birlik ko'rsatilmagan bo'lsa ko'paytirmaymiz; "400 ming" kabilarda ko'paytiramiz.
  return Math.round(base * multiplier);
}

// 400000 -> "400 000 so'm"
export function formatMoney(amount) {
  const n = Math.round(Number(amount) || 0);
  const sign = n < 0 ? '-' : '';
  const formatted = Math.abs(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${sign}${formatted} so'm`;
}
