// Asosiy ilova - responsive shell: desktop sidebar, mobile bottom navigation.
import { useCallback, useEffect, useState } from 'react';
import { useApp } from './store/AppContext.jsx';
import BottomNav from './components/BottomNav.jsx';
import SidebarNav from './components/SidebarNav.jsx';
import Spinner from './components/Spinner.jsx';
import Home from './pages/Home.jsx';
import Services from './pages/Services.jsx';
import Categories from './pages/Categories.jsx';
import Finance from './pages/Finance.jsx';
import Reminders from './pages/Reminders.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const DESKTOP_BREAKPOINT = 768;
const SIDEBAR_STORAGE_KEY = 'miniapp.sidebarCollapsed';

// Bot tugmasi ("📱 Ilovaga o'tish") ?tab= bilan tegishli sahifani ochadi.
// Eslatma: 'clients' tab OLIB TASHLANDI — mijoz ma'lumoti Xizmatlar jadvalida.
const VALID_TABS = ['home', 'services', 'categories', 'finance', 'reminders', 'reports', 'settings'];

function initialTab() {
  try {
    const fromQuery = new URLSearchParams(window.location.search).get('tab');
    const fromTelegram = window.Telegram?.WebApp?.initDataUnsafe?.start_param;
    const candidate = fromQuery || fromTelegram;
    // Eski bot xabarlaridagi ?tab=clients havolalari Xizmatlarga olib boradi.
    if (candidate === 'clients') return 'services';
    return VALID_TABS.includes(candidate) ? candidate : 'home';
  } catch {
    return 'home';
  }
}

function isDesktopViewport() {
  return typeof window !== 'undefined' ? window.innerWidth >= DESKTOP_BREAKPOINT : false;
}

function useResponsiveMode() {
  const [isDesktop, setIsDesktop] = useState(isDesktopViewport);

  useEffect(() => {
    const update = () => setIsDesktop(isDesktopViewport());
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return isDesktop;
}

function usePersistentSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
    } catch {
      /* localStorage mavjud bo'lmasligi mumkin */
    }
  }, [collapsed]);

  return [collapsed, setCollapsed];
}

export default function App() {
  const { loaded, error, clearNavigation } = useApp();
  const [tab, setTab] = useState(initialTab);
  // Tab bilan birga kelgan yo'naltirish parametrlari (masalan bosh sahifadan Xizmatlar
  // jadvalidagi aniq qatorga o'tib, uni yorug'lantirib ko'rsatish uchun). Har o'tishda
  // yangi obyekt (nonce bilan) — shu sabab bir xil qatorga qayta bosilsa ham qayta ishlaydi.
  const [tabParams, setTabParams] = useState(null);
  const isDesktop = useResponsiveMode();
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistentSidebar();

  const changeTab = useCallback(
    (nextTab, params = null) => {
      clearNavigation();
      setTab(nextTab);
      setTabParams(params);
    },
    [clearNavigation]
  );

  if (!loaded) {
    return (
      <div className="app-shell mobile">
        <div className="app">
          <Spinner />
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell ${isDesktop ? 'desktop' : 'mobile'} ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      {isDesktop && (
        <SidebarNav
          active={tab}
          collapsed={sidebarCollapsed}
          onChange={changeTab}
          onToggle={() => setSidebarCollapsed((value) => !value)}
        />
      )}

      <main className="app-content">
        <div className="app">
          {error && (
            <div className="error-banner">
              ⚠️ {error}
              <br />
              <small>Backend ishlamayotgan bo'lishi yoki avtorizatsiya muammosi mumkin.</small>
            </div>
          )}
          {tab === 'home' && <Home goToTab={changeTab} />}
          {tab === 'services' && <Services nav={tabParams} />}
          {tab === 'categories' && <Categories />}
          {tab === 'finance' && <Finance nav={tabParams} />}
          {tab === 'reminders' && <Reminders />}
          {tab === 'reports' && <Reports />}
          {tab === 'settings' && <Settings />}
        </div>
      </main>

      {!isDesktop && <BottomNav active={tab} onChange={changeTab} />}
    </div>
  );
}
