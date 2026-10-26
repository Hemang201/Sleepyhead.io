import { site } from '../data/site';
import { readRaw } from './storage';

/**
 * Privacy-friendly analytics hook — deliberately inert.
 *
 * No analytics, advertising or tracking script is loaded by this site. If you
 * later add a privacy-friendly provider (Plausible, Umami, Fathom, GoatCounter),
 * this is the only file you need to touch:
 *
 *   1. Set `features.analytics: true` in src/data/site.ts.
 *   2. Load the provider's script behind the consent check in `hasAnalyticsConsent()`.
 *   3. Forward the `track()` calls already wired into the UI.
 *
 * Until then `track()` is a no-op, which also keeps the event names documented.
 */

export type AnalyticsEvent =
  | 'game_launched'
  | 'game_launch_blocked'
  | 'game_build_error'
  | 'search_opened'
  | 'search_used'
  | 'filter_changed'
  | 'theme_changed'
  | 'ambient_music_toggled'
  | 'contact_email_copied';

interface AnalyticsBridge {
  (event: AnalyticsEvent, props?: Record<string, unknown>): void;
}

declare global {
  interface Window {
    /** Optional provider hook — set by an analytics script you add yourself. */
    hgAnalytics?: AnalyticsBridge;
  }
}

export function hasAnalyticsConsent(): boolean {
  if (!site.features.analytics) return false;
  const stored = readRaw('hg.analytics-consent.v1');
  return stored === 'granted';
}

export function track(event: AnalyticsEvent, props: Record<string, unknown> = {}): void {
  if (!hasAnalyticsConsent()) return;
  try {
    window.hgAnalytics?.(event, props);
  } catch {
    /* analytics must never break the experience */
  }
}
