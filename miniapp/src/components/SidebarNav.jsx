import { useApp } from '../store/AppContext.jsx';
import { haptic } from '../telegram.js';
import { NAV_TABS } from './BottomNav.jsx';

export default function SidebarNav({ active, collapsed, onChange, onToggle }) {
  const { t } = useApp();
  const toggleLabel = collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar');

  return (
    <aside className={`sidebar-nav ${collapsed ? 'collapsed' : ''}`} aria-label="Mini App navigation">
      <div className="sidebar-top">
        <div className="sidebar-brand">
          <div className="sidebar-mark">MY</div>
          <div className="sidebar-brand-text">
            <strong>{t('appName')}</strong>
            <span>{t('settings.role')}</span>
          </div>
        </div>
        <button className="sidebar-toggle" type="button" onClick={onToggle} aria-label={toggleLabel} title={toggleLabel}>
          <span aria-hidden="true">{collapsed ? '>' : '<'}</span>
        </button>
      </div>

      <nav className="sidebar-list">
        {NAV_TABS.map((tab) => {
          const label = t(`nav.${tab.id}`);
          return (
            <button
              key={tab.id}
              type="button"
              className={`sidebar-item ${active === tab.id ? 'active' : ''}`}
              data-label={label}
              title={collapsed ? label : undefined}
              onClick={() => {
                haptic('light');
                onChange(tab.id);
              }}
            >
              <span className="sidebar-icon" aria-hidden="true">{tab.icon}</span>
              <span className="sidebar-item-label">{label}</span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
