// Telefon raqamini O'zbekiston formatiga keltirish: +998XXXXXXXXX.
export function normalizePhone(raw) {
  if (!raw) return null;
  // Faqat raqamlarni qoldiramiz.
  let digits = String(raw).replace(/\D/g, '');

  if (digits.length === 0) return null;

  // 998901234567 -> shundayligicha
  if (digits.startsWith('998') && digits.length === 12) {
    return '+' + digits;
  }
  // 0901234567 -> 901234567
  if (digits.startsWith('0') && digits.length === 10) {
    digits = digits.slice(1);
  }
  // 901234567 (9 xona) -> +998901234567
  if (digits.length === 9) {
    return '+998' + digits;
  }
  // 8901234567 (ba'zan 8 bilan) -> +998901234567
  if (digits.length === 10 && digits.startsWith('8')) {
    return '+998' + digits.slice(1);
  }
  // Boshqa hollar: agar 998 bilan boshlansa shuni olamiz.
  if (digits.startsWith('998')) {
    return '+' + digits;
  }
  // Aniqlab bo'lmadi — original raqamlarni + bilan qaytaramiz.
  return '+' + digits;
}

// Ko'rsatish uchun chiroyli format: +998 90 123 45 67
export function formatPhone(phone) {
  if (!phone) return '';
  const m = String(phone).match(/^\+998(\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (!m) return phone;
  return `+998 ${m[1]} ${m[2]} ${m[3]} ${m[4]}`;
}
