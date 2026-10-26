import { useEffect, useRef, useState } from 'react';

import { useBootPhase } from '../lib/boot';
import { prefersReducedMotion } from '../lib/hooks';

/** If the opening card never reports in, the headline starts anyway. */
const GATE_TIMEOUT_MS = 6000;

/**
 * True once the headline has been typed on this page load.
 *
 * Module scope on purpose: navigating away from the home page and back mounts a
 * fresh component, and the headline must not start typing again. One page load,
 * one typing pass.
 */
let typedThisLoad = false;

export interface TypewriterHeadlineProps {
  /** The lines, in order. Rendered exactly as given, punctuation included. */
  lines: string[];
  /** Index of the line that carries the gradient treatment. */
  accentIndex?: number;
  /** Fallback step in milliseconds when the CSS token cannot be read. */
  speed?: number;
}

/**
 * Milliseconds per character, read from the motion tokens so timing lives in one
 * place. Falls back to the caller's value in a browser without CSS variables.
 */
function typeStep(fallback: number): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-type').trim();
    const value = raw.endsWith('ms') ? parseFloat(raw) : raw.endsWith('s') ? parseFloat(raw) * 1000 : NaN;
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The hero headline, typed onto the screen.
 *
 * The finished text is in the markup from the first render — inside a
 * visually-hidden span that assistive technology, search and "find in page" all
 * read immediately — while the animated copy is a separate, `aria-hidden` span.
 * A screen reader therefore gets one complete heading, never a stream of single
 * characters, and the heading keeps its full text if the animation never runs.
 *
 * Space is reserved for both lines before the first character appears, so the
 * subhead below cannot move while the text arrives. Reduced motion, or a second
 * pass in the same page load, renders the finished headline at once.
 */
export function TypewriterHeadline({ lines, accentIndex = 1, speed = 46 }: TypewriterHeadlineProps) {
  const full = lines.join(' ');
  const animate = useRef(!typedThisLoad && !prefersReducedMotion());
  const phase = useBootPhase();
  const [typed, setTyped] = useState(() => (animate.current ? 0 : full.length));
  const [done, setDone] = useState(() => !animate.current);
  /* The opening card owns the first second of the page, so the typing waits for
     it. The timeout is a backstop: a headline that never types because a card
     never reported in would be a worse bug than a headline typed early. */
  const [gateOpened, setGateOpened] = useState(false);

  useEffect(() => {
    if (!animate.current || phase === 'done' || gateOpened) return;
    const timer = window.setTimeout(() => setGateOpened(true), GATE_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [gateOpened, phase]);

  useEffect(() => {
    if (!animate.current || (phase === 'booting' && !gateOpened)) {
      if (!animate.current) typedThisLoad = true;
      return;
    }
    typedThisLoad = true;

    const step = typeStep(speed);
    let index = 0;
    let timer = 0;

    const type = () => {
      index += 1;
      setTyped(index);
      if (index >= full.length) {
        setDone(true);
        return;
      }
      /* A full stop gets a longer beat: that is what makes a typed line sound
         like a sentence rather than a metronome. */
      const character = full[index - 1] ?? '';
      timer = window.setTimeout(type, character === '.' ? step * 5 : step);
    };

    timer = window.setTimeout(type, step * 2);
    return () => window.clearTimeout(timer);
  }, [full, gateOpened, phase, speed]);

  /* The typed slices. `cursor` walks the joined string, including the space
     between the lines, so the two lines arrive as one continuous sentence. */
  let cursor = typed;
  const visible = lines.map((line) => {
    const slice = line.slice(0, Math.max(0, Math.min(line.length, cursor)));
    cursor -= line.length + 1;
    return slice;
  });
  const activeLine = visible.findIndex((slice, index) => slice.length < lines[index].length);

  return (
    <h1 className={`hero__title${done ? ' is-done' : ''}`} id="hero-heading" data-typed={done ? 'done' : 'typing'}>
      {/* The real heading, complete from the first render. */}
      <span className="visually-hidden">{full}</span>

      {/* Everything in here is decoration, so it stays out of the accessibility
          tree: a duplicate heading can never be announced, and the real one is
          the span above. */}
      <span className="hero__title-stage" aria-hidden="true">
        {/* The finished headline, invisible but in flow. It is the element that
            decides how tall this heading is — two lines, or three when the
            phrase wraps at this width — so the animated copy can never change
            the layout as it types. */}
        <span className="hero__title-ghost">
          {lines.map((line, index) => (
            <span className={`hero__title-line${index === accentIndex ? ' hero__title-accent' : ''}`} key={line}>
              {line}
            </span>
          ))}
        </span>

        {/* The animated copy, laid over the ghost rather than inside it. */}
        <span className="hero__title-visual" data-typed-headline>
          {lines.map((line, index) => (
            <span className={`hero__title-line${index === accentIndex ? ' hero__title-accent' : ''}`} key={line}>
              {visible[index]}
              {/* The caret sits on whichever line is currently being typed. */}
              {!done && (activeLine === index || (activeLine === -1 && index === lines.length - 1)) ? (
                <span className="hero__title-caret" data-typed-caret />
              ) : null}
            </span>
          ))}
        </span>
      </span>

      {/* The finish: one gesture, drawn under the completed headline. */}
      <span className="hero__title-rule" />
    </h1>
  );
}
