import { Outlet, useLocation } from 'react-router-dom';
import { useOfflineWarmup } from '../lib/offline';
import { useRevealObserver } from '../lib/reveal';
import { CookieBanner } from './CookieBanner';
import { DecoBackground } from './Decorations';
import { FloatingChrome, ScrollProgress } from './Chrome';
import { ScrollManager } from './ScrollManager';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';

/**
 * Reveals the elements each page has marked, once they are in view.
 *
 * It lives here rather than inside the pages so there is exactly one observer
 * for the whole public site, re-scanned whenever the route changes — no page can
 * forget to register, and no page can leave an observer behind.
 */
function RevealManager() {
  const { pathname } = useLocation();
  useRevealObserver(pathname);
  return null;
}

/**
 * The shell every route renders inside: skip link, header, main landmark,
 * footer, the animated background, and the site-wide chrome (scroll progress,
 * floating controls, privacy banner). Route changes are handled here too, so
 * every page behaves the same.
 */
export function SiteLayout() {
  useOfflineWarmup();

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      {/* One decorative layer for the whole public site. It is inert, sits
          behind the content, and is never mounted inside the game player. */}
      <DecoBackground />

      <ScrollProgress />
      <ScrollManager />
      <RevealManager />

      <SiteHeader />

      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>

      <SiteFooter />

      <FloatingChrome />
      <CookieBanner />
    </>
  );
}
