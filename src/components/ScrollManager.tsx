import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { prefersReducedMotion } from '../lib/hooks';

/**
 * Route change behaviour:
 *   - scroll to the top of a new page, or to the `#hash` target when present;
 *   - move focus to <main> so keyboard and screen-reader users land on the new
 *     content instead of staying parked on the nav link they just activated.
 *
 * The focus move deliberately does *not* happen on the very first load: the
 * browser starts at the top of the document, and stealing focus into <main>
 * pushes the skip-to-content link out of the natural first Tab stop.
 *
 * The "have we navigated yet?" test compares the previous path against the
 * current one rather than counting mounts, so React's StrictMode double-invoked
 * effects (dev only) cannot make the first load look like a navigation.
 */
export function ScrollManager() {
  const { pathname, hash } = useLocation();
  const previousPath = useRef<string | null>(null);

  useEffect(() => {
    const behavior: ScrollBehavior = prefersReducedMotion() ? 'auto' : 'smooth';
    const previous = previousPath.current;
    previousPath.current = pathname;

    if (hash) {
      const target = document.getElementById(hash.replace('#', ''));
      if (target) {
        target.scrollIntoView({ behavior, block: 'start' });
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
      return;
    }

    // First load (or a StrictMode re-run of it): leave scroll and focus alone.
    if (previous === null || previous === pathname) return;

    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [pathname, hash]);

  return null;
}
