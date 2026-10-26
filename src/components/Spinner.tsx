/**
 * The site's loading indicators — one family, four shapes.
 *
 * A loading state is part of the design language, not an afterthought: these are
 * drawn from the same tokens as everything else (ink outline, accent head,
 * square corners) so a wait in the dashboard looks like a wait in the player.
 *
 * Three rules the whole site follows, and this component is how:
 *   - an indicator only appears when something is genuinely being waited for —
 *     never on a screen that is already showing content;
 *   - it is announced once (`role="status"` plus a label), never as a stream of
 *     meaningless updates;
 *   - it is decoration to assistive technology when the surrounding UI already
 *     narrates the wait, which is why `label` is optional.
 *
 * Reduced motion freezes the rotation (the global rule in base.css collapses
 * animation durations), and the static frame still reads as an indicator because
 * the accent quarter and the ink track are two different colours.
 */

export type SpinnerShape = 'ring' | 'block' | 'dots' | 'bar';
export type SpinnerSize = 'sm' | 'md' | 'lg';

export interface SpinnerProps {
  /** Visual shape. `ring` is the default; `dots` suits inline text. */
  shape?: SpinnerShape;
  size?: SpinnerSize;
  /** Announced text. Omit it when a nearby live region already says what waits. */
  label?: string;
  className?: string;
}

export function Spinner({ shape = 'ring', size = 'md', label, className }: SpinnerProps) {
  const classes = `spinner spinner--${shape} spinner--${size}${className ? ` ${className}` : ''}`;

  return (
    <>
      <span className={classes} aria-hidden="true">
        {shape === 'dots' ? (
          <>
            <span />
            <span />
            <span />
          </>
        ) : null}
        {shape === 'bar' ? <span /> : null}
      </span>
      {label ? (
        <span className="visually-hidden" role="status">
          {label}
        </span>
      ) : null}
    </>
  );
}
