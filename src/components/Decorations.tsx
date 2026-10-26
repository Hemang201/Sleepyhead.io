/**
 * The decorative background: a small, fixed set of lightweight SVG shapes that
 * travel across the viewport and bounce off its edges.
 *
 * Movement is real, not decorative spinning: one `requestAnimationFrame` loop
 * per mounted layer keeps an independent position and velocity for every mark,
 * integrates it with delta time, and reflects the velocity component when the
 * mark reaches a boundary. CSS keyframes cannot do that — they can only move a
 * shape the same fixed distance over and over, which is why the previous layer
 * appeared to float in place rather than travel.
 *
 * Design rules, all enforced by this file and the CSS in `components.css`:
 *
 *   - **Never interactive.** Every element is `aria-hidden` with
 *     `pointer-events: none`, sits below the content's stacking context, and is
 *     never rendered inside a game player or over a control.
 *   - **Cheap.** No images, no canvas, no WebGL, no animation library. Shapes
 *     are outlines and dots; the loop writes only `transform`, never React
 *     state and never layout.
 *   - **Bounded.** A fixed catalogue per region, sliced by the owner's intensity
 *     setting and the viewport width, with extra shapes marked `far` for the
 *     mobile reduction. Positions are clamped to the free area (field size
 *     minus the shape's own size), so nothing can leave the screen or create
 *     overflow — including after a resize or an orientation change.
 *   - **Polite.** The loop stops while the page is hidden, the whole layer
 *     collapses to a static composition under `prefers-reduced-motion`, and
 *     parallax is opt-in, pointer-fine only, and folded into the same loop.
 *   - **Deterministic.** Spawn positions, velocities and phases come from the
 *     table below, so a shape never jumps between renders.
 *
 * The game runtime is untouched by all of this: it lives in its own sandboxed
 * iframe on a different route and never sees any of these elements.
 */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';

import { useAppearanceState } from '../lib/site-content';
import { clamp, reflect } from '../lib/motion';
import type { AppearanceSettings, DecoIntensity } from '../shared/site-content';

type ShapeKind =
  | 'ring'
  | 'arc'
  | 'dot'
  | 'square'
  | 'triangle'
  | 'diamond'
  | 'star'
  | 'sparkle'
  | 'planet'
  | 'orbit'
  | 'dpad'
  | 'buttons'
  | 'pixel'
  | 'plus'
  | 'squiggle';

interface Shape {
  kind: ShapeKind;
  /** Rendered size in px at desktop width; scaled down on smaller screens. */
  size: number;
  color: string;
  opacity: number;
  /** Spawn position as a fraction of the free area (0 = the left/top edge). */
  x: number;
  y: number;
  /** Velocity in px per second. The sign is the direction; non-zero on both
     axes, so every mark visibly crosses the screen in both directions. */
  vx: number;
  vy: number;
  /** Constant rotation in degrees per second (the old spin, slowed down). */
  spin: number;
  /** Sine wobble in degrees, and its rate in radians per second. */
  wobble: number;
  wobbleRate: number;
  /** Hidden on a phone when the mobile reduction is on. */
  far?: boolean;
}

/*
 * Palette aliases. The legacy `--neon-*` names are re-pointed at the paper
 * palette in tokens.css, so these are periwinkle, lavender, coral, mint and warm
 * grey — no neon value survives anywhere in the system.
 */
const PERIWINKLE = 'var(--neon-cyan)';
const LAVENDER = 'var(--neon-violet)';
const CORAL = 'var(--paper-coral)';
const MINT = 'var(--neon-lime)';
const WARM = 'var(--text-dim)';

/**
 * How many marks each intensity keeps on a full-width screen.
 *
 * Public pages carry one decorative layer (the page field below), so these
 * numbers *are* the number of moving marks a visitor sees. Desktop is the
 * 8–12 range the brief asks for; the viewport caps below bring a tablet to 7
 * and a phone to 5, because the same count on a small screen is a swarm.
 */
const INTENSITY_BUDGET: Record<DecoIntensity, number> = { low: 8, normal: 10, high: 12 };

/** Ceilings by breakpoint, applied on top of the intensity budget. */
const VIEWPORT_CAP = { desktop: 12, tablet: 7, mobile: 5 } as const;

