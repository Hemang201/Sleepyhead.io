import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { RefObject } from 'react';
import {
  applyTheme,
  hasStoredPreference,
  nextTheme,
  persistTheme,
  resolveInitialTheme,
  systemTheme,
  type Theme,
} from './theme';
import { site } from '../data/site';
import type { Store } from './preferences';

/** Subscribes a component to one of the localStorage-backed stores. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(
    useCallback((listener: () => void) => store.subscribe(listener), [store]),
    useCallback(() => store.get(), [store]),
    useCallback(() => store.get(), [store]),
  );
}

/* ------------------------------------------------------------------ theming */

export interface ThemeController {
  theme: Theme;
  toggle: () => void;
  set: (theme: Theme) => void;
}

export function useThemeController(): ThemeController {
  const [theme, setTheme] = useState<Theme>(() => resolveInitialTheme());
  const explicit = useRef(hasStoredPreference());

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Follow the OS while the visitor has never made an explicit choice.
  useEffect(() => {
    if (!site.theme.respectSystemOnFirstVisit || explicit.current) return;
    let query: MediaQueryList;
    try {
      query = window.matchMedia('(prefers-color-scheme: light)');
    } catch {
      return;
    }
    const onChange = () => setTheme(systemTheme());
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const set = useCallback((next: Theme) => {
    explicit.current = true;
    persistTheme(next);
    applyTheme(next);
    setTheme(next);
  }, []);

  return {
    theme,
    set,
    /* The control in the header moves between the two supported paper directions. */
    toggle: useCallback(() => {
      set(nextTheme(theme));
    }, [set, theme]),
  };
}

/* ------------------------------------------------------------------- media */

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let media: MediaQueryList;
    try {
      media = window.matchMedia(query);
    } catch {
      return;
    }
    const onChange = () => setMatches(media.matches);
    onChange();
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/* ------------------------------------------------------------------ scrolling */

/** Page scroll progress from 0 to 1. rAF-throttled and passive. */
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;

    const measure = () => {
      frame = 0;
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight - doc.clientHeight;
      setProgress(scrollable <= 0 ? 0 : Math.min(1, Math.max(0, doc.scrollTop / scrollable)));
    };

    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    };
  }, []);

  return progress;
}

export function useScrolledPast(threshold: number): boolean {
  const [past, setPast] = useState(false);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      setPast(window.scrollY > threshold);
    };
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
    };
  }, [threshold]);

  return past;
}

export const prefersReducedMotion = (): boolean => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function scrollToTop(smooth = true): void {
  const behavior: ScrollBehavior = smooth && !prefersReducedMotion() ? 'smooth' : 'auto';
  try {
    window.scrollTo({ top: 0, behavior });
  } catch {
    window.scrollTo(0, 0);
  }
}

/* -------------------------------------------------------------- focus utils */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/**
 * Moves focus into an overlay, keeps Tab inside it, and returns focus to the
 * element that opened it on close. Escape handling stays with the caller so the
 * close behaviour can differ per overlay.
 */
export function useFocusTrap(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const node = ref.current;
    if (!node) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const focusFirst = () => {
      const target =
        node.querySelector<HTMLElement>('[data-autofocus]') ?? node.querySelector<HTMLElement>(FOCUSABLE) ?? node;
      target.focus({ preventScroll: true });
    };
    const timer = window.setTimeout(focusFirst, 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const focusable = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null || element === document.activeElement,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const current = document.activeElement;

      if (event.shiftKey && (current === first || current === node)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && current === last) {
        event.preventDefault();
        first.focus();
      }
    };

    node.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      node.removeEventListener('keydown', onKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
    };
  }, [active, ref]);
}

export function useEscapeKey(handler: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handler();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handler, active]);
}

/**
 * Locks background scrolling while a modal overlay is open, compensating for the
 * scrollbar so the layout does not jump.
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;
    const { body, documentElement } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const gutter = window.innerWidth - documentElement.clientWidth;

    body.style.overflow = 'hidden';
    if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    documentElement.classList.add('is-scroll-locked');

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
      documentElement.classList.remove('is-scroll-locked');
    };
  }, [locked]);
}

/** Closes popovers on outside pointer/focus, used by the search field + menus. */
export function useClickOutside(ref: RefObject<HTMLElement | null>, handler: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onPointerDown = (event: PointerEvent) => {
      const node = ref.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) handler();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [active, handler, ref]);
}

/** Runs a layout effect on the client only (avoids SSR warnings if ever added). */
export const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/* ---------------------------------------------------------------- clipboard */

export function useCopyToClipboard(resetAfter = 2200): { copied: boolean; failed: boolean; copy: (text: string) => void } {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = window.setTimeout(() => setState('idle'), resetAfter);
    return () => window.clearTimeout(timer);
  }, [resetAfter, state]);

  const copy = useCallback(
    (text: string) => {
      const fallback = () => {
        try {
          const area = document.createElement('textarea');
          area.value = text;
          area.setAttribute('readonly', '');
          area.style.position = 'fixed';
          area.style.opacity = '0';
          document.body.appendChild(area);
          area.select();
          const ok = document.execCommand('copy');
          document.body.removeChild(area);
          setState(ok ? 'copied' : 'failed');
        } catch {
          setState('failed');
        }
      };

      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).then(() => setState('copied'), fallback);
      } else {
        fallback();
      }
    },
    [],
  );

  return { copied: state === 'copied', failed: state === 'failed', copy };
}

/** Live region text used by the copy buttons ("Copied!" / "Press Ctrl+C"). */
export function useAnnouncement(): [string, (message: string) => void] {
  const [message, setMessage] = useState('');
  const announce = useCallback((next: string) => setMessage(next), []);
  return [message, announce];
}
