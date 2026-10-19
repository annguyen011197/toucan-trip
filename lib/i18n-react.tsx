"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectLang, isLang, translator, type Lang, type Translate } from "./i18n";

const LANG_KEY = "toucan-trip:lang";

interface I18nValue { lang: Lang; setLang: (l: Lang) => void; t: Translate }

const I18nContext = createContext<I18nValue | null>(null);

/**
 * UI language. Lives above auth so the sign-in screen is translated too: the last choice on this
 * device (localStorage), else the browser language. Once signed in, the profile's language wins.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    let saved: string | null = null;
    try { saved = localStorage.getItem(LANG_KEY); } catch { /* ignore */ }
    setLangState(isLang(saved) ? saved : detectLang());
  }, []);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  }, []);

  const value = useMemo(() => ({ lang, setLang, t: translator(lang) }), [lang, setLang]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside I18nProvider");
  return ctx;
}