/**
 * The page field.
 *
 * Positions are fractions of the free area, so the first frame already has the
 * marks spread across the screen. Every velocity has both components well away
 * from zero and no two are alike, which is what stops the group from moving in
 * formation. The layer is `fixed` and behind the content: a mark may pass under
 * a card or a paragraph, never over it, and `pointer-events: none` keeps every
 * control clickable while it does.
 */
const PAGE_SHAPES: Shape[] = [
  { kind: 'star', size: 14, color: CORAL, opacity: 0.36, x: 0.12, y: 0.18, vx: 62, vy: 47, spin: 9, wobble: 6, wobbleRate: 0.7 },
  { kind: 'sparkle', size: 12, color: LAVENDER, opacity: 0.34, x: 0.7, y: 0.1, vx: -49, vy: 68, spin: 0, wobble: 10, wobbleRate: 0.9 },
  { kind: 'ring', size: 22, color: PERIWINKLE, opacity: 0.3, x: 0.42, y: 0.62, vx: 38, vy: -55, spin: 12, wobble: 3, wobbleRate: 0.5, far: true },
  { kind: 'square', size: 18, color: MINT, opacity: 0.28, x: 0.86, y: 0.34, vx: -72, vy: -34, spin: -7, wobble: 7, wobbleRate: 0.6 },
  { kind: 'plus', size: 16, color: LAVENDER, opacity: 0.34, x: 0.2, y: 0.78, vx: 54, vy: -61, spin: 14, wobble: 0, wobbleRate: 0 },
  { kind: 'dot', size: 9, color: PERIWINKLE, opacity: 0.4, x: 0.58, y: 0.42, vx: -41, vy: 44, spin: 0, wobble: 0, wobbleRate: 0 },
  { kind: 'diamond', size: 17, color: CORAL, opacity: 0.32, x: 0.9, y: 0.72, vx: -59, vy: -49, spin: 11, wobble: 8, wobbleRate: 0.8, far: true },
  { kind: 'triangle', size: 20, color: MINT, opacity: 0.26, x: 0.06, y: 0.52, vx: 46, vy: 59, spin: -9, wobble: 5, wobbleRate: 0.45 },
  { kind: 'dpad', size: 19, color: WARM, opacity: 0.3, x: 0.34, y: 0.06, vx: 34, vy: 51, spin: 5, wobble: 4, wobbleRate: 0.4 },
  { kind: 'pixel', size: 18, color: WARM, opacity: 0.28, x: 0.74, y: 0.88, vx: -29, vy: -69, spin: 0, wobble: 9, wobbleRate: 0.75, far: true },
  { kind: 'buttons', size: 20, color: PERIWINKLE, opacity: 0.32, x: 0.5, y: 0.26, vx: 80, vy: -31, spin: 8, wobble: 5, wobbleRate: 0.55 },
  { kind: 'sparkle', size: 10, color: CORAL, opacity: 0.4, x: 0.26, y: 0.9, vx: -86, vy: 39, spin: 0, wobble: 12, wobbleRate: 1.1 },
  { kind: 'star', size: 11, color: MINT, opacity: 0.34, x: 0.62, y: 0.68, vx: 66, vy: 74, spin: -6, wobble: 7, wobbleRate: 0.65, far: true },
  { kind: 'orbit', size: 26, color: LAVENDER, opacity: 0.24, x: 0.44, y: 0.5, vx: -36, vy: -79, spin: 13, wobble: 0, wobbleRate: 0 },
];

/**
 * The dashboard's appearance preview needs a region of its own to show an
 * intensity before it is saved. It is never mounted on a public page, and its
 * marks bounce inside the preview box rather than the viewport.
 */
