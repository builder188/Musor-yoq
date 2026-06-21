// Ilova holati: til, mavzu, sozlamalar. Backend bilan sinxronlanadi.
import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api/client.js';
import { makeT } from '../i18n/index.js';
import { getColorScheme, applyTelegramTheme, clearTelegramTheme, onThemeChanged } from '../telegram.js';

const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [lang, setLangState] = useState('uz');
  // theme: 'auto' (Telegram bilan sinxron) | 'light' | 'dark'
  const [theme, setThemeState] = useState('auto');
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);

  // Sozlamalarni yuklash.
  const loadSettings = useCallback(async () => {
    try {
      const s = await api.get('/settings');
      setSettings(s);
      setLangState(s.language || 'uz');
      setThemeState(s.theme || 'auto');
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

  // Mavzuni <html> ga qo'llash.
  // 'auto' — Telegram colorScheme + themeParams bilan sinxron (o'zgarishini ham kuzatamiz).
  // 'light'/'dark' — foydalanuvchi tanlovi, o'z palitramiz ishlaydi.
  useEffect(() => {
    const applyAuto = () => {
      document.documentElement.setAttribute('data-theme', getColorScheme());
      applyTelegramTheme();
    };

    if (theme === 'auto') {
      applyAuto();
      return onThemeChanged(applyAuto);
    }

    document.documentElement.setAttribute('data-theme', theme);
    clearTelegramTheme();
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
