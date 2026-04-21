// src/lib/overlayMath.ts
//
// Pure math for the TikTok video-editor overlay step. Extracted from
// overlay.ts so the drag-math and span-verification logic can be unit-tested
// without a real browser.

/**
 * Compute the x pixel target for dragging a timeline handle to a given
 * duration. Clamps to timelineWidthPx when durationSec > totalSec, and
 * returns 0 if totalSec is non-positive (defensive — a zero-length clip
 * should never reach this helper).
 */
export function computeHandleTargetX(
  durationSec: number,
  totalSec: number,
  timelineWidthPx: number,
): number {
  if (totalSec <= 0) return 0;
  const clamped = Math.min(durationSec, totalSec);
  return (clamped / totalSec) * timelineWidthPx;
}

/**
 * Fraction of the total timeline a given overlay span covers. overlay.ts
 * treats a span >= 0.9 * totalSec as "extended to full video" — this
 * helper exists so that verification can be tested in isolation.
 */
export function spanFraction(spanSec: number, totalSec: number): number {
  if (totalSec <= 0) return 0;
  return spanSec / totalSec;
}
