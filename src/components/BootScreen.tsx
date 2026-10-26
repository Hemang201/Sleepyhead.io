import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { site } from '../data/site';
import { BOOT_STEPS, GREETINGS, finishBoot, hasSeenIntro, markIntroSeen, shouldSkipIntro } from '../lib/boot';
import { useCatalogue } from '../lib/catalogue';
import { usePrefersReducedMotion } from '../lib/hooks';
import { useSiteContent } from '../lib/site-content';

/* ------------------------------------------------------------------ timing */

/** A first visit: long enough for the greeting cycle to read as deliberate. */
const MIN_FIRST_MS = 1400;
/** A repeat visit inside the same browser: a short, quiet version. */
const MIN_QUICK_MS = 420;
/** Reduced motion: still a card, but a jump cut. */
const MIN_STILL_MS = 300;
/**
 * The ceiling. A request that hangs can never trap the visitor behind the
 * opening, so the card leaves on time and the page shows its own loading or
 * error state underneath — which is more honest than an endless title card.
 */
const MAX_MS = 5000;
/** Cadence of the greeting changes. Slow enough to read, quick enough to feel. */
const GREETING_MS = 700;
/** How often the conditions are re-checked. */
const TICK_MS = 80;

export interface BootScreenProps {
  /** Called once, after the card has finished leaving. */
  onDone?: () => void;
}

/**
 * The opening sequence.
 *
 * Shown only while the application is genuinely initialising, and only on a real
 * full-page load: the component is mounted once at the root of the app, so
 * navigating between routes never brings it back. It reports what it is waiting
 * for as a step count — the number of things that have actually settled — never
 * as an invented percentage.
 *
 * While the card is up, `#root` is marked `inert`, so nothing behind it can be
 * clicked, tapped or focused; the app becomes interactive again the moment the
 * card starts leaving, so the fade is never dead time.
 */
