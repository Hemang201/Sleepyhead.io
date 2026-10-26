import { useEffect } from 'react';

const REVEALED = 'is-revealed';
const SELECTOR = '[data-reveal], [data-reveal-group]';
const PENDING = `${SELECTOR}:not(.${REVEALED})`;

declare global {
  interface Window {
    /** Set by this hook so the inline safety timer in index.html knows the
     * reveal system initialised and must not strip the hidden state. */
    __hgReveal?: boolean;
  }
}

/**
 * Reveals marked elements as they come into view — once each.
 *
 * The hidden state is CSS that only applies while `html.js-reveal` is set, and
 * that class is added before first paint and only when the visitor has not asked
 * for reduced motion. So this hook is a pure enhancement: with reduced motion,
 * without JavaScript, or if the observer never runs, everything is already
 * visible and nothing is stranded behind an animation that will not happen.
 *
 * Elements inside the first screenful are revealed immediately rather than
 * animated, so the top of a page is never a blank stage waiting for a scroll
 * that never comes.
 *
 * A MutationObserver re-scans as the page changes. That is not belt-and-braces:
 * routes are code-split, so the sections this hook is meant to reveal are not in
 * the DOM when the shell mounts. Without the rescan nothing below the fold would
 * ever be observed — which is exactly the failure this system could otherwise
 * ship with.
 *
 * @param key Re-scan whenever this changes — the current route, in practice.
 */
export function useRevealObserver(key?: unknown): void {
  useEffect(() => {
    const root = document.documentElement;
    window.__hgReveal = true;

    const show = (node: HTMLElement) => node.classList.add(REVEALED);

    if (typeof IntersectionObserver === 'undefined') {
      document.querySelectorAll<HTMLElement>(PENDING).forEach(show);
      root.classList.remove('js-reveal');
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          show(entry.target as HTMLElement);
          observer.unobserve(entry.target);
        }
      },
      // A little early, so the movement is finishing as the element settles into
      // view instead of starting after it has already been read.
      { rootMargin: '0px 0px -6% 0px', threshold: 0.08 },
    );

    const scan = () => {
      const fold = window.innerHeight * 0.92;
      for (const node of document.querySelectorAll<HTMLElement>(PENDING)) {
        if (node.getBoundingClientRect().top < fold) show(node);
        else observer.observe(node);
      }
    };

    scan();

    let frame = 0;
    const mutations = new MutationObserver(() => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        scan();
      });
    });
    mutations.observe(document.body, { childList: true, subtree: true });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      mutations.disconnect();
      observer.disconnect();
    };
  }, [key]);
}
