import cron from 'node-cron';
import { purgeOld } from '../services/deleteService.js';
import env from '../config/env.js';

export function startCleanupCron() {
  cron.schedule(
    '0 0 * * *',
    async () => {
      try {
        await purgeOld(30);
        console.log(`[CLEANUP] Permanent deletion completed at ${new Date().toISOString()}`);
      } catch (err) {
        console.error('Cleanup cron xatosi:', err.message);
      }
    },
    { timezone: env.TZ }
  );
  console.log('Tozalash cron ishga tushdi (har kuni 00:00)');
}