export function BootScreen({ onDone }: BootScreenProps) {
  const { status: catalogueStatus } = useCatalogue();
  const { status: contentStatus } = useSiteContent();
  const reduced = usePrefersReducedMotion();

  const [fontsReady, setFontsReady] = useState(false);
  const [greeting, setGreeting] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  /* Read once: whether this browser has seen an opening before, and whether it
     has opted out of the opening entirely. */
  const [firstVisit] = useState(() => (typeof window === 'undefined' ? true : !hasSeenIntro()));
  const [skip] = useState(() => (typeof window === 'undefined' ? false : shouldSkipIntro()));
  const startedAt = useRef(typeof performance === 'undefined' ? Date.now() : performance.now());

  /* ------------------------------------------------------------- readiness */

  useEffect(() => {
    let cancelled = false;
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (!fonts) {
      setFontsReady(true);
      return;
    }
    fonts.ready.then(
      () => {
        if (!cancelled) setFontsReady(true);
      },
      () => {
        /* A font that fails to load is not a reason to hold the page back. */
        if (!cancelled) setFontsReady(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const settled = useMemo(() => {
    const done: string[] = [];
    if (catalogueStatus !== 'loading') done.push(BOOT_STEPS[0]);
    if (contentStatus !== 'loading') done.push(BOOT_STEPS[1]);
    if (fontsReady) done.push(BOOT_STEPS[2]);
    return done;
  }, [catalogueStatus, contentStatus, fontsReady]);

  const ready = settled.length === BOOT_STEPS.length;

  /* ------------------------------------------------------------ the exit */

  useEffect(() => {
    if (leaving) return;
    const minimum = reduced ? MIN_STILL_MS : firstVisit ? MIN_FIRST_MS : MIN_QUICK_MS;

    const tick = window.setInterval(() => {
      const elapsed = performance.now() - startedAt.current;
      if ((ready && elapsed >= minimum) || elapsed >= MAX_MS) {
        window.clearInterval(tick);
        setLeaving(true);
      }
    }, TICK_MS);

    return () => window.clearInterval(tick);
  }, [firstVisit, leaving, ready, reduced]);

  /* The greeting cycle. Reduced motion gets one static word instead. */
  useEffect(() => {
    setGreeting(0);
    if (reduced || !firstVisit || leaving) return;
    const timer = window.setInterval(() => setGreeting((index) => (index + 1) % GREETINGS.length), GREETING_MS);
    return () => window.clearInterval(timer);
  }, [firstVisit, leaving, reduced]);

  /* Leave, then unmount. The removal is what makes the page interactive, so it
     is kept separate from the animation itself. */
  useEffect(() => {
    if (!leaving) return;
    markIntroSeen();
    /* Lifts the gate the animated hero is waiting on, so the headline starts
       typing as the card fades rather than behind it. */
    finishBoot();
    const timer = window.setTimeout(
      () => {
        setGone(true);
        onDone?.();
      },
      reduced ? 60 : 520,
    );
    return () => window.clearTimeout(timer);
  }, [leaving, onDone, reduced]);

  /* While the card is up, the application underneath is unreachable. It becomes
     reachable at the start of the exit, not at the end of it. */
  useEffect(() => {
    if (skip) return;
    const root = document.getElementById('root');
    if (!root) return;
    root.inert = !leaving;
    return () => {
      root.inert = false;
    };
  }, [leaving, skip]);

  /* Nothing is shown and nothing is waited for when the opening is skipped —
     but the hero's gate still has to lift, or the headline would sit idle for
     the length of its own backstop. */
  useEffect(() => {
    if (skip) finishBoot();
  }, [skip]);

  if (skip || gone || typeof document === 'undefined') return null;

  const done = settled.length;
  const total = BOOT_STEPS.length;
  const pending = BOOT_STEPS.find((step) => !settled.includes(step));
  const current = GREETINGS[greeting] ?? GREETINGS[0];

  const node = (
    <div
      className={`boot${leaving ? ' is-leaving' : ''}`}
      data-boot=""
      data-boot-step={done}
      data-boot-total={total}
      data-boot-ready={ready ? 'true' : 'false'}
      role="status"
      aria-live="polite"
      aria-label={`Loading ${site.siteTitle}`}
    >
      <div className="boot__rail">
        <p className="boot__brand">
          {site.developerName}
          <span aria-hidden="true">—</span>
          <span>Indie game developer</span>
        </p>
        <p className="rail">
          <span>Browser arcade</span>
          <span className="rail__sep" aria-hidden="true" />
          <span>{String(done).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
        </p>
      </div>

      <div className="boot__center">
        {/* The greeting is a flourish, not information: the live region above
            carries the honest status and this stays out of the accessibility
            tree, so nobody hears ten languages announced in a row. */}
        <span className="boot__greet" data-boot-greeting aria-hidden="true">
          <span className="boot__greet-word" lang={current.lang} key={`${greeting}-${current.lang}`}>
            {current.text}
          </span>
        </span>
        <p className="boot__tagline">Loading ideas into playable worlds.</p>

        <div className="boot__progress">
          <span className="boot__bar" aria-hidden="true">
            <span
              className="boot__bar-fill"
              data-boot-bar
              style={{ transform: `scaleX(${done / total})` }}
            />
          </span>
          <span className="boot__status">
            <span data-boot-pending>{pending ? `Waiting for ${pending}` : 'Ready'}</span>
            <span aria-hidden="true">{current.note}</span>
          </span>
        </div>
      </div>

      <div className="boot__foot">
        <p className="rail" aria-hidden="true">
          <span>{site.productionDomain || 'local build'}</span>
          <span className="rail__sep" />
          <span>Boot sequence</span>
        </p>
        <span className="boot__marks" aria-hidden="true">
          <span className="boot__shape boot__shape--circle" />
          <span className="boot__shape boot__shape--square" />
          <span className="boot__shape boot__shape--cross" />
        </span>
      </div>
    </div>
  );

  return createPortal(node, document.body);
}
