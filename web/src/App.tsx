import { Routes, Route, Navigate } from 'react-router-dom';
import { lazy, Suspense, useState } from 'react';
import Layout from './components/layout/Layout';
import { GatewayProvider } from './components/GatewayProvider';
import { ChartPanelProvider } from './components/chart/ChartPanelContext';
// AgentChat is the primary landing page — keep it eager so the first paint
// on "/" does NOT wait on a second network round-trip. Every other route is
// a secondary view and can be fetched on demand via React.lazy.
import AgentChat from './pages/AgentChat';
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Tools = lazy(() => import('./pages/Tools'));
const Skills = lazy(() => import('./pages/Skills'));
const Cron = lazy(() => import('./pages/Cron'));
const Memory = lazy(() => import('./pages/Memory'));
const Config = lazy(() => import('./pages/Config'));
const Cost = lazy(() => import('./pages/Cost'));
const Logs = lazy(() => import('./pages/Logs'));
const Sessions = lazy(() => import('./pages/Sessions'));
const ChartPage = lazy(() => import('./pages/Chart'));
import { setLocale, type Locale } from './lib/i18n';
import { LocaleContext } from './contexts/LocaleContext';

export default function App() {
  const [locale, setLocaleState] = useState<Locale>('en');

  const setAppLocale = (newLocale: Locale) => {
    setLocaleState(newLocale);
    setLocale(newLocale);
  };

  return (
    <GatewayProvider>
      <LocaleContext.Provider value={{ locale, setAppLocale }}>
        <ChartPanelProvider>
          <div className="app-fade-in" style={{ minHeight: '100dvh' }}>
            {/*
              Suspense fallback is intentionally minimal (no <LoadingScreen>)
              because LoadingScreen also applies `.app-fade-in` — having two
              `.app-fade-in` elements breaks Playwright strict-mode locators
              in the smoke suite and confuses screen-reader landmark counts.
              Route chunks load from the same origin (localhost in dev, same
              origin in prod) so this gap is ~100-200 ms; a bare transparent
              element is calmer than a second full-viewport spinner.
            */}
            <Suspense fallback={<div aria-busy="true" />}>
              <Routes>
                <Route element={<Layout />}>
                  <Route path="/" element={<AgentChat />} />
                  <Route path="/dashboard" element={<Dashboard />} />
                  <Route path="/tools" element={<Tools />} />
                  <Route path="/skills" element={<Skills />} />
                  <Route path="/cron" element={<Cron />} />
                  <Route path="/memory" element={<Memory />} />
                  <Route path="/config" element={<Config />} />
                  <Route path="/cost" element={<Cost />} />
                  <Route path="/logs" element={<Logs />} />
                  <Route path="/sessions" element={<Sessions />} />
                  <Route path="/chart" element={<ChartPage />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Route>
              </Routes>
            </Suspense>
          </div>
        </ChartPanelProvider>
      </LocaleContext.Provider>
    </GatewayProvider>
  );
}
