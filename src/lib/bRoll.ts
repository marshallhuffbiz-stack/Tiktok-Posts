// src/lib/bRoll.ts
//
// Drives rent-roll-slides' B-roll mode via its JSON API. Returns a local
// path to the raw (stream-copied) video plus the overlay + caption text
// that will go into TikTok's native editor and caption field.
//
// Key design: no Playwright page required for generation — the app exposes
// a clean /api/broll endpoint that returns everything in one JSON payload,
// including the video as a data URL. This is much faster and less fragile
// than DOM scraping.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { parseAspectRatio } from './bRollParse.js';
import type { BRollResult, BRollSettings } from './types.js';

const BROLL_API = 'https://rent-roll-slides.vercel.app/api/broll';

/** Thrown when the generator returns success but with a null/empty hook */
export class OverlayGenerationFailed extends Error {
  constructor(attempts: number) {
    super(`rent-roll-slides returned empty hook ${attempts} time(s)`);
    this.name = 'OverlayGenerationFailed';
  }
}

/** Thrown when the API call itself fails (network / non-2xx / malformed) */
export class BRollApiError extends Error {
  constructor(msg: string) {
    super(`rent-roll-slides API error: ${msg}`);
    this.name = 'BRollApiError';
  }
}

/** Shape of a successful hook object, verified against a live response. */
interface Hook {
  overlay_lines: string[];
  closer_line: string;
  caption: string;
  hashtags: string[];
  template_id?: string;
  controversy_level?: number;
  audience?: string;
  rationale?: string | null;
}

interface BRollResponse {
  success: boolean;
  mp4DataUrl: string;
  sourceUrl: string;
  sourceCategory: string;
  durationSec: number;
  sizeBytes: number;
  streamCopied: boolean;
  processing: string;
  hook: Hook | null;
  trend: unknown | null;
}

/** Audience value → API string. The API uses 'both' | 'landlord' | 'investor'. */
function audienceToApi(a: BRollSettings['audience']): string {
  return a; // already matches API schema by design (see Settings type)
}

/**
 * Post once to /api/broll and parse the response. Does not retry — callers
 * handle empty-hook retries.
 */
async function callApi(settings: BRollSettings): Promise<BRollResponse> {
  const body = {
    minDurationSec: settings.minSec,
    maxDurationSec: settings.maxSec,
    audience: audienceToApi(settings.audience),
    controversyLevel: settings.controversy,
    useTrends: settings.pullTrending,
    generateHook: settings.generateText,
    cropTo916: settings.cropServerSide,
    recentHooks: [],
  };

  let res: Response;
  try {
    res = await fetch(BROLL_API, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new BRollApiError(`fetch failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new BRollApiError(`HTTP ${res.status}`);
  }

  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new BRollApiError('response not JSON');
  }

  const typed = json as BRollResponse;
  if (!typed.success) throw new BRollApiError('success: false in response');
  if (!typed.mp4DataUrl || !typed.mp4DataUrl.startsWith('data:video/mp4;base64,')) {
    throw new BRollApiError('missing or malformed mp4DataUrl');
  }
  return typed;
}

/**
 * Decode a data:video/mp4;base64,... URL to a file on disk.
 * Returns the filename (just the leaf, not the full path).
 */
async function writeVideoToDisk(
  dataUrl: string,
  outDir: string,
  slug: string,
): Promise<string> {
  await fsp.mkdir(outDir, { recursive: true });
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('writeVideoToDisk: data URL missing comma');
  const b64 = dataUrl.slice(comma + 1);
  const buf = Buffer.from(b64, 'base64');
  const ts = Date.now();
  const safeSlug = (slug || 'broll').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const filename = `${ts}-${safeSlug}.mp4`;
  fs.writeFileSync(path.join(outDir, filename), buf);
  return filename;
}

/**
 * Build the overlay text that goes into TikTok's editor: all overlay_lines
 * joined by newlines, then a blank line, then the closer_line.
 *
 * Exported for unit testing.
 */
export function buildOverlayText(hook: Hook): string {
  const lines = (hook.overlay_lines ?? []).filter(l => l && l.trim().length > 0);
  const closer = (hook.closer_line ?? '').trim();
  const body = lines.join('\n');
  if (!closer) return body;
  return body ? `${body}\n\n${closer}` : closer;
}

/**
 * Build the TikTok caption: caption body, then a blank line, then hashtags
 * space-separated.
 *
 * Exported for unit testing.
 */
export function buildCaption(hook: Hook): { caption: string; hashtags: string } {
  const body = (hook.caption ?? '').trim();
  const tags = (hook.hashtags ?? [])
    .map(t => (t.startsWith('#') ? t : `#${t}`).trim())
    .filter(t => t.length > 1)
    .join(' ');
  const caption = tags ? `${body}\n\n${tags}` : body;
  return { caption, hashtags: tags };
}

/**
 * Main export. Fetches one B-roll clip with overlay/caption text, writes
 * everything to disk, and returns paths + parsed fields.
 *
 * Retries up to settings.overlayRetries times if the server returns hook:
 * null (the AI call failed silently). Each retry is a fresh API call.
 */
export async function generateBRoll(
  settings: BRollSettings,
  outDir: string,
): Promise<BRollResult> {
  const maxAttempts = Math.max(1, settings.overlayRetries);
  let lastResp: BRollResponse | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await callApi(settings);
    lastResp = resp;
    if (!settings.generateText) break; // caller doesn't want text; accept whatever
    if (resp.hook) break;               // success — got a populated hook
    // else: empty hook, try again
  }

  if (!lastResp) throw new BRollApiError('no response after retries'); // defensive

  if (settings.generateText && !lastResp.hook) {
    throw new OverlayGenerationFailed(maxAttempts);
  }

  const slug = lastResp.sourceCategory || 'broll';
  const videoFilename = await writeVideoToDisk(lastResp.mp4DataUrl, outDir, slug);
  const videoPath = path.join(outDir, videoFilename);

  const hook = lastResp.hook!;
  const overlayText = buildOverlayText(hook);
  const { caption, hashtags } = buildCaption(hook);

  const overlayPath = videoPath.replace(/\.mp4$/, '.overlay.txt');
  const captionPath = videoPath.replace(/\.mp4$/, '.caption.txt');
  fs.writeFileSync(overlayPath, overlayText);
  fs.writeFileSync(captionPath, caption);

  const aspectRatio = parseAspectRatio(lastResp.processing);

  return {
    videoPath,
    overlayPath,
    overlayText,
    captionPath,
    caption,
    hashtags,
    slug,
    clipDurationSec: lastResp.durationSec,
    aspectRatio,
  };
}
