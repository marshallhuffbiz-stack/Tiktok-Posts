// src/lib/humanMouse.ts
//
// Real users don't teleport their cursor. They draw curves with noise.
// This module provides mouse helpers that generate a curved path of
// intermediate points with small jitter so TikTok's webmssdk.js (which
// observes pointer events) sees something less machine-like.
//
// Kept dependency-free so it can be unit-tested without a browser.

import type { Page } from 'patchright';

export interface PathOptions {
  /** Total number of intermediate steps along the path. */
  steps?: number;
  /** Max perpendicular deviation from the straight line (px). */
  curveAmplitude?: number;
  /** Max per-step jitter applied to x and y (px). */
  jitter?: number;
}

/**
 * Compute a quadratic-Bezier-ish curved path between two points with
 * optional per-step jitter. The curve's control point is perpendicular
 * to the straight line at its midpoint.
 *
 * Exported for unit testing.
 */
export function buildCurvedPath(
  fromX: number, fromY: number,
  toX: number, toY: number,
  rng: () => number = Math.random,
  opts: PathOptions = {},
): Array<{ x: number; y: number }> {
  const steps = Math.max(8, opts.steps ?? 24);
  const amp = opts.curveAmplitude ?? Math.min(40, Math.hypot(toX - fromX, toY - fromY) * 0.15);
  const jitter = opts.jitter ?? 1.5;

  // Midpoint offset perpendicular to the line between from and to
  const midX = (fromX + toX) / 2;
  const midY = (fromY + toY) / 2;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const len = Math.hypot(dx, dy) || 1;
  // Unit normal (perpendicular)
  const nx = -dy / len;
  const ny = dx / len;
  // Signed bow height (randomized sign so consecutive drags don't curve the same way)
  const bow = (rng() - 0.5) * 2 * amp;
  const ctrlX = midX + nx * bow;
  const ctrlY = midY + ny * bow;

  const points: Array<{ x: number; y: number }> = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    // Quadratic Bezier: (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
    const u = 1 - t;
    const px = u * u * fromX + 2 * u * t * ctrlX + t * t * toX;
    const py = u * u * fromY + 2 * u * t * ctrlY + t * t * toY;
    // Small jitter — reduces "too perfect" curve
    const jx = (rng() - 0.5) * 2 * jitter;
    const jy = (rng() - 0.5) * 2 * jitter;
    points.push({ x: px + jx, y: py + jy });
  }
  return points;
}

/**
 * Drive the mouse along a curved path from its current position to (toX, toY).
 * Caller passes the known-current position because Playwright doesn't expose
 * the current mouse position. Uses a small pause between moves to give
 * TikTok's event observer realistic cadence.
 */
export async function humanMouseMove(
  page: Page,
  fromX: number, fromY: number,
  toX: number, toY: number,
  opts: PathOptions = {},
): Promise<void> {
  const points = buildCurvedPath(fromX, fromY, toX, toY, Math.random, opts);
  for (const p of points) {
    await page.mouse.move(p.x, p.y);
  }
}

/**
 * Move the mouse to (x, y) along a curve from (fromX, fromY), pause
 * briefly (as a real user does before clicking), and click. Useful for
 * single-click targets.
 */
export async function humanMouseClick(
  page: Page,
  fromX: number, fromY: number,
  toX: number, toY: number,
  opts: PathOptions & { hoverMs?: number } = {},
): Promise<void> {
  await humanMouseMove(page, fromX, fromY, toX, toY, opts);
  // Brief hover like a human reading the button before clicking
  await page.waitForTimeout(80 + Math.floor(Math.random() * 120));
  await page.mouse.click(toX, toY);
}