const HERO_SHAPES: Shape[] = [
  { kind: 'ring', size: 40, color: PERIWINKLE, opacity: 0.36, x: 0.12, y: 0.22, vx: 38, vy: 29, spin: 10, wobble: 4, wobbleRate: 0.6 },
  { kind: 'sparkle', size: 20, color: CORAL, opacity: 0.4, x: 0.72, y: 0.16, vx: -31, vy: 44, spin: 0, wobble: 9, wobbleRate: 0.8 },
  { kind: 'triangle', size: 26, color: MINT, opacity: 0.3, x: 0.82, y: 0.7, vx: -36, vy: -27, spin: -8, wobble: 6, wobbleRate: 0.5 },
  { kind: 'star', size: 18, color: LAVENDER, opacity: 0.38, x: 0.3, y: 0.78, vx: 28, vy: -39, spin: 7, wobble: 5, wobbleRate: 0.7 },
  { kind: 'orbit', size: 30, color: PERIWINKLE, opacity: 0.28, x: 0.5, y: 0.44, vx: 46, vy: 34, spin: 12, wobble: 0, wobbleRate: 0 },
  { kind: 'plus', size: 16, color: LAVENDER, opacity: 0.34, x: 0.08, y: 0.62, vx: 25, vy: 48, spin: 8, wobble: 4, wobbleRate: 0.4 },
  { kind: 'diamond', size: 18, color: MINT, opacity: 0.3, x: 0.6, y: 0.86, vx: -49, vy: -37, spin: -9, wobble: 7, wobbleRate: 0.55 },
  { kind: 'pixel', size: 18, color: WARM, opacity: 0.3, x: 0.38, y: 0.1, vx: 35, vy: 32, spin: 0, wobble: 8, wobbleRate: 0.65 },
];

/**
 * Three small marks around the framed artwork.
 *
 * They live in the hero's own markup rather than in the fixed layer, because a
 * fixed shape would slide over the heading as the page scrolls. These scroll
 * with the frame and sit in its margin, where nothing else can be.
 */
export function FrameMarks() {
  return (
    <span className="hero__frame-marks" aria-hidden="true">
      <svg className="hero__frame-mark hero__frame-mark--star" viewBox="0 0 100 100" width={16} height={16} focusable="false">
        {SHAPES.star}
      </svg>
      <svg className="hero__frame-mark hero__frame-mark--dot" viewBox="0 0 100 100" width={9} height={9} focusable="false">
        {SHAPES.dot}
      </svg>
      <svg className="hero__frame-mark hero__frame-mark--plus" viewBox="0 0 100 100" width={13} height={13} focusable="false">
        {SHAPES.plus}
      </svg>
    </span>
  );
}

export type DecoVariant = 'page' | 'hero';

const VARIANTS: Record<DecoVariant, Shape[]> = {
  page: PAGE_SHAPES,
  hero: HERO_SHAPES,
};

/* ------------------------------------------------------------------ hooks */

/** True when the visitor asked for less movement. Reacts to changes live. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return reduced;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);

  return matches;
}

interface Body {
  shape: Shape;
  /** Rendered size, read back from the element so a scaled phone mark still
   *  bounces at its real edge rather than a desktop-sized one. */
  width: number;
  height: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  phase: number;
}

interface BounceOptions {
  host: React.RefObject<HTMLDivElement | null>;
  /** The layer is only in the DOM once the saved settings are known. */
  ready: boolean;
  /** False under `prefers-reduced-motion`, or when the tab is hidden: the layer
   *  renders once in its spawn positions and no frame is ever scheduled. */
  enabled: boolean;
  /** Owner setting; folded into the same loop so there is only ever one. */
  parallax: boolean;
  /** 0.55 on a phone, 0.8 on a tablet, 1 at desktop width. */
  speedScale: number;
}

/**
 * The bouncing engine: one rAF loop for the whole layer.
 *
 * Every mark keeps its own position and velocity. Each frame integrates the
 * position with delta time (so a 144 Hz screen and a 60 Hz one travel at the
 * same speed), reflects the velocity component at each boundary, and writes the
 * result straight to the element's `transform`. Nothing is stored in React
 * state, so a frame costs no render — only a style write per mark.
 *
 * Returns the ref callback list the shapes attach themselves to.
 */
