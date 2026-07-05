// Pure small-talk guard shared by classifier and read-query answers.
// These messages must never become search/service/finance actions.
//
// MUHIM (kirillcha): egasi lotin YOKI kirill yozadi ("salom" / "салом"). JS'da \b
// faqat ASCII \w chegarasida ishlaydi — kirill so'zlarga \b QO'YMANG (hech qachon
// mos kelmaydi). Kirill andozalar substring yoki (?:^|\s)...(?=\s|$) bilan yoziladi.

// Biznes/amal ishorasi — bittasi bo'lsa bu SUHBAT EMAS, Gemini'ga o'tkazamiz
// (bloklash xavfsiz yo'nalish: klassifikator baribir to'g'ri hal qiladi).
const BUSINESS_OR_ACTION_RE = new RegExp(
  [
    // Lotin — stem sifatida (qo'shimchali shakllar ham: "mijozlar", "narxi", "sotaman")
    "qancha|nechta|necha|qachon|qayer|qaysi|balans|foyda|daromad|xarajat|qarz|mijoz|xizmat|hisob|royxat|ro'yxat|manzil|narx|telefon|kirim|chiqim|to'lov|tolov|sana|bugun|ertaga|kecha|bordim|boraman|borish|olib|oldim|olaman|berdim|beraman|ketdi|ishlatdim|sarfladim|tushdi|keldi|sot|shartnoma|hamkor|eslat|pul|summa|ming|mln|million|so'm|som|usd|dollar|kg|kilogram",
    // Kirill — xuddi shu stemlar
    'қанча|канча|нечта|неча|қачон|качон|қаер|каер|қайси|кайси|баланс|фойда|даромад|харажат|қарз|карз|мижоз|хизмат|ҳисоб|хисоб|рўйхат|руйхат|манзил|нарх|телефон|кирим|чиқим|чиким|тўлов|тулов|сана|бугун|эртага|кеча|бордим|бораман|олиб|олдим|оламан|бердим|бераман|кетди|ишлатдим|сарфладим|тушди|келди|сот|шартнома|ҳамкор|хамкор|эслат|пул|сумма|минг|млн|миллион|сўм|сум|доллар|кг',
  ].join('|'),
  'i'
);

// Qisqa, ko'p ma'noli so'zlar ("salom, menda televizor bor", "Akmal kim?") —
// faqat butun so'z sifatida bloklaydi; suhbat so'zi bilan yonma-yon kelsa ham
// bu ma'lumotli gap, uni yutib yubormaymiz.
const SHORT_AMBIGUOUS_RE =
  /\b(kim|bor|bormi|qani)\b|(?:^|\s)(ким|бор|борми|қани)(?=\s|$)/i;

const SMALL_TALK_PATTERNS = [
  {
    cat: 'thanks',
    re: /\b(rahmat|raxmat|rahmet|rhmat|rhamat|rakhmat|tashakkur|minnatdor)\b|раҳмат|рахмат|рахмет|ташаккур|миннатдор/i,
  },
  {
    cat: 'bye',
    re: /\bxayr\b|ko'rishg|korishg|salomat\s*bo|omon\s*bo|(?:^|\s)хайр(?=\s|$)|кўришг|куришг|саломат\s*бў|омон\s*бў/i,
  },
  {
    cat: 'howareyou',
    re: /\b(qalays|qalaysan|qalaysiz|qales|yaxshimi|yaxshimisiz|ishlaring|ishlar|tinchlik)\b|қалайс|калайс|яхшими|ишлар(?!атд)|тинчлик/i,
  },
  {
    cat: 'greeting',
    re: /\b(assalom|assalomu|salom|alik|alaykum|hayrli|xayrli)\b|ассалом|(?:^|\s)салом(?=\s|$)|алайкум|ҳайрли|хайрли/i,
  },
  {
    cat: 'ack',
    re: /^(zo'?r|ok(ay)?|mayli|xo'?p|hop|xop|yaxshi|barakalla|super|зўр|зур|майли|хўп|хуп|хоп|яхши|баракалла)(?=\s|$)/i,
  },
];

const SMALL_TALK_REPLY = {
  thanks: "Arzimaydi oka! 😊 Yana biror narsa kerak bo'lsa shu yerdaman.",
  bye: "Xayr oka, omon bo'ling! 👋",
  howareyou: "Rahmat oka, men joyidaman! 😊 Ishlar bo'yicha nima kerak — mijoz, xizmat, xarajat yoki hisobot?",
  greeting: "Va alaykum assalom oka! 👋 Xizmatingizdaman — mijoz, xizmat, xarajat yoki hisobot bo'yicha nima kerak?",
  ack: 'Xizmatingizdaman oka 😊',
};

function normalizeText(rawText = '') {
  return String(rawText || '')
    .toLowerCase()
    .replace(/[?!.,;:()[\]{}"“”]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function pureSmallTalkCategory(rawText = '') {
  const text = normalizeText(rawText);
  if (!text) return null;
  if (/\d/.test(text)) return null;
  if (BUSINESS_OR_ACTION_RE.test(text)) return null;
  if (SHORT_AMBIGUOUS_RE.test(text)) return null;

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 6) return null;

  for (const { cat, re } of SMALL_TALK_PATTERNS) {
    if (cat === 'ack' && words.length > 3) continue;
    if (re.test(text)) return cat;
  }
  return null;
}

export function isPureSmallTalk(rawText = '') {
  return Boolean(pureSmallTalkCategory(rawText));
}

export function smallTalkReply(rawText = '') {
  const cat = pureSmallTalkCategory(rawText);
  if (!cat) return null;
  return { text: SMALL_TALK_REPLY[cat], tool: 'small_talk' };
}

export default { isPureSmallTalk, pureSmallTalkCategory, smallTalkReply };
