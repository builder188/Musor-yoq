// Ilova holati: til, mavzu, sozlamalar. Backend bilan sinxronlanadi.
import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api/client.js';
import { makeT } from '../i18n/index.js';
import { clearTelegramTheme } from '../telegram.js';

const AppContext = createContext(null);

// Faqat 'light' yoki 'dark' — boshqa har qanday qiymat (eski 'auto' ham) yorug'ga aylanadi.
function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [lang, setLangState] = useState('uz');
  // theme: 'light' (default) | 'dark' — har doim o'z premium palitramiz ishlaydi.
  const [theme, setThemeState] = useState(() => {
    try {
      return normalizeTheme(localStorage.getItem('theme'));
    } catch {
      return 'light';
    }
  });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [navigationStack, setNavigationStack] = useState([]);
  const navigationStackRef = useRef([]);
  const navigationSeqRef = useRef(0);

  const updateNavigationStack = useCallback((updater) => {
    setNavigationStack((current) => {
      const next = typeof updater === 'function' ? updater(current) : updater;
      navigationStackRef.current = next;
      return next;
    });
  }, []);

  const pushNavigation = useCallback(
    (entry) => {
      navigationSeqRef.current += 1;
      const id = `${Date.now()}-${navigationSeqRef.current}`;
      updateNavigationStack((current) => [...current, { id, ...entry }]);
      return id;
    },
    [updateNavigationStack]
  );

  const removeNavigation = useCallback(
    (id) => {
      if (!id) return;
      updateNavigationStack((current) => current.filter((entry) => entry.id !== id));
    },
    [updateNavigationStack]
  );

  const clearNavigation = useCallback(() => {
    updateNavigationStack([]);
  }, [updateNavigationStack]);

  const goBack = useCallback(() => {
    const current = navigationStackRef.current[navigationStackRef.current.length - 1];
    if (!current) return;
    if (typeof current.onBack === 'function') {
      current.onBack();
      return;
    }
    removeNavigation(current.id);
  }, [removeNavigation]);

  // Sozlamalarni yuklash.
  const loadSettings = useCallback(async () => {
    try {
      const s = await api.get('/settings');
      setSettings(s);
      setLangState(s.language || 'uz');
      setThemeState(normalizeTheme(s.theme));
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Mavzuni <html> ga qo'llash + localStorage (qayta ochilganda miltillamasin).
  // Telegram'ning o'z ranglarini ishlatmaymiz — premium palitra doim ko'rinadi.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    clearTelegramTheme();
    try {
      localStorage.setItem('theme', theme);
    } catch {
      /* localStorage mavjud bo'lmasligi mumkin */
    }
  }, [theme]);

  const setLang = async (newLang) => {
    setLangState(newLang);
    try {
      const s = await api.put('/settings', { language: newLang });
      setSettings(s);
    } catch (err) {
      setError(err.message);
    }
  };

  const setTheme = async (newTheme) => {
    setThemeState(newTheme);
    try {
      const s = await api.put('/settings', { theme: newTheme });
      setSettings(s);
    } catch (err) {
      setError(err.message);
    }
  };

  const t = makeT(lang);

  return (
    <AppContext.Provider
      value={{
        settings,
        setSettings,
        lang,
        setLang,
        theme,
        setTheme,
        t,
        loaded,
        error,
        loadSettings,
        navigationStack,
        pushNavigation,
        removeNavigation,
        clearNavigation,
        goBack,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp AppProvider ichida ishlatilishi kerak');
  return ctx;
}