function useBouncingShapes(
  shapes: Shape[],
  { host, ready, enabled, parallax, speedScale }: BounceOptions,
): React.MutableRefObject<Array<SVGSVGElement | null>> {
  const elements = useRef<Array<SVGSVGElement | null>>([]);

  useLayoutEffect(() => {
    const layer = host.current;
    if (!ready || !layer || shapes.length === 0) return undefined;
    const nodes = elements.current;

    /** The rendered box. Read from the width/height attributes rather than
     *  `getBoundingClientRect`, because a rotated mark's rect is larger than
     *  the mark and would make it bounce early. */
    const sizeOf = (node: SVGSVGElement | null | undefined, fallback: number) => {
      const width = Number(node?.getAttribute('width'));
      const height = Number(node?.getAttribute('height'));
      return {
        width: Number.isFinite(width) && width > 0 ? width : fallback,
        height: Number.isFinite(height) && height > 0 ? height : fallback,
      };
    };

    const area = { width: layer.clientWidth, height: layer.clientHeight };
    const bodies: Body[] = shapes.map((shape, index) => {
      const rendered = sizeOf(nodes[index], Math.round(shape.size * 0.8));
      const elementWidth = rendered.width;
      const elementHeight = rendered.height;
      const maxX = Math.max(0, area.width - elementWidth);
      const maxY = Math.max(0, area.height - elementHeight);
      return {
        shape,
        width: elementWidth,
        height: elementHeight,
        x: clamp(shape.x * maxX, 0, maxX),
        y: clamp(shape.y * maxY, 0, maxY),
        vx: shape.vx,
        vy: shape.vy,
        angle: (index * 47) % 360,
        phase: index * 1.7,
      };
    });

    let elapsed = 0;
    let shiftX = 0;
    let shiftY = 0;
    let targetX = 0;
    let targetY = 0;

    const paint = () => {
      for (let index = 0; index < bodies.length; index += 1) {
        const body = bodies[index];
        const element = nodes[index];
        if (!element) continue;
        const wobble =
          body.shape.wobble === 0 ? 0 : body.shape.wobble * Math.sin(body.phase + elapsed * body.shape.wobbleRate);
        element.style.transform =
          `translate3d(${(body.x + shiftX).toFixed(1)}px, ${(body.y + shiftY).toFixed(1)}px, 0)` +
          ` rotate(${(body.angle + wobble).toFixed(1)}deg)`;
      }
    };

    // First paint happens in the layout effect, before the browser shows the
    // page, so no mark is ever seen stacked in the top-left corner.
    paint();
    if (!enabled) return undefined;

    const measure = () => {
      area.width = layer.clientWidth;
      area.height = layer.clientHeight;
      for (let index = 0; index < bodies.length; index += 1) {
        const body = bodies[index];
        const rendered = sizeOf(nodes[index], body.width);
        body.width = rendered.width;
        body.height = rendered.height;
        // Keep every mark on screen after a resize or an orientation change.
        body.x = clamp(body.x, 0, Math.max(0, area.width - body.width));
        body.y = clamp(body.y, 0, Math.max(0, area.height - body.height));
      }
      paint();
    };

    const observer = new ResizeObserver(measure);
    observer.observe(layer);

    let frame = 0;
    let last = 0;
    let running = false;

    const tick = (now: number) => {
      if (!running) return;
      const step = last === 0 ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += step;

      // Pointer parallax, eased towards the pointer inside the same loop.
      shiftX += (targetX - shiftX) * Math.min(1, step * 5);
      shiftY += (targetY - shiftY) * Math.min(1, step * 5);

      for (const body of bodies) {
        const horizontal = reflect(body.x, body.vx, step * speedScale, Math.max(0, area.width - body.width));
        body.x = horizontal.position;
        body.vx = horizontal.velocity;

        const vertical = reflect(body.y, body.vy, step * speedScale, Math.max(0, area.height - body.height));
        body.y = vertical.position;
        body.vy = vertical.velocity;

        body.angle = (body.angle + body.shape.spin * step) % 360;
      }

      paint();
      frame = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (running) return;
      running = true;
      last = 0;
      frame = window.requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') start();
      else stop();
    };

    const onPointer = (event: PointerEvent) => {
      targetX = (event.clientX / window.innerWidth - 0.5) * 26;
      targetY = (event.clientY / window.innerHeight - 0.5) * 22;
    };

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    if (parallax && finePointer) window.addEventListener('pointermove', onPointer, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') start();

    return () => {
      stop();
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointer);
      for (const element of nodes) element?.style.removeProperty('transform');
    };
  }, [enabled, host, parallax, ready, shapes, speedScale]);

  return elements;
}

/* ---------------------------------------------------------------- shapes */

