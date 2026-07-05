// Ro'yxat/statistika yuklanmay qolganda ko'rinadigan banner. MUHIM: avval xato jim
// yutilib bo'sh ro'yxat ko'rsatilardi — foydalanuvchi "yozuvim saqlanmabdi" deb o'ylardi.
// Endi aniq xabar + qayta urinish tugmasi chiqadi.
import { useApp } from '../store/AppContext.jsx';

export default function LoadError({ onRetry }) {
  const { t } = useApp();
  return (
    <div className="error-banner" style={{ marginBottom: 12 }}>
      <div style={{ marginBottom: 8 }}>{t('common.loadError')}</div>
      <button className="btn btn-sm" onClick={onRetry}>
        🔄 {t('common.retry')}
      </button>
    </div>
  );
}
