import { useEffect, useId, useRef, useState } from 'react';

import { usePrefersReducedMotion } from '../lib/hooks';

/**
 * The flowing chain of game words — the site's signature graphic.
 *
 * A ribbon of game-development vocabulary travels along a curved path, drawn
 * with SVG `textPath` so the words genuinely follow the curve (each glyph is
 * rotated by the path tangent) rather than being a row of absolutely positioned
 * words pretending to bend. Two layers give it depth: a smaller, lower-contrast
 * trail above the main ribbon, moving at its own speed and phase.
 *
 * The one hard problem here is the loop. A textPath only renders the characters
 * that fall inside the path's length, so the animation walks `startOffset` from
 * `0` to `-L` (the path length). For the wrap to be invisible, the visible
 * window at the end must be identical to the window at the start — which is
 * only true when the path length is an exact whole number of word cycles.
 * So the geometry is *measured*, not guessed:
 *
 *   1. measure the path (`getTotalLength`) and one cycle of the words at a
 *      known font size (`getComputedTextLength`), which gives the length of a
 *      cycle per unit of font size;
 *   2. choose the whole number of cycles that best fits the path at the design
 *      size, then solve the font size that makes the fit exact;
 *   3. repeat the cycle enough times to cover twice the path, so no gap can
 *      ever appear at the tail.
 *
 * That makes the loop seam-free at any width, because the path never changes —
 * only its rendered scale does (the SVG scales uniformly and crops).
 *
 * Everything else is deliberately conservative: no canvas, no library, no
 * per-frame JavaScript (the movement is SMIL, run by the compositor), the layer
 * is `aria-hidden` with `pointer-events: none`, it pauses while the tab is
 * hidden, and reduced motion gets the same words as a static arrangement.
 */

type Tone = 'ink' | 'accent' | 'serif';

interface Word {
  text: string;
  tone: Tone;
}

/**
 * The main ribbon's vocabulary. Kept to a handful of words on purpose: the
 * cycle has to fit the path at a legible size, and a ribbon that repeats is a
 * rhythm, while a ribbon that never repeats is noise.
 */
/* Six words, which is what lets the cycle be set large enough to carry the
   band: the fewer words in a cycle, the larger the type the path can hold
   while still being a whole number of cycles long. */
const MAIN_WORDS: Word[] = [
  { text: 'SMALL GAMES', tone: 'ink' },
  { text: 'PLAY', tone: 'accent' },
  { text: 'BIG IDEAS', tone: 'serif' },
  { text: 'PIXELS', tone: 'ink' },
  { text: 'EXPERIMENT', tone: 'serif' },
  { text: 'WHAT IF?', tone: 'accent' },
];

/* The trail carries the rest of the vocabulary at roughly a third of the size,
   which is what reads as depth rather than as a second ribbon. */
const TRAIL_WORDS: Word[] = [
  { text: 'CREATE', tone: 'ink' },
  { text: 'DISCOVER', tone: 'accent' },
  { text: 'PIXEL WORLDS', tone: 'ink' },
  { text: 'GAMEPLAY FIRST', tone: 'serif' },
  { text: 'PHYSICS', tone: 'accent' },
  { text: 'LEVEL UP', tone: 'serif' },
  { text: 'PRESS START', tone: 'ink' },
  { text: 'ONE MORE RUN', tone: 'accent' },
];

/** The words are joined by a geometric bullet in the band's accent colour. */
const SEPARATOR = '\u2022';

/* The two paths, in the SVG's own units. The main ribbon dips and rises across
   the frame; the trail runs above it on a shallower curve. They are hand-tuned
   once here rather than generated, because a path is a drawing. */
/* The frame is 1200 × 200 user units — a shallow band, not a tall one. That
   ratio matters: the SVG is scaled to cover and cropped, so a band whose real
   aspect is close to the frame's shows the whole curve at desktop width and
   crops horizontally (never vertically) on narrow screens, which keeps the
   words legible instead of slicing them into giant diagonal fragments. */
