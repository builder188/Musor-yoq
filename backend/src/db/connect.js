// MongoDB ulanishi (Mongoose).
import mongoose from 'mongoose';
import env from '../config/env.js';

export async function connectDB() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(env.MONGODB_URI, {
    serverSelectionTimeoutMS: 15000,
  });
  console.log('✅ MongoDB ulandi');

  mongoose.connection.on('error', (err) => {
    console.error('MongoDB xatosi:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB uzildi');
  });
}

export default connectDB;
