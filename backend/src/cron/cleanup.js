import cron from 'node-cron';
import { purgeOld } from '../services/deleteService.js';
import { runGlobal } from '../db/tenantScope.js';
import env from '../config/env.js';

export function startCleanupCron() {
  cron.schedule(
    '0 0 * * *',
    async () => {
      try {
        // BARCHA foydalanuvchilar uchun (faqat isDeleted + 30 kun muddat bo'yicha,
        // egadan qat'i nazar) — shuning uchun runGlobal.
        await runGlobal(() => purgeOld(30));
        console.log(`[CLEANUP] Permanent deletion completed at ${new Date().toISOString()}`);
      } catch (err) {
        console.error('Cleanup cron xatosi:', err.message);
      }
    },
    { timezone: env.TZ }
  );
  console.log('Tozalash cron ishga tushdi (har kuni 00:00)');
}
