// MongoDB connection (Mongoose).
import mongoose from 'mongoose';
import env from '../config/env.js';
import Service from '../models/Service.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);

  // Hodisalarni connect'dan OLDIN ulaymiz — erta uzilish/xato ham loglanadi.
  // Mongoose 8 (MongoDB drayveri) uzilganda avtomatik qayta ulanadi; bizga faqat
  // uni KO'RINADIGAN qilish kerak edi — avval 'reconnected' tinglovchi yo'q edi,
  // shuning uchun "MongoDB uzildi" dan keyin jimlik bo'lib qolardi.
  const conn = mongoose.connection;
  conn.on('connected', () => console.log('MongoDB ulandi'));
  conn.on('reconnected', () => console.log('MongoDB qayta ulandi ✅'));
  conn.on('error', (err) => console.error('MongoDB xatosi:', err.message));
  conn.on('disconnected', () =>
    console.warn('MongoDB uzildi - drayver avtomatik qayta ulanishga urinmoqda...')
  );

  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });

  await ensureIndexes();
}

// syncIndexes schema'dagi indekslarni DB bilan moslaydi (mos kelmaganini qayta quradi) —
// eski clientId indeksi o'chib, yangi clientPhone indeksi quriladi.
async function ensureIndexes() {
  try {
    await Service.syncIndexes();
  } catch (err) {
    console.error('Index sinxronizatsiyasi xatosi:', err.message);
  }
}

export default connectDB;
