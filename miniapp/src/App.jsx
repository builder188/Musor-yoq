// Asosiy ilova — tab navigatsiya bilan.
import { useState } from 'react';
import { useApp } from './store/AppContext.jsx';
import BottomNav from './components/BottomNav.jsx';
import Spinner from './components/Spinner.jsx';
import Home from './pages/Home.jsx';
import Clients from './pages/Clients.jsx';
import Services from './pages/Services.jsx';
import Finance from './pages/Finance.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

export default function App() {
  const { loaded, error } = useApp();
  const [tab, setTab] = useState('home');
  // Bosh sahifadagi qidiruvdan mijozni ochish uchun: Mijozlar tabiga o'tib detalni ochamiz.
  const [focusClientId, setFocusClientId] = useState(null);

  const openClient = (id) => {
    setFocusClientId(id);
    setTab('clients');
  };

  if (!loaded) {
    return (
      <div className="app">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="app">
      {error && (
        <div className="error-banner">
          ⚠️ {error}
          <br />
          <small>Backend ishlamayotgan bo'lishi yoki avtorizatsiya muammosi mumkin.</small>
        </div>
      )}
      {tab === 'home' && <Home goToTab={setTab} onOpenClient={openClient} />}
      {tab === 'clients' && (
        <Clients focusClientId={focusClientId} onFocusHandled={() => setFocusClientId(null)} />
      )}
      {tab === 'services' && <Services />}
      {tab === 'finance' && <Finance />}
      {tab === 'reports' && <Reports />}
      {tab === 'settings' && <Settings />}
      <BottomNav active={tab} onChange={setTab} />
    </div>
  );
}
