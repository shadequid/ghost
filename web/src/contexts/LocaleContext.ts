import { createContext, useContext } from 'react';
import type { Locale } from '@/lib/i18n';

// Locale context
interface LocaleContextType {
  locale: Locale;
  setAppLocale: (locale: Locale) => void;
}

export const LocaleContext = createContext<LocaleContextType>({
  // Default matches AppContent's initial state ('en'). The prior 'tr' was
  // a stale leftover that would mislead any consumer reading the context
  // outside the <Provider> tree.
  locale: 'en',
  setAppLocale: (_locale: Locale) => {},
});

export const useLocaleContext = () => useContext(LocaleContext);
