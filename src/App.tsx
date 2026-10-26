import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { BootScreen } from './components/BootScreen';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SearchProvider } from './components/SearchOverlay';
import { SiteLayout } from './components/SiteLayout';
import { Spinner } from './components/Spinner';
import { GameCardSkeleton, LoadingAnnouncement } from './components/States';
import { ThemeProvider } from './components/ThemeProvider';
import { CatalogueProvider } from './lib/catalogue';
import { initAmbient } from './lib/ambient';
import { SiteContentProvider } from './lib/site-content';

/* Route-level code splitting: the home page ships without the library page, the
   library ships without the game runtime, and the whole dashboard is only
   downloaded by someone who visits /admin. */
const HomePage = lazy(() => import('./pages/HomePage'));
const GamesPage = lazy(() => import('./pages/GamesPage'));
const GameDetailPage = lazy(() => import('./pages/GameDetailPage'));
const AboutPage = lazy(() => import('./pages/AboutPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

const AdminLayout = lazy(() => import('./pages/admin/AdminLayout'));
const AdminOverviewPage = lazy(() => import('./pages/admin/AdminOverviewPage'));
const AdminGamesPage = lazy(() => import('./pages/admin/AdminGamesPage'));
const AdminNewGamePage = lazy(() => import('./pages/admin/AdminNewGamePage'));
const AdminGameEditorPage = lazy(() => import('./pages/admin/AdminGameEditorPage'));
const AdminContentPage = lazy(() => import('./pages/admin/AdminContentPage'));
const AdminAppearancePage = lazy(() => import('./pages/admin/AdminAppearancePage'));
const AdminSocialPage = lazy(() => import('./pages/admin/AdminSocialPage'));
const AdminMusicPage = lazy(() => import('./pages/admin/AdminMusicPage'));
const AdminSecurityPage = lazy(() => import('./pages/admin/AdminSecurityPage'));

/** Skeleton fallback that matches the real page footprint, so nothing jumps. */
function RouteFallback({ label, variant = 'page' }: { label: string; variant?: 'page' | 'grid' }) {
  return (
    <div className="container page route-skeleton">
      <LoadingAnnouncement label={label} />
      <div className="stack stack--lg">
        {/* The indicator and the placeholders share the page: the blocks reserve
            the real footprint so nothing jumps, and the spinner says a route is
            still arriving rather than that the page is empty. */}
        <p className="loading-row">
          <Spinner shape="dots" size="sm" />
          {label}
        </p>
        <div className="skeleton" style={{ height: 44, width: 'min(420px, 70%)' }} />
        <div className="skeleton" style={{ height: 18, width: 'min(620px, 90%)' }} />
        {variant === 'grid' ? <GameCardSkeleton count={6} /> : <div className="skeleton" style={{ height: 280 }} />}
      </div>
    </div>
  );
}

export default function App() {
  /* One ambient player for the whole application: mounted here, at the shell,
     so route changes can never start a second copy of the track. */
  useEffect(() => initAmbient(), []);

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <CatalogueProvider>
          {/* Editable page content and the background settings, loaded once for
              every public page. The game player route is outside this provider:
              nothing decorative is ever mounted over a running build. */}
          <SiteContentProvider>
          <SearchProvider>
            <Routes>
              {/* ------------------------------------------------- dashboard */}
              <Route
                path="/admin"
                element={
                  <Suspense fallback={<RouteFallback label="Loading the dashboard" />}>
                    <AdminLayout />
                  </Suspense>
                }
              >
                <Route
                  index
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the overview" />}>
                      <AdminOverviewPage />
                    </Suspense>
                  }
                />
                <Route
                  path="games"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading your games" variant="grid" />}>
                      <AdminGamesPage />
                    </Suspense>
                  }
                />
                <Route
                  path="games/new"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the uploader" />}>
                      <AdminNewGamePage />
                    </Suspense>
                  }
                />
                <Route
                  path="games/:id"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the editor" />}>
                      <AdminGameEditorPage />
                    </Suspense>
                  }
                />
                <Route
                  path="content"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the site content" />}>
                      <AdminContentPage />
                    </Suspense>
                  }
                />
                <Route
                  path="appearance"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the appearance settings" />}>
                      <AdminAppearancePage />
                    </Suspense>
                  }
                />
                <Route
                  path="social"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the social links" />}>
                      <AdminSocialPage />
                    </Suspense>
                  }
                />
                <Route
                  path="music"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the music settings" />}>
                      <AdminMusicPage />
                    </Suspense>
                  }
                />
                <Route
                  path="security"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading account security" />}>
                      <AdminSecurityPage />
                    </Suspense>
                  }
                />
              </Route>

              {/* ------------------------------------------------- public site */}
              <Route element={<SiteLayout />}>
                <Route
                  index
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the home page" />}>
                      <HomePage />
                    </Suspense>
                  }
                />
                <Route
                  path="games"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the games library" variant="grid" />}>
                      <GamesPage />
                    </Suspense>
                  }
                />
                <Route
                  path="games/:slug"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the game page" />}>
                      <GameDetailPage />
                    </Suspense>
                  }
                />
                <Route
                  path="about"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the about page" />}>
                      <AboutPage />
                    </Suspense>
                  }
                />
                <Route
                  path="contact"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the contact page" />}>
                      <ContactPage />
                    </Suspense>
                  }
                />
                <Route
                  path="privacy"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading the privacy page" />}>
                      <PrivacyPage />
                    </Suspense>
                  }
                />
                {/* Legacy / off-site paths land somewhere useful rather than blank. */}
                <Route path="game" element={<Navigate to="/games" replace />} />
                <Route
                  path="*"
                  element={
                    <Suspense fallback={<RouteFallback label="Loading" />}>
                      <NotFoundPage />
                    </Suspense>
                  }
                />
              </Route>
            </Routes>
          </SearchProvider>
          {/* The opening card. Mounted once, above the routes, so it plays on a
              genuine page load and never again during in-app navigation. It
              needs the two data providers, which is why it lives here rather
              than in main.tsx. */}
          <BootScreen />
          </SiteContentProvider>
        </CatalogueProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
