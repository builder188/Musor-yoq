// Markaziy muhit o'zgaruvchilari yuklovchisi va tekshiruvchisi.
// Majburiy o'zgaruvchilar bo'lmasa, dastur aniq xato bilan to'xtaydi.
import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    return null;
  }
  return value.trim();
}

const env = {
  BOT_TOKEN: required('BOT_TOKEN'),
  OWNER_TELEGRAM_ID: required('OWNER_TELEGRAM_ID'),
  MONGODB_URI: required('MONGODB_URI'),
  GEMINI_API_KEY: required('GEMINI_API_KEY'),
  GEMINI_MODEL: process.env.GEMINI_MODEL?.trim() || 'gemini-1.5-flash',

  NODE_ENV: process.env.NODE_ENV?.trim() || 'development',
  PORT: parseInt(process.env.PORT, 10) || 3000,
  TZ: process.env.TZ?.trim() || 'Asia/Tashkent',

  BOT_MODE: (process.env.BOT_MODE?.trim() || 'polling').toLowerCase(),
  RAILWAY_STATIC_URL: process.env.RAILWAY_STATIC_URL?.trim() || '',
  MINIAPP_URL: process.env.MINIAPP_URL?.trim() || '',

  CONFIRM_DELETE_CODE: process.env.CONFIRM_DELETE_CODE?.trim() || '1990',
  AUTH_DEV_BYPASS: process.env.AUTH_DEV_BYPASS?.trim() === '1',
};

// node-cron va Date'lar to'g'ri mintaqada ishlashi uchun.
process.env.TZ = env.TZ;

export function validateEnv() {
  const missing = [];
  for (const key of ['BOT_TOKEN', 'OWNER_TELEGRAM_ID', 'MONGODB_URI', 'GEMINI_API_KEY']) {
    if (!env[key]) missing.push(key);
  }
  if (missing.length > 0) {
    console.error('\n❌ Majburiy muhit o\'zgaruvchilari topilmadi:');
    for (const key of missing) console.error(`   - ${key}`);
    console.error('\n👉 backend/.env.example faylidan nusxa olib, .env ni to\'ldiring.\n');
    process.exit(1);
  }
  if (env.BOT_MODE === 'webhook' && !env.RAILWAY_STATIC_URL) {
    console.error('\n❌ BOT_MODE=webhook bo\'lsa, RAILWAY_STATIC_URL ham kerak.\n');
    process.exit(1);
  }
}

export const isProd = () => env.NODE_ENV === 'production';
export const ownerId = () => Number(env.OWNER_TELEGRAM_ID);

export default env;
