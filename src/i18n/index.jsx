import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { DEFAULT_LOCALE, LOCALES, TRANSLATIONS } from './translations.js';
import { translate } from './translate.js';

const STORAGE_KEY = 'truelazer.locale';

const readStoredLocale = () => {
    try {
        const stored = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
        return TRANSLATIONS[stored] ? stored : DEFAULT_LOCALE;
    } catch {
        return DEFAULT_LOCALE;
    }
};

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
    const [locale, setLocaleState] = useState(readStoredLocale);

    const setLocale = useCallback((nextLocale) => {
        const resolved = TRANSLATIONS[nextLocale] ? nextLocale : DEFAULT_LOCALE;
        setLocaleState(resolved);
        try { if (typeof window !== 'undefined' && window.electronAPI?.setLocale) window.electronAPI.setLocale(resolved); } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        try {
            if (typeof window !== 'undefined') {
                window.localStorage.setItem(STORAGE_KEY, locale);
                document.documentElement.lang = locale;
            }
        } catch {
            /* Persistence is best-effort; the session still translates. */
        }
    }, [locale]);

    const t = useCallback((key, params) => translate(locale, key, params), [locale]);

    useEffect(() => {
        try { if (typeof window !== 'undefined' && window.electronAPI?.setLocale) window.electronAPI.setLocale(locale); } catch { /* ignore */ }
    }, [locale]);

    const value = useMemo(() => ({
        locale,
        setLocale,
        t,
        locales: LOCALES,
    }), [locale, setLocale, t]);

    return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation() {
    const context = useContext(LanguageContext);
    if (context) return context;
    // Allows components (and tests) to render outside the provider.
    return {
        locale: DEFAULT_LOCALE,
        setLocale: () => {},
        t: (key, params) => translate(DEFAULT_LOCALE, key, params),
        locales: LOCALES,
    };
}
