import { useApp } from '../store/AppContext.jsx';
import { haptic } from '../telegram.js';

// Dizayndagidek 5 tab. Hisobot eksporti Sozlamalar ichida (alohida tab kerak emas).
const TABS = [
  { id: 'home', icon: '🏠' },
  { id: 'clients', icon: '👥' },
  { id: 'services', icon: '🗑️' },
  { id: 'finance', icon: '💰' },
  { id: 'settings', icon: '⚙️' },
];

export default function BottomNav({ active, onChange }) {
  const { t } = useApp();
  return (
    <nav className="bottom-nav">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          className={`nav-item ${active === tab.id ? 'active' : ''}`}
          onClick={() => {
            haptic('light');
            onChange(tab.id);
          }}
        >
          <span className="icon">{tab.icon}</span>
          {t(`nav.${tab.id}`)}
        </button>
      ))}
    </nav>
  );
}
