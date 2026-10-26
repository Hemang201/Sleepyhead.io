/**
 * Boot screen data and the "has this visitor seen the opening" flag.
 *
 * Greetings are real translations, each tagged with its language so the card can
 * set `lang` on the element: that is what makes a screen reader pronounce
 * こんにちは as Japanese rather than spelling it out, and what lets the browser
 * pick the right fallback face for the script.
 *
 * The flag is a single non-sensitive preference in localStorage — no
 * authentication, no identifiers. If storage is unavailable (private mode, a
 * blocked-cookie policy) the card simply behaves as it does on a first visit.
 */

import { useSyncExternalStore } from 'react';

export interface Greeting {
  text: string;
  /** BCP-47 tag for the `lang` attribute. */
  lang: string;
  /** Romanised reading, shown as a quiet caption so the word is readable. */
  note: string;
}

export const GREETINGS: Greeting[] = [
  { text: 'Hello', lang: 'en', note: 'English' },
  { text: 'Hola', lang: 'es', note: 'Español' },
  { text: 'Bonjour', lang: 'fr', note: 'Français' },
  { text: 'Ciao', lang: 'it', note: 'Italiano' },
  { text: 'Hallo', lang: 'de', note: 'Deutsch' },
  { text: 'Olá', lang: 'pt', note: 'Português' },
  { text: 'こんにちは', lang: 'ja', note: '日本語' },
  { text: '你好', lang: 'zh', note: '中文' },
  { text: '안녕하세요', lang: 'ko', note: '한국어' },
  { text: 'नमस्ते', lang: 'hi', note: 'हिन्दी' },
];

/* --------------------------------------------------------------- the gate */

/**
 * `booting` until the opening card starts leaving, then `done` for the rest of
 * the page load.
 *
 * The animated hero hangs off this: the first thing a visitor should see after
 * the card is the headline typing itself on, and without the gate the typing
 * would have already finished behind the card. A `useSyncExternalStore` store
 * rather than context, because the hero is deep inside the route tree and the
 * card is mounted outside it.
 */
export type BootPhase = 'booting' | 'done';

let phase: BootPhase = 'booting';
const listeners = new Set<() => void>();

function readPhase(): BootPhase {
  return phase;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called by the opening card the moment it begins its exit. */
export function finishBoot(): void {
  if (phase === 'done') return;
  phase = 'done';
  for (const listener of [...listeners]) listener();
}

/** Reads the gate, and re-renders the caller when it lifts. */
export function useBootPhase(): BootPhase {
  return useSyncExternalStore(subscribe, readPhase, readPhase);
}

const SEEN_KEY = 'hg.boot.v1';

/** True when this browser has already seen an opening sequence. */
export function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === 'seen';
  } catch {
    return false;
  }
}

/**
 * Records that the opening has been played. Deliberately best-effort: a browser
 * that refuses storage must never break the page.
 */
export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, 'seen');
  } catch {
    /* Storage is optional here. */
  }
}

/**
 * The explicit opt-out: `localStorage['hg.boot.v1'] = 'skip'`.
 *
 * Set by the behavioural test suite so its timings stay deterministic, and
 * available to anyone who would rather the site went straight to the page. The
 * value is a plain preference, never a credential — and the opening itself is
 * still audited from a clean profile by `npm run audit:design`, which is where
 * its behaviour is actually proven.
 */
export const INTRO_SKIP_VALUE = 'skip';

export function shouldSkipIntro(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === INTRO_SKIP_VALUE;
  } catch {
    return false;
  }
}

/** The three things the opening actually waits for, in the order they settle. */
export const BOOT_STEPS = ['catalogue', 'page content', 'typefaces'] as const;
export type BootStep = (typeof BOOT_STEPS)[number];
