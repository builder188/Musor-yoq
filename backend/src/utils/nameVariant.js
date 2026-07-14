// Kategoriya/material nomlarining IMLO VARIANTLARINI aniqlash — dublikat kategoriya
// ochilishining oldini olish uchun yagona manba.
//
// "Variant" deb hisoblanadi: katta-kichik harf/apostrof farqi, qo'sh yoki tushib qolgan
// harf ("plasmassa" ~ "Plassmassa"), ko'plik qo'shimchasi ("paxtalar" ~ "Paxta"), 1-2
// harflik imlo xatosi. "Yengil temir" va "Og'ir temir" kabi CHINAKAM boshqa nomlar
// variant EMAS (so'z soni bir xil bo'lsa ham masofa katta).
//
// Qoida konservativ: juda qisqa nomlarda (<=4 harf) faqat aynan mos keladi — "Mis" va
// "Mix" birlashtirilmaydi.

// Solishtirish kaliti: kichik harf, apostroflarsiz, bo'shliqlar normallashtirilgan.
export function variantKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[`'‘’ʻʼ´]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// O'zbekcha ko'plik dumini olib tashlash (kalit yetarlicha uzun qolsa).
// Kelishik qo'shimchalari (-ni/-ga/-da) ATAYLAB tegilmaydi — "soda" kabi nomlarni buzadi.
function stripSuffix(key) {
  return key.replace(/(lari|lar)$/u, (m, _p, offset) => (offset >= 3 ? '' : m));
}

// Qo'sh harflarni bittaga siqish: "plassmassa" -> "plasmasa".
function squeeze(key) {
  return key.replace(/(.)\1+/g, '$1');
}

// Klassik Levenshtein masofasi (kichik satrlar uchun yetarli tez).
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const curr = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[b.length];
}

// Ikki nom bir kategoriyaning imlo varianti kabimi?
export function isSpellingVariant(a, b) {
  const ka = variantKey(a);
  const kb = variantKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;

  const pa = stripSuffix(ka);
  const pb = stripSuffix(kb);
  if (pa === pb) return true;
  if (squeeze(pa) === squeeze(pb)) return true;

  // So'z soni farq qilsa — variant emas ("temir" vs "yengil temir").
  if (pa.split(' ').length !== pb.split(' ').length) return false;

  const dist = levenshtein(squeeze(pa), squeeze(pb));
  const len = Math.max(pa.length, pb.length);
  const maxDist = len <= 4 ? 0 : len <= 7 ? 1 : 2;
  return dist <= maxDist;
}

// Ro'yxatdan birinchi variant mosini qaytaradi (topilmasa null).
export function findVariantMatch(name, candidates = []) {
  for (const candidate of candidates) {
    if (isSpellingVariant(name, candidate)) return candidate;
  }
  return null;
}

export default { variantKey, levenshtein, isSpellingVariant, findVariantMatch };
