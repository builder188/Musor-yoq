import { useApp } from '../store/AppContext.jsx';
import { haptic } from '../telegram.js';

export const NAV_TABS = [
  { id: 'home', icon: '🏠' },
  { id: 'services', icon: '🗑️' },
  { id: 'categories', icon: '🗂️' },
  { id: 'finance', icon: '💰' },
  { id: 'reminders', icon: '🔔' },
  { id: 'settings', icon: '⚙️' },
];

export default function BottomNav({ active, onChange }) {
  const { t } = useApp();
  return (
    <nav className="bottom-nav">
      {NAV_TABS.map((tab) => (
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
