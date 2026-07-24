import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { useAppState } from '../state/AppState';
import { setPreferredLocale } from '../utils/time';
import { AppLanguage, localeByLanguage, TranslationKey, translations } from './translations';

type TranslateParams = Record<string, string | number | null | undefined>;

type I18nContextValue = {
  language: AppLanguage;
  locale: string;
  t: (key: TranslationKey, params?: TranslateParams) => string;
};

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  locale: localeByLanguage.en,
  t: (key) => key,
});

const interpolate = (template: string, params?: TranslateParams): string => {
  if (!params) return template;
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, rawKey: string) => {
    const value = params[rawKey];
    return value == null ? '' : String(value);
  });
};

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { state } = useAppState();
  const language: AppLanguage = state.prefs.language ?? 'en';
  const locale = localeByLanguage[language];

  useEffect(() => {
    setPreferredLocale(locale);
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    locale,
    t: (key, params) => {
      const dictionary = translations[language] as Record<string, string>;
      const englishFallback = translations.en as Record<string, string>;
      const raw = dictionary[key] ?? englishFallback[key] ?? key;
      return interpolate(raw, params);
    },
  }), [language, locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nContextValue => useContext(I18nContext);
