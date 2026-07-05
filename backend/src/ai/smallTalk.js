// Pure small-talk guard shared by classifier and read-query answers.
// These messages must never become search/service/finance actions.

const BUSINESS_OR_ACTION_RE =
  /(qancha|nechta|necha|qachon|qayer|qaysi|balans|foyda|daromad|xarajat|qarz|mijoz|xizmat|hisob|royxat|ro'yxat|manzil|narx|telefon|kirim|chiqim|to'lov|tolov|sana|bugun|ertaga|kecha|bordim|boraman|borish|olib|oldim|berdim|ketdi|ishlatdim|sarfladim|tushdi|keldi|sotdim|sotildi|sotib|pul|summa|ming|mln|million|so'm|som|usd|dollar|kg|kilogram)/i;

const SMALL_TALK_PATTERNS = [
  { cat: 'thanks', re: /\b(rahmat|raxmat|rahmet|rhmat|rhamat|rakhmat|tashakkur|minnatdor)\b/i },
  { cat: 'bye', re: /(\bxayr\b|ko'rishg|korishg|salomat\s*bo|omon\s*bo)/i },
  { cat: 'howareyou', re: /\b(qalays|qalaysan|qalaysiz|qales|yaxshimi|yaxshimisiz|ishlaring|ishlar|tinchlik)\b/i },
  { cat: 'greeting', re: /\b(assalom|assalomu|salom|alik|alaykum|hayrli|xayrli)\b/i },
  { cat: 'ack', re: /^(zo'?r|ok(ay)?|mayli|xo'?p|hop|xop|yaxshi|barakalla|super)\b/i },
];

const SMALL_TALK_REPLY = {
  thanks: "Arzimaydi oka! Yana biror narsa kerak bo'lsa shu yerdaman.",
  bye: "Xayr oka, omon bo'ling!",
  howareyou: "Rahmat oka, men joyidaman! Ishlar bo'yicha nima kerak - mijoz, xizmat, xarajat yoki hisobot?",
  greeting: "Va alaykum assalom oka! Xizmatingizdaman - mijoz, xizmat, xarajat yoki hisobot bo'yicha nima kerak?",
  ack: 'Xizmatingizdaman oka.',
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
