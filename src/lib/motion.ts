/**
 * Two tiny pure helpers behind the bouncing decoration layer.
 *
 * They live in their own module so the physics is testable without a browser:
 * the loop calls them every frame, and the unit tests pin the behaviour the
 * site depends on — a mark never leaves its free area, and it reverses its
 * velocity when it reaches an edge rather than sticking to it or resetting.
 */

/** Keep `value` inside `[min, max]`. Tolerates a max below min (a shape larger
 *  than its field), which can happen for one frame while a panel resizes. */
export function clamp(value: number, min: number, max: number): number {
  if (max <= min) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Move a body by `delta` and reflect it off a boundary.
 *
 * Returns the new position and velocity; the position is always inside
 * `[0, max]`. Overshoot is mirrored rather than dropped, so a fast body that
 * would cross the whole free area in one frame still lands where it belongs
 * instead of being clamped into the wall. The outgoing velocity points away
 * from the wall it touched.
 */
export function reflect(
  position: number,
  velocity: number,
  delta: number,
  max: number,
): { position: number; velocity: number } {
  if (max <= 0) return { position: 0, velocity };

  let next = position + velocity * delta;
  let speed = velocity;

  if (next < 0) {
    next = -next;
    speed = Math.abs(speed);
    // A very large step can cross the far wall too.
    if (next > max) next = 2 * max - next;
  } else if (next > max) {
    next = 2 * max - next;
    speed = -Math.abs(speed);
    if (next < 0) next = -next;
  }

  return { position: clamp(next, 0, max), velocity: speed };
}