const MAIN_PATH = 'M-140 140 C 60 84, 280 76, 480 132 S 800 182, 1000 126 S 1220 70, 1340 112';
const TRAIL_PATH = 'M-140 38 C 60 12, 280 8, 480 32 S 800 58, 1000 30 S 1220 6, 1340 24';

/** Design sizes in user units, before the exact fit is solved. */
const MAIN_TARGET = 36;
const TRAIL_TARGET = 15;

/** The font size the cycles are measured at. Larger measures more precisely. */
const PROBE_SIZE = 100;

/*
 * Optical sizing is switched off for the ribbon (see `.ribbon__text` in the
 * component stylesheet) and the probe is as well, which is what makes the
 * measurement trustworthy: a font that re-draws its glyphs at different
 * optical sizes (Fraunces does) has advance widths that are NOT proportional
 * to the font size, so a cycle measured at 100px would not predict the same
 * cycle at 33px, and the loop seam would land mid-word. With optical sizing
 * off, width ÷ font-size is a constant and the solved size is exact.
 */

/** Fallback duration if the motion token cannot be read. */
const FALLBACK_DURATION = 46;

/** Reads `--dur-ribbon` so the ribbon's speed lives with every other timing. */
function ribbonDuration(): number {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--dur-ribbon').trim();
    const value = raw.endsWith('ms') ? parseFloat(raw) / 1000 : raw.endsWith('s') ? parseFloat(raw) : NaN;
    return Number.isFinite(value) && value > 0 ? value : FALLBACK_DURATION;
  } catch {
    return FALLBACK_DURATION;
  }
}

interface Layer {
  /** Font size in user units, solved so the path is a whole number of cycles. */
  fontSize: number;
  /** How many times the cycle is repeated along the text content. */
  rounds: number;
  /** Path length in user units. */
  length: number;
  /** Content length ÷ path length. A whole number means a seamless loop. */
  ratio: number;
}

interface Geometry {
  main: Layer;
  trail: Layer;
}

/**
 * Measures one cycle of words, then solves the font size that makes the path an
 * exact multiple of that cycle at approximately the design size.
 */
function solve(pathLength: number, cycleLengthAtProbe: number, target: number): Layer {
  /* Length of one cycle per unit of font size. */
  const perUnit = cycleLengthAtProbe / PROBE_SIZE;
  if (!(perUnit > 0) || !(pathLength > 0)) {
    return { fontSize: target, rounds: 4, length: pathLength, ratio: 0 };
  }
  /* The whole number of cycles that fits the path closest to the design size. */
  const cycles = Math.max(1, Math.round(pathLength / (perUnit * target)));
  const fontSize = pathLength / (cycles * perUnit);
  /* Two full sets of cycles: twice the path, so the tail can never run dry. */
  const rounds = cycles * 2;
  /* Content length ÷ path length: exactly `2 · cycles` by construction, which
     is the property that makes the loop invisible. Exposed so the browser
     suite can assert the seam rather than take it on faith. */
  const ratio = (rounds * fontSize * perUnit) / pathLength;
  return { fontSize, rounds, length: pathLength, ratio };
}

