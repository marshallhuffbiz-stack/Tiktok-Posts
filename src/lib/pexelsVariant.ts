// src/lib/pexelsVariant.ts
//
// Pexels' CDN serves the same video at multiple resolutions: uhd_WxH,
// hd_WxH, sd_WxH. The URL pattern is:
//   https://videos.pexels.com/video-files/{ID}/{ID}-{tier}_{W}_{H}_{FPS}fps.mp4
//
// rent-roll-slides' /api/broll often returns UHD variants (50-130MB).
// TikTok's mobile app uploads HD-class content (~5-15MB) and the algorithm
// is reportedly tuned around mobile-class file sizes. This module rewrites
// UHD URLs to their HD siblings — same actual video, smaller file, more
// "mobile-app-like" upload signature.

const URL_RE = /^(.+\/video-files\/(\d+)\/\2-)(uhd|hd|sd)_(\d+)_(\d+)_(\d+)fps\.mp4$/;

/**
 * Parse a Pexels video URL. Returns null for non-matching URLs.
 *
 * Exported for unit testing.
 */
export function parsePexelsUrl(url: string): {
  base: string;       // includes trailing dash
  id: string;
  tier: 'uhd' | 'hd' | 'sd';
  width: number;
  height: number;
  fps: number;
} | null {
  const m = url.match(URL_RE);
  if (!m) return null;
  return {
    base: m[1]!,
    id: m[2]!,
    tier: m[3] as 'uhd' | 'hd' | 'sd',
    width: parseInt(m[4]!, 10),
    height: parseInt(m[5]!, 10),
    fps: parseInt(m[6]!, 10),
  };
}

/**
 * Build candidate HD variant URLs for a given UHD source URL. Returns an
 * empty array for non-Pexels or non-UHD inputs.
 *
 * Exported for unit testing.
 */
export function buildHdCandidates(url: string): string[] {
  const p = parsePexelsUrl(url);
  if (!p || p.tier !== 'uhd') return [];

  // Aspect ratio determines what HD dimensions Pexels likely serves.
  const candidates: Array<[number, number]> = [];
  // First: the half-size variant (most reliably exists per CDN observation)
  candidates.push([Math.floor(p.width / 2), Math.floor(p.height / 2)]);
  // Then standard mobile sizes
  if (p.width > p.height) {
    // Landscape
    candidates.push([1920, 1080]);
    candidates.push([1280, 720]);
  } else {
    // Portrait
    candidates.push([1080, 1920]);
    candidates.push([720, 1280]);
  }
  // Dedupe
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const [w, h] of candidates) {
    const key = `${w}x${h}`;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(`${p.base}hd_${w}_${h}_${p.fps}fps.mp4`);
  }
  return urls;
}

/**
 * Probe candidate URLs in order; return the first one whose HEAD returns
 * 200 OK. Returns null if none respond.
 */
export async function findHdVariant(uhdUrl: string): Promise<string | null> {
  const candidates = buildHdCandidates(uhdUrl);
  for (const c of candidates) {
    try {
      const res = await fetch(c, { method: 'HEAD' });
      if (res.ok) return c;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Download bytes from a URL into a Buffer. Throws on non-2xx or fetch failure.
 */
export async function downloadBytes(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${url}: HTTP ${res.status}`);
  const arr = new Uint8Array(await res.arrayBuffer());
  return Buffer.from(arr);
}
