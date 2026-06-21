// Central environment loader and validator.
// The app exits with a clear message when required variables are missing.
import dotenv from 'dotenv';

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    return null;
  }
  return value.trim();
}

function optional(...names) {
  for (const name of names) {
    const value = required(name);
    if (value) return value;
  }
  return null;
}

function mongoUriFromParts() {
  const host = optional('MONGOHOST', 'MONGO_HOST', 'MONGODB_HOST');
  if (!host) return null;

  const port = optional('MONGOPORT', 'MONGO_PORT', 'MONGODB_PORT') || '27017';
  const database = optional('MONGODATABASE', 'MONGO_DATABASE', 'MONGODB_DATABASE', 'MONGO_DB') || 'musiryoq';
  const user = optional('MONGOUSER', 'MONGO_USER', 'MONGODB_USER', 'MONGODB_USERNAME');
  const password = optional('MONGOPASSWORD', 'MONGO_PASSWORD', 'MONGODB_PASSWORD');
  const auth = user && password ? `${encodeURIComponent(user)}:${encodeURIComponent(password)}@` : '';

  return `mongodb://${auth}${host}:${port}/${database}`;
}

function firstMongoUri() {
  const aliases = [
    'MONGODB_URI',
    'MONGO_URL',
    'MONGO_PRIVATE_URL',
    'MONGO_PUBLIC_URL',
    'MONGODB_URL',
    'MONGODB_PRIVATE_URL',
    'MONGODB_PUBLIC_URL',
    'DATABASE_URL',
  ];
  for (const name of aliases) {
    const value = required(name);
    if (value && /^mongodb(\+srv)?:\/\//i.test(value)) {
      return value;
    }
  }
  return mongoUriFromParts();
}

const env = {
  BOT_TOKEN: required('BOT_TOKEN'),
  OWNER_TELEGRAM_ID: required('OWNER_TELEGRAM_ID'),
  MONGODB_URI: firstMongoUri(),
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

// Keep node-cron and Date calculations in the configured timezone.
process.env.TZ = env.TZ;

export function validateEnv() {
  const missing = [];
  for (const key of ['BOT_TOKEN', 'OWNER_TELEGRAM_ID', 'MONGODB_URI', 'GEMINI_API_KEY']) {
    if (!env[key]) missing.push(key);
  }

  if (missing.length > 0) {
    console.error('\nXATO: Majburiy muhit o\'zgaruvchilari topilmadi:');
    for (const key of missing) console.error(`   - ${key}`);
    if (missing.includes('MONGODB_URI')) {
      console.error('   MongoDB uchun MONGODB_URI, MONGO_URL, MONGO_PRIVATE_URL, MONGO_PUBLIC_URL yoki mongodb:// bilan boshlanadigan DATABASE_URL qabul qilinadi.');
      console.error('   Agar Railway Mongo faqat bo\'lak qiymatlar bersa, MONGOUSER, MONGOPASSWORD, MONGOHOST, MONGOPORT, MONGODATABASE ham qabul qilinadi.');
    }
    console.error('\nbackend/.env.example faylidan nusxa olib, .env ni to\'ldiring yoki Railway Variables bo\'limida qiymatlarni kiriting.\n');
    process.exit(1);
  }

  if (env.BOT_MODE === 'webhook' && !env.RAILWAY_STATIC_URL) {
    console.error('\nXATO: BOT_MODE=webhook bo\'lsa, RAILWAY_STATIC_URL ham kerak.\n');
    process.exit(1);
  }
}

export const isProd = () => env.NODE_ENV === 'production';
export const ownerId = () => Number(env.OWNER_TELEGRAM_ID);

export default env;
