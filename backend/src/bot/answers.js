// Tugmali savollarga MATN/OVOZ bilan berilgan javoblarni talqin qiladi.
// Maqsad: foydalanuvchi tugmani bosishi SHART emas — "ha", "naqd", "bekor qil"
// deb yozsa (yoki aytsa) ham xuddi tugmani bosgandek bir xil natija bo'lsin.

function norm(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[`'‘’ʻ]/g, "'")
    .trim();
}

// "ha" / "yo'q" turidagi javob. null = aniq emas (NLU hal qiladi).
export function interpretYesNo(text) {
  const v = norm(text);
  if (!v) return null;
  if (/^(ha+|xa+|h[ao]'?a|bo'?pti|bo'?ladi|bo'?lad|mayli|saqla|saqlang|yoz|yozing|tasdiq|tasdiqlayman|to'?g'?ri|to'?gri|albatta|yaxshi|ok|okey|xo'?p|zo'?r|roziman|rozi|tugadi|qildim|bajardim|bajarildi|oldim|berdim|berdi)\b/.test(v)) {
    return 'yes';
  }
  if (/^(yo'?q|yoq|yo'?g'?|emas|saqlama|yozma|kerakmas|kerak emas|qilmadim|bajarmadim|bormadim|bo'?lmadi|rad et|rad)\b/.test(v)) {
    return 'no';
  }
  return null;
}

// "bajarildimi?" tasdiq so'roviga javob: done / cancel / reschedule / null.
// Reschedule belgilarini avval tekshiramiz ("keyinroq boraman" — bekor emas, surish).
export function interpretConfirmAction(text) {
  const v = norm(text);
  if (!v) return null;
  if (/(keyinroq|keyin\b|kechroq|kechiktir|suri[sb]|surd|surib|suramiz|ko'?chir|boshqa kun|boshqa vaqt|o'?zgartir|qoldiramiz|qoldir)/.test(v)) {
    return 'reschedule';
  }
  if (/^(ha+|xa+|bajardim|bajarildi|bo'?ldi|bo'?pti|qildim|tugadi|oldim|bordim|tugatdim)\b/.test(v)) {
    return 'done';
  }
  if (/^(yo'?q|yoq|bekor|bekor qil|bekorla|qilmadim|bajarmadim|bormadim|kerak emas|kerakmas)\b/.test(v)) {
    return 'cancel';
  }
  return null;
}

// To'lov usuli matn/ovoz: naqd | karta | otkazma | null.
export function interpretPaymentMethod(text) {
  const v = norm(text);
  if (!v) return null;
  if (/naqd|naxt|nal\b|qo'?lma/.test(v)) return 'naqd';
  if (/kart|plastik|plastik?ka|visa|uzcard|humo/.test(v)) return 'karta';
  if (/o'?tkazma|otkazma|perevod|prevod|hisob raqam|schyot/.test(v)) return 'otkazma';
  return null;
}

// CLARIFY tugmalaridan birini matn bilan tanlash. Tartib raqami ("birinchi", "2")
// yoki tugma yorlig'iga (label) mosligi bo'yicha. Ikki xil mos kelsa — null (aniq emas).
export function matchClarifyOption(text, options = []) {
  const v = norm(text);
  if (!v || !options.length) return null;

  const ord = ordinalIndex(v);
  if (ord != null && options[ord]) return options[ord];

  let best = null;
  for (const opt of options) {
    const label = norm(opt.label);
    if (!label) continue;
    const tokenHit = label.split(/[\s/]+/).some((w) => w.length >= 3 && v.includes(w));
    if (v.includes(label) || label.includes(v) || tokenHit) {
      if (best && best !== opt) return null; // bir nechta moslik — aniq emas
      best = opt;
    }
  }
  return best;
}

function ordinalIndex(v) {
  if (/\b(1|bir(inchi|tasi|inchisi)?)\b/.test(v)) return 0;
  if (/\b(2|ikki(nchi|nchisi)?)\b/.test(v)) return 1;
  if (/\b(3|uch(inchi|inchisi)?)\b/.test(v)) return 2;
  return null;
}

export default {
  interpretYesNo,
  interpretConfirmAction,
  interpretPaymentMethod,
  matchClarifyOption,
};
