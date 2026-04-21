// src/lib/bRollParse.ts
//
// Parsing helpers for rent-roll-slides B-roll output. The app exposes a
// structured JSON API (/api/broll) that provides durationSec and
// sourceCategory directly, so only aspect-ratio parsing is needed — the
// ratio is embedded in the free-form "processing" string rather than as
// its own numeric field.

/**
 * Parse "WxH" from a metadata line containing "3840×2160" or "1080x1920".
 * Accepts both the Unicode multiplication sign (×, U+00D7) and ASCII x.
 * The returned string always uses ASCII x for internal normalization.
 */
export function parseAspectRatio(text: string): string {
  const match = text.match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/);
  if (!match) throw new Error(`parseAspectRatio: no WxH in "${text}"`);
  return `${match[1]}x${match[2]}`;
}

/**
 * Return true if the aspect ratio "WxH" is within 1% of 9:16 portrait.
 * Used to decide whether the TikTok editor's crop-to-9:16 step is needed.
 */
export function is916(aspectRatio: string): boolean {
  const [wStr, hStr] = aspectRatio.split('x');
  const w = Number(wStr);
  const h = Number(hStr);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return false;
  const target = 9 / 16;
  const actual = w / h;
  return Math.abs(actual - target) / target < 0.01;
}