const SHAPES: Record<ShapeKind, ReactElement> = {
  ring: <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" strokeWidth="2.4" strokeDasharray="8 10" />,
  /* A quarter of a dashed circle: read as an orbital arc clipped by the page
     edge, which is the mark the reference has at the hero's left. */
  arc: (
    <path
      d="M50 10a40 40 0 1 1-28.3 11.7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeDasharray="10 12"
      strokeLinecap="round"
    />
  ),
  dot: <circle cx="50" cy="50" r="26" fill="currentColor" />,
  square: <rect x="14" y="14" width="72" height="72" rx="16" fill="none" stroke="currentColor" strokeWidth="2.6" />,
  triangle: <path d="M50 10 90 84H10L50 10Z" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinejoin="round" />,
  diamond: <rect x="20" y="20" width="60" height="60" rx="10" fill="none" stroke="currentColor" strokeWidth="2.6" transform="rotate(45 50 50)" />,
  star: <path d="M50 8l11 27 29 3-22 20 6 29-24-15-24 15 6-29L10 38l29-3L50 8Z" fill="currentColor" />,
  sparkle: <path d="M50 6c3 22 12 31 34 34-22 3-31 12-34 34-3-22-12-31-34-34 22-3 31-12 34-34Z" fill="currentColor" />,
  planet: (
    <>
      <circle cx="50" cy="50" r="26" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <ellipse cx="50" cy="50" rx="44" ry="14" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.7" transform="rotate(-22 50 50)" />
    </>
  ),
  orbit: (
    <>
      <circle cx="50" cy="50" r="10" fill="currentColor" />
      <ellipse cx="50" cy="50" rx="42" ry="42" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.6" />
      <circle cx="50" cy="8" r="5" fill="currentColor" />
    </>
  ),
  dpad: (
    <path
      d="M42 12h16v30h30v16H58v30H42V58H12V42h30V12Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinejoin="round"
    />
  ),
  buttons: (
    <>
      <circle cx="30" cy="30" r="12" fill="none" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="70" cy="70" r="12" fill="currentColor" />
      <circle cx="70" cy="30" r="6" fill="currentColor" opacity="0.7" />
      <circle cx="30" cy="70" r="6" fill="currentColor" opacity="0.7" />
    </>
  ),
  pixel: (
    <>
      <rect x="18" y="18" width="24" height="24" fill="currentColor" />
      <rect x="46" y="42" width="16" height="16" fill="currentColor" opacity="0.75" />
      <rect x="30" y="62" width="10" height="10" fill="currentColor" opacity="0.5" />
    </>
  ),
  plus: <path d="M50 14v72M14 50h72" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />,
  squiggle: (
    <path
      d="M4 60c10-22 20 14 30-2s20 18 30 0 22 10 32-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.6"
      strokeLinecap="round"
    />
  ),
};

function DecoShape({
  shape,
  scale,
  attach,
}: {
  shape: Shape;
  /** Size multiplier: smaller marks on a phone, slightly smaller on a tablet. */
  scale: number;
  attach: (node: SVGSVGElement | null) => void;
}) {
  return (
    <svg
      ref={attach}
      className={`deco deco--${shape.kind}${shape.far ? ' deco--far' : ''}`}
      viewBox="0 0 100 100"
      width={Math.round(shape.size * scale)}
      height={Math.round(shape.size * scale)}
      style={{ color: shape.color, opacity: shape.opacity } as CSSProperties}
      focusable="false"
    >
      {SHAPES[shape.kind]}
    </svg>
  );
}

/* -------------------------------------------------------------- the field */

export interface DecoFieldProps {
  variant?: DecoVariant;
  className?: string;
  /**
   * Settings override, used by the dashboard's live preview so the owner can see
   * an intensity before saving it. The public site never passes this.
   */
  override?: AppearanceSettings;
}

/**
 * One decorative region. Intensity, the viewport cap and the mobile reduction
 * come from the owner's saved settings and the screen; everything is off when
 * animations are disabled (the layer is not rendered at all) or the visitor
 * prefers reduced motion (a still composition, no loop).
 *
 * Note there is no `children`: nothing can be placed inside the decorative
 * layer, so it can never cover or intercept a real control.
 */