function useRibbonGeometry(
  pathRef: React.RefObject<SVGPathElement | null>,
  probeRef: React.RefObject<SVGTextElement | null>,
  enabled: boolean,
): Geometry | null {
  const [geometry, setGeometry] = useState<Geometry | null>(null);


  useEffect(() => {
    if (!enabled) {
      setGeometry(null);
      return undefined;
    }

    let cancelled = false;
    let attempts = 0;

    /* Fonts change the measurement, so this waits for them — with a bounded
       retry, because a font that never resolves must not leave the ribbon
       unmeasured (and therefore invisible). */
    const measure = () => {
      if (cancelled) return;
      const path = pathRef.current;
      const probe = probeRef.current;
      if (!path || !probe) {
        if (attempts < 20) {
          attempts += 1;
          window.requestAnimationFrame(measure);
        }
        return;
      }

      const length = path.getTotalLength();
      /* The probe holds one cycle of each layer, one after the other, at
         PROBE_SIZE; `getComputedTextLength` reports each span's own advance. */
      const mainProbe = probe.querySelector<SVGTextElement>('[data-probe="main"]');
      const trailProbe = probe.querySelector<SVGTextElement>('[data-probe="trail"]');
      const mainLength = mainProbe?.getComputedTextLength() ?? 0;
      const trailLength = trailProbe?.getComputedTextLength() ?? 0;
      if (!(length > 0) || !(mainLength > 0) || !(trailLength > 0)) {
        if (attempts < 20) {
          attempts += 1;
          window.requestAnimationFrame(measure);
        }
        return;
      }

      setGeometry({
        main: solve(length, mainLength, MAIN_TARGET),
        trail: solve(length, trailLength, TRAIL_TARGET),
      });
    };

    /* The serif only appears inside the ribbon, so it may not have started
       loading when this runs: ask for it explicitly before measuring, or the
       measurement would describe a fallback face and the seam would be visible
       as a small jump once the real one arrived. */
    const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
    if (fonts?.ready) {
      const requested = [
        `${MAIN_TARGET}px 'Syne Variable'`,
        `${MAIN_TARGET}px 'Space Grotesk Variable'`,
        `500 ${MAIN_TARGET}px 'Fraunces Variable'`,
        `italic 500 ${MAIN_TARGET}px 'Fraunces Variable'`,
      ].map((font) => fonts.load(font).catch(() => undefined));
      Promise.all(requested)
        .then(() => fonts.ready)
        .then(measure, measure);
    } else {
      measure();
    }

    return () => {
      cancelled = true;
    };
  }, [enabled, pathRef, probeRef]);

  return geometry;
}

/** Cycles, each one a run of word and separator spans. */
function CycleSpans({ words, cycle }: { words: Word[]; cycle: string }) {
  return (
    <>
      {words.map((word) => (
        <tspan key={`${cycle}-${word.text}`} className={`ribbon__word ribbon__word--${word.tone}`}>
          {word.text}
          <tspan className="ribbon__sep">{` ${SEPARATOR} `}</tspan>
        </tspan>
      ))}
    </>
  );
}

export interface WordRibbonProps {
  /** Rendered even when the visitor prefers reduced motion (as a static frame). */
  className?: string;
}

/**
 * The ribbon band. It is a presentational block with no controls of its own:
 * nothing inside it is focusable, clickable or readable by assistive
 * technology, so it can never intercept a tap or be announced as content.
 */
