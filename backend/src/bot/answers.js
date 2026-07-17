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

// Saqlangan yozuv xulosasiga (darhol-saqlash oqimi, 3 tugma) matn/ovoz javobi:
//  'cancel' — saqlangan yozuvni o'chirish ("bekor", "o'chir", "kerakmas").
//  'edit'   — qisqa/umumiy tahrir so'rovi ("tahrirla", "yo'q", "noto'g'ri") — bot
//             "nimani o'zgartiramiz?" deb so'raydi. Qiymatli gap ("narxini 200 ming qil")
//             bu yerda ushlanmaydi — NLU orqali to'g'ridan-to'g'ri tahrir qilinadi.
//  'ack'    — tasdiq/rahmat ("ha", "to'g'ri", "rahmat", "zo'r") — hech narsa qilinmaydi.
//  null     — boshqa gap (NLU hal qiladi: tahrirmi yoki yangi buyruqmi).
export function interpretSavedReply(text) {
  const v = norm(text);
  if (!v) return null;
  const words = v.split(/\s+/).length;
  if (/^(bekor|otmen|otmena|cancel|o'?chir|ochir|saqlama|kerakmas|kerak emas|hammasini bekor)\b/.test(v)) {
    return 'cancel';
  }
  // Umumiy tahrir so'rovi — faqat QISQA, qiymatsiz gapda ("tahrirla", "yo'q, xato").
  // Uzun gap ("telefonini 90... ga o'zgartir") NLU'ga o'tadi (aniq maydon tahriri).
  if (words <= 3 && /(^tahrir|tahrirla|^yo'?q\b|^yoq\b|noto'?g'?ri|notog'?ri|^xato\b|^edit\b|to'?g'?rila)/.test(v)) {
    return 'edit';
  }
  if (words <= 3 && /^(ha+|xa+|to'?g'?ri|to'?gri|bo'?ldi|boldi|bo'?ladi|bo'?pti|mayli|rahmat|raxmat|ok|okey|xo'?p|zo'?r|albatta|durust|yaxshi|tasdiq)\b/.test(v)) {
    return 'ack';
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
  // "Bormadim/qilmadim/yo'q" = BAJARILMADI (bekor emas): amalga oshmadi, keyin qayta
  // rejalash mumkin, balansga yozilmaydi.
  if (/^(yo'?q|yoq|qilmadim|bajarmadim|bajarilmadi|bormadim|borolmadim|bora olmadim|ulgurmadim)\b/.test(v)) {
    return 'not_done';
  }
  if (/^(bekor|bekor qil|bekorla|kerak emas|kerakmas)\b/.test(v)) {
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
  interpretSavedReply,
  interpretConfirmAction,
  interpretPaymentMethod,
  matchClarifyOption,
};
