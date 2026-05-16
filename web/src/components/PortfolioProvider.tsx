import type { ReactNode } from 'react';
import { PortfolioContext } from '@/lib/portfolio-context';
import { usePortfolioProvider } from '@/hooks/usePortfolio';

export function PortfolioProvider({ children }: { children: ReactNode }) {
  const value = usePortfolioProvider();
  return (
    <PortfolioContext.Provider value={value}>
      {children}
    </PortfolioContext.Provider>
  );
}