export function DecoField({ variant = 'page', className, override }: DecoFieldProps) {
  const saved = useAppearanceState();
  const appearance = override ?? saved.appearance;
  const reducedMotion = usePrefersReducedMotion();
  const phone = useMediaQuery('(max-width: 640px)');
  const tablet = useMediaQuery('(max-width: 1100px)');
  const host = useRef<HTMLDivElement>(null);

  const ready = Boolean(override) || saved.ready;
  const cap = phone ? VIEWPORT_CAP.mobile : tablet ? VIEWPORT_CAP.tablet : VIEWPORT_CAP.desktop;
  const budget = Math.min(INTENSITY_BUDGET[appearance.intensity], cap);
  const reduceForMobile = appearance.mobileReduction && phone;
  const scale = phone ? 0.78 : tablet ? 0.88 : 1;
  const speedScale = phone ? 0.55 : tablet ? 0.8 : 1;

  const shapes = useMemo(
    () => VARIANTS[variant].slice(0, budget).filter((shape) => !(reduceForMobile && shape.far)),
    [budget, reduceForMobile, variant],
  );

  // Reduced motion keeps the composition but never starts the loop.
  const enabled = appearance.animations && !reducedMotion;
  const elements = useBouncingShapes(shapes, {
    host,
    ready,
    enabled,
    parallax: appearance.parallax && !phone && !reducedMotion,
    speedScale,
  });

  // Nothing is drawn until the saved settings are known, so an owner who has
  // switched animations off never sees a flash of shapes first. The dashboard's
  // own preview passes an override and is always ready.
  if (!ready) return null;
  if (!appearance.animations) return null;

  return (
    <div
      ref={host}
      className={`deco-field${className ? ` ${className}` : ''}`}
      data-variant={variant}
      data-motion={enabled ? 'on' : 'static'}
      aria-hidden="true"
    >
      {shapes.map((shape, index) => (
        <DecoShape
          key={`${variant}-${shape.kind}-${index}`}
          shape={shape}
          scale={scale}
          attach={(node) => {
            elements.current[index] = node;
          }}
        />
      ))}
    </div>
  );
}

/**
 * The page-wide background layer. Mounted once per public page layout, below
 * everything, and never inside the game player.
 */
export function DecoBackground() {
  return <DecoField variant="page" className="deco-field--fixed" />;
}

/* -------------------------------------------------------- existing artwork */

/**
 * The hero centrepiece: an abstract handheld-console illustration built from
 * primitives, so it stays crisp at any size and costs a couple of kilobytes.
 */
export function ControllerArt({ className }: { className?: string }) {
  return (
    <svg
      className={`controller-art ${className ?? ''}`.trim()}
      viewBox="0 0 520 420"
      role="img"
      aria-label="Illustration of a handheld games console with neon controls"
    >
      <defs>
        <linearGradient id="hg-shell" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="color-mix(in srgb, var(--neon-cyan) 42%, transparent)" />
          <stop offset="55%" stopColor="color-mix(in srgb, var(--neon-violet) 30%, transparent)" />
          <stop offset="100%" stopColor="color-mix(in srgb, var(--neon-pink) 34%, transparent)" />
        </linearGradient>
        <linearGradient id="hg-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--neon-cyan)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--neon-violet)" stopOpacity="0.35" />
        </linearGradient>
      </defs>

      {/* Backdrop rings */}
      <circle cx="260" cy="205" r="180" fill="none" stroke="var(--border-strong)" strokeWidth="1" />
      <circle
        cx="260"
        cy="205"
        r="146"
        fill="none"
        stroke="var(--neon-cyan)"
        strokeWidth="1.5"
        strokeDasharray="4 10"
        opacity="0.7"
      />

      {/* Floating geometry */}
      <rect x="30" y="34" width="46" height="46" rx="12" fill="none" stroke="var(--neon-lime)" strokeWidth="2.4" />
      <path d="M444 60l26 44h-52l26-44Z" fill="none" stroke="var(--neon-orange)" strokeWidth="2.4" />
      <circle cx="452" cy="330" r="18" fill="var(--neon-pink)" opacity="0.75" />
      <circle cx="70" cy="330" r="24" fill="none" stroke="var(--neon-blue)" strokeWidth="2.4" opacity="0.8" />

      {/* Console shell */}
      <g transform="rotate(-6 260 205)">
        <rect x="96" y="112" width="330" height="196" rx="34" fill="url(#hg-shell)" stroke="var(--border-strong)" strokeWidth="3" />
        {/* Screen */}
        <rect x="136" y="142" width="250" height="118" rx="14" fill="#05070f" opacity="0.86" stroke="var(--border)" strokeWidth="2" />
        <rect x="150" y="156" width="222" height="90" rx="9" fill="url(#hg-screen)" opacity="0.75" />
        {/* D-pad */}
        <g stroke="var(--text)" strokeWidth="3.4" strokeLinecap="round" opacity="0.92">
          <path d="M132 336h28M146 322v28" />
        </g>
        {/* Action buttons */}
        <circle cx="378" cy="330" r="9" fill="var(--neon-cyan)" />
        <circle cx="404" cy="352" r="9" fill="var(--neon-pink)" />
        <circle cx="352" cy="352" r="9" fill="var(--neon-lime)" />
        <circle cx="378" cy="374" r="9" fill="var(--neon-violet)" />
        {/* Cartridge slot */}
        <rect x="230" y="284" width="60" height="10" rx="5" fill="var(--text)" opacity="0.28" />
      </g>
    </svg>
  );
}

