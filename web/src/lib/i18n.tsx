import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

export type Lang = 'fa' | 'en';

interface LangContextValue {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (lang: Lang) => void;
  toggle: () => void;
  /** Pick the Persian or English string for the active language. */
  t: (fa: string, en: string) => string;
  /** Format a number with locale-aware digits. */
  n: (value: number | string) => string;
}

const LangContext = createContext<LangContextValue | null>(null);
const STORAGE_KEY = 'pn_lang';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'en' ? 'en' : 'fa';
  });

  useEffect(() => {
    const dir = lang === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    localStorage.setItem(STORAGE_KEY, lang);
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const toggle = useCallback(() => setLangState((prev) => (prev === 'fa' ? 'en' : 'fa')), []);

  const value = useMemo<LangContextValue>(
    () => ({
      lang,
      dir: lang === 'fa' ? 'rtl' : 'ltr',
      setLang,
      toggle,
      t: (fa: string, en: string) => (lang === 'fa' ? fa : en),
      n: (input: number | string) =>
        typeof input === 'number'
          ? new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US').format(input)
          : input,
    }),
    [lang, setLang, toggle],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangContextValue {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useLang must be used inside LanguageProvider');
  return ctx;
}