export function WordRibbon({ className }: WordRibbonProps) {
  const reduced = usePrefersReducedMotion();
  const pathRef = useRef<SVGPathElement>(null);
  const probeRef = useRef<SVGTextElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const mainRef = useRef<SVGTextElement>(null);
  const geometry = useRibbonGeometry(pathRef, probeRef, true);
  const [fit, setFit] = useState<number | null>(null);
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const mainId = `ribbon-main-${uid}`;
  const trailId = `ribbon-trail-${uid}`;
  const duration = ribbonDuration();

  /*
   * The seam, measured rather than asserted. The solve above is arithmetic;
   * this reads what the browser actually laid out and reports the content
   * length as a multiple of the path length. The loop is invisible only when
   * that number is a whole number, so it is published on the element as
   * `data-ribbon-fit` and asserted by the browser suite.
   */
  useEffect(() => {
    if (!geometry) return undefined;
    let cancelled = false;
    const frame = window.requestAnimationFrame(() => {
      if (cancelled) return;
      const length = pathRef.current?.getTotalLength() ?? 0;
      const content = mainRef.current?.getComputedTextLength() ?? 0;
      setFit(length > 0 ? content / length : null);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
    };
  }, [geometry]);

  /* A background tab should not animate a decorative ribbon. SMIL has its own
     pause, so this costs nothing while the page is hidden. */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || reduced) return undefined;
    const update = () => {
      try {
        if (document.visibilityState === 'hidden') svg.pauseAnimations();
        else svg.unpauseAnimations();
      } catch {
        /* A browser without SMIL controls simply keeps animating. */
      }
    };
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, [reduced, geometry]);

  const main = geometry?.main;
  const trail = geometry?.trail;

  return (
    <div
      className={`ribbon${className ? ` ${className}` : ''}`}
      data-ribbon
      data-ribbon-motion={reduced ? 'static' : 'on'}
      data-ribbon-fit={fit === null ? undefined : fit.toFixed(3)}
      aria-hidden="true"
    >
      <svg
        ref={svgRef}
        className="ribbon__svg"
        viewBox="0 0 1200 200"
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <defs>
          <path id={mainId} ref={pathRef} d={MAIN_PATH} fill="none" />
          <path id={trailId} d={TRAIL_PATH} fill="none" />
        </defs>

        {/* The measuring probe: one cycle of each layer, far off the canvas so
            it is measured but never seen. A nested `tspan` is the only legal
            way to subdivide a `text` element, so the two probes are spans. */}
        <text ref={probeRef} className="ribbon__probe" x={-6000} y={-6000} fontSize={PROBE_SIZE}>
          {/* The probe carries the *same* typography classes as the rendered
              layers — family, weight, letter-spacing — because a cycle
              measured in the body font would predict a different length and
              the loop would jump. Only the font size is fixed here. */}
          <tspan data-probe="main" className="ribbon__text ribbon__text--main">
            <CycleSpans words={MAIN_WORDS} cycle="probe-main" />
          </tspan>
          <tspan data-probe="trail" className="ribbon__text ribbon__text--trail">
            <CycleSpans words={TRAIL_WORDS} cycle="probe-trail" />
          </tspan>
        </text>

        {/* The trail: smaller, fainter, slower, its own phase. */}
        {trail ? (
          <text className="ribbon__text ribbon__text--trail" fontSize={trail.fontSize}>
            <textPath href={`#${trailId}`} startOffset={0} className="ribbon__path">
              {Array.from({ length: trail.rounds }, (_, round) => (
                <CycleSpans key={`trail-${round}`} words={TRAIL_WORDS} cycle={`trail-${round}`} />
              ))}
              {!reduced ? (
                <animate
                  attributeName="startOffset"
                  from="0"
                  to={String(-trail.length)}
                  dur={`${(duration * 1.25).toFixed(1)}s`}
                  begin={`-${(duration * 0.4).toFixed(1)}s`}
                  repeatCount="indefinite"
                />
              ) : null}
            </textPath>
          </text>
        ) : null}

        {/* The main ribbon. */}
        {main ? (
          <text ref={mainRef} className="ribbon__text ribbon__text--main" fontSize={main.fontSize}>
            <textPath href={`#${mainId}`} startOffset={0} className="ribbon__path">
              {Array.from({ length: main.rounds }, (_, round) => (
                <CycleSpans key={`main-${round}`} words={MAIN_WORDS} cycle={`main-${round}`} />
              ))}
              {!reduced ? (
                <animate
                  attributeName="startOffset"
                  from="0"
                  to={String(-main.length)}
                  dur={`${duration.toFixed(1)}s`}
                  repeatCount="indefinite"
                />
              ) : null}
            </textPath>
          </text>
        ) : null}

        {/* Two geometric accents anchor the curve at its ends. */}
        <g className="ribbon__accents">
          <circle cx="86" cy="300" r="7" />
          <rect x="1106" y="30" width="13" height="13" rx="1" transform="rotate(18 1112 36)" />
          <path d="M18 96h26M31 83v26" />
        </g>
      </svg>
    </div>
  );
}