/**
 * The hero's empty-frame artwork: a drawn blueprint of the first cabinet.
 *
 * It is a deliberate placeholder for a real upload, not a fake game: no title,
 * no screenshot, no play control. Once the owner publishes a game, the frame
 * shows that game's artwork instead.
 */
export function ArcadeBlueprint({ className }: { className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const grid = `hg-blueprint-grid-${uid}`;

  return (
    <svg
      className={`arcade-blueprint${className ? ` ${className}` : ''}`.trim()}
      viewBox="0 0 400 500"
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="A work-in-progress sketch of the first arcade cabinet"
    >
      <defs>
        <pattern id={grid} width="25" height="25" patternUnits="userSpaceOnUse">
          <path d="M25 0H0v25" fill="none" stroke="var(--ink-faint)" strokeWidth="0.6" />
        </pattern>
      </defs>

      <rect width="400" height="500" fill="var(--bg-deep)" />
      <rect width="400" height="500" fill={`url(#${grid})`} opacity="0.55" />

      {/* The cabinet, drawn in outline like a plan on drafting paper. */}
      <g stroke="var(--ink-soft)" strokeWidth="1.4">
        <rect x="64" y="68" width="272" height="356" rx="4" />
        <rect x="94" y="102" width="212" height="154" />
        <path d="M94 344h212" />
        <path d="M94 372h212v22H94z" />
      </g>

      <rect x="94" y="102" width="212" height="154" fill="var(--scheme-wash)" />
      <circle cx="200" cy="179" r="38" fill="none" stroke="var(--scheme-a)" strokeWidth="1.6" />
      <path d="M176 179h48M200 155v48" stroke="var(--scheme-a)" strokeWidth="1.2" />
      <path d="M130 126h38M130 136h24" stroke="var(--ink-soft)" strokeWidth="1.2" strokeLinecap="round" />

      {/* Controls: a d-pad and two buttons, all still just geometry. */}
      <path d="M140 294v32M124 310h32" stroke="var(--ink-soft)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="244" cy="308" r="9" fill="none" stroke="var(--scheme-c)" strokeWidth="2" />
      <circle cx="270" cy="308" r="5" fill="var(--scheme-a)" />
      <rect x="94" y="372" width="54" height="22" fill="var(--scheme-b)" opacity="0.8" />

      <text x="94" y="438" fill="var(--text-dim)" fontFamily="var(--font-mono)" fontSize="10" letterSpacing="2.2">
        WORK IN PROGRESS
      </text>

      {/* Registration marks, so the frame reads as a printed plate. */}
      <g stroke="var(--scheme-c)" strokeWidth="1.2">
        <path d="M30 30h18M30 30v18" />
        <path d="M370 470h-18M370 470v-18" />
      </g>
    </svg>
  );
}

/** Compact decorative divider used between page sections. */
export function ZigZag({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 120 12" width="120" height="12" aria-hidden="true" focusable="false">
      <path d="M0 10 10 2l10 8 10-8 10 8 10-8 10 8 10-8 10 8 10-8 10 8 10-8" fill="none" stroke="var(--border-strong)" strokeWidth="2" />
    </svg>
  );
}

/** The label plus bobbing arrow inside the hero scroll cue link. */
export function ScrollCue({ label }: { label: string }) {
  return (
    <>
      {label}
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
        <path d="M12 4v14M6 13l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </>
  );
}
