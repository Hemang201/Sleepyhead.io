import { describe, expect, it } from 'vitest';

import { clamp, reflect } from '../src/lib/motion';

/**
 * The physics behind the bouncing decoration layer. These are the properties
 * the browser checks cannot prove in a short run — a mark only reaches an edge
 * after tens of seconds at ambient speed — so they are pinned here directly.
 */
describe('clamp', () => {
  it('keeps a value inside its bounds', () => {
    expect(clamp(12, 0, 10)).toBe(10);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(4, 0, 10)).toBe(4);
  });

  it('collapses a degenerate range to its minimum instead of going negative', () => {
    expect(clamp(5, 2, 1)).toBe(2);
  });
});

describe('reflect', () => {
  it('moves a body by its velocity and delta time', () => {
    expect(reflect(100, 20, 0.5, 500)).toEqual({ position: 110, velocity: 20 });
  });

  it('reverses the velocity at the far wall and mirrors the overshoot', () => {
    const after = reflect(495, 20, 0.5, 500);
    // 495 + 10 = 505, five past the wall, so it lands five back from it.
    expect(after.position).toBe(495);
    expect(after.velocity).toBe(-20);
  });

  it('reverses the velocity at the near wall', () => {
    const after = reflect(4, -20, 0.5, 500);
    expect(after.position).toBe(6);
    expect(after.velocity).toBe(20);
  });

  it('stays inside the free area for a very fast body', () => {
    let position = 250;
    let velocity = 900;
    for (let frame = 0; frame < 600; frame += 1) {
      const next = reflect(position, velocity, 1 / 60, 500);
      position = next.position;
      velocity = next.velocity;
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(500);
    }
  });

  it('actually bounces back and forth rather than settling on a wall', () => {
    let position = 250;
    let velocity = 40;
    let directionChanges = 0;
    let previousSign = Math.sign(velocity);
    for (let frame = 0; frame < 60 * 60; frame += 1) {
      const next = reflect(position, velocity, 1 / 60, 500);
      position = next.position;
      velocity = next.velocity;
      const sign = Math.sign(velocity);
      if (sign !== previousSign) directionChanges += 1;
      previousSign = sign;
    }
    // A 40 px/s body crosses a 500 px area in 12.5 s, so a minute of travel
    // contains four wall contacts: far, near, far, near.
    expect(directionChanges).toBeGreaterThanOrEqual(4);
  });

  it('handles a field smaller than the mark without producing NaN', () => {
    expect(reflect(0, 20, 0.5, 0)).toEqual({ position: 0, velocity: 20 });
  });
});
