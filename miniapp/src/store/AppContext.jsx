// Ilova holati: til, mavzu, sozlamalar. Backend bilan sinxronlanadi.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
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
      value={{ settings, setSettings, lang, setLang, theme, setTheme, t, loaded, error, loadSettings }}
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
