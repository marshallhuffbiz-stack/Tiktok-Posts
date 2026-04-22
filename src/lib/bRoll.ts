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
import { parseAspectRatio, is916 } from './bRollParse.js';
import { findHdVariant, downloadBytes, parsePexelsUrl } from './pexelsVariant.js';
import { diversifyHashtags, rewriteCaptionOpener } from './contentVariety.js';
import { pickTopic, pickAudienceControversy } from './brollVariety.js';
import { addVoiceover } from './voiceover.js';
import type { BRollResult, BRollSettings } from './types.js';

const BROLL_API = 'https://rent-roll-slides.vercel.app/api/broll';

/** Thrown when the generator returns success but with a null/empty hook */
export class OverlayGenerationFailed extends Error {
  constructor(attempts: number) {
    super(`rent-roll-slides returned empty hook ${attempts} time(s)`);
    this.name = 'OverlayGenerationFailed';
  }
}

/** Thrown when we exhausted retries looking for a portrait (9:16) clip */
export class NoPortraitClipFound extends Error {
  constructor(attempts: number, lastAspect: string) {
    super(`no 9:16 clip after ${attempts} attempts (last: ${lastAspect})`);
    this.name = 'NoPortraitClipFound';
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
  /** Origin URL of the clip — verified to be from videos.pexels.com (not Mixkit, despite the rent-roll-slides UI text). */
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
 * handle empty-hook retries. `overrides` lets the caller vary audience,
 * controversy, and topic per run to force different hook templates.
 */
async function callApi(
  settings: BRollSettings,
  recentHooks: string[] = [],
  overrides: { audience?: string; controversy?: number; topic?: string } = {},
): Promise<BRollResponse> {
  const body: Record<string, unknown> = {
    minDurationSec: settings.minSec,
    maxDurationSec: settings.maxSec,
    audience: overrides.audience ?? audienceToApi(settings.audience),
    controversyLevel: overrides.controversy ?? settings.controversy,
    useTrends: settings.pullTrending,
    generateHook: settings.generateText,
    cropTo916: settings.cropServerSide,
    recentHooks,
  };
  if (overrides.topic) body.topic = overrides.topic;

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
 * Resolve the source bytes to use for the upload. If the API returned a
 * UHD Pexels URL, try to fetch the matching HD variant directly from
 * Pexels (smaller file, more "mobile-app-like" upload signature). On any
 * failure, fall back to the UHD bytes already in the data URL.
 *
 * Returns { buffer, source } where `source` indicates which variant we used.
 */
async function resolveBytes(
  dataUrl: string, sourceUrl: string,
): Promise<{ buffer: Buffer; source: 'pexels-hd' | 'api-uhd'; chosenUrl: string }> {
  const parsed = parsePexelsUrl(sourceUrl);
  if (parsed && parsed.tier === 'uhd') {
    try {
      const hdUrl = await findHdVariant(sourceUrl);
      if (hdUrl) {
        const buf = await downloadBytes(hdUrl);
        return { buffer: buf, source: 'pexels-hd', chosenUrl: hdUrl };
      }
    } catch {
      // fall through to UHD data URL
    }
  }
  // Fallback: decode the UHD data URL the API returned
  const comma = dataUrl.indexOf(',');
  if (comma < 0) throw new Error('resolveBytes: data URL missing comma');
  const b64 = dataUrl.slice(comma + 1);
  return { buffer: Buffer.from(b64, 'base64'), source: 'api-uhd', chosenUrl: sourceUrl };
}

/**
 * Write video bytes to disk; returns the filename (not full path).
 */
async function writeVideoToDisk(
  buffer: Buffer, outDir: string, slug: string,
): Promise<string> {
  await fsp.mkdir(outDir, { recursive: true });
  const ts = Date.now();
  const safeSlug = (slug || 'broll').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
  const filename = `${ts}-${safeSlug}.mp4`;
  fs.writeFileSync(path.join(outDir, filename), buffer);
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
 * Build the TikTok caption: rewrite the body opener for variety, diversify
 * the hashtag set against our pool (and drop over-used tags like #fyp),
 * then compose "body\n\n#tags".
 *
 * Exported for unit testing.
 */
export function buildCaption(hook: Hook): { caption: string; hashtags: string } {
  const rawBody = (hook.caption ?? '').trim();
  const body = rewriteCaptionOpener(rawBody);
  const diversified = diversifyHashtags(hook.hashtags ?? []);
  const tags = diversified.join(' ');
  const caption = tags ? `${body}\n\n${tags}` : body;
  return { caption, hashtags: tags };
}

/**
 * Main export. Fetches one B-roll clip with overlay/caption text, writes
 * everything to disk, and returns paths + parsed fields.
 *
 * Requires BOTH a populated hook AND a 9:16 portrait aspect ratio. We
 * don't crop locally — re-encoding would strip the authentic camera
 * fingerprint that's the whole point of stream-copy. Instead we re-roll
 * the API call until we get a clip that's already 9:16.
 *
 * maxAttempts caps the total API calls (default: overlayRetries from
 * settings, minimum 1). Each attempt is one API call.
 */
export async function generateBRoll(
  settings: BRollSettings,
  outDir: string,
  recentHooks: string[] = [],
  opts: {
    recentTopics?: string[];
    recentAudience?: string[];
    recentControversy?: number[];
  } = {},
): Promise<BRollResult> {
  const maxAttempts = Math.max(1, settings.overlayRetries);
  let lastResp: BRollResponse | null = null;
  let lastAspect = '';

  // Pick fresh topic + audience/controversy per call (force template variety).
  // Keep these stable across retries within a single generation so we don't
  // jump categories mid-loop.
  const chosenTopic = pickTopic(opts.recentTopics ?? []);
  const { audience: chosenAudience, controversy: chosenControversy } =
    pickAudienceControversy(opts.recentAudience ?? [], opts.recentControversy ?? []);
  const overrides = { topic: chosenTopic, audience: chosenAudience, controversy: chosenControversy };
  console.log(`[bRoll] inputs: topic="${chosenTopic}" audience=${chosenAudience} controversy=${chosenControversy}`);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let resp: BRollResponse;
    try {
      resp = await callApi(settings, recentHooks, overrides);
    } catch (err) {
      // Transient HTTP errors (500, 502, 503, fetch failures) — retry silently
      if (err instanceof BRollApiError && attempt < maxAttempts) {
        console.log(`[bRoll] attempt ${attempt} API error, retrying: ${err.message}`);
        continue;
      }
      throw err;
    }
    lastResp = resp;
    const aspect = parseAspectRatio(resp.processing);
    lastAspect = aspect;
    const hookOk = !settings.generateText || !!resp.hook;
    const aspectOk = is916(aspect);
    if (hookOk && aspectOk) break;
    // otherwise continue — we'll discard this clip and try again
  }

  if (!lastResp) throw new BRollApiError('no response after retries'); // defensive

  if (settings.generateText && !lastResp.hook) {
    throw new OverlayGenerationFailed(maxAttempts);
  }
  if (!is916(lastAspect)) {
    throw new NoPortraitClipFound(maxAttempts, lastAspect);
  }

  const slug = lastResp.sourceCategory || 'broll';
  const resolved = await resolveBytes(lastResp.mp4DataUrl, lastResp.sourceUrl);
  if (resolved.source === 'pexels-hd') {
    console.log(`[bRoll] using Pexels HD variant: ${resolved.chosenUrl}`);
  }
  const videoFilename = await writeVideoToDisk(resolved.buffer, outDir, slug);
  let videoPath = path.join(outDir, videoFilename);

  const hook = lastResp.hook!;
  const overlayText = buildOverlayText(hook);
  const { caption, hashtags } = buildCaption(hook);

  // Optional: add TTS voice-over (preserves Pexels h264 stream byte-for-byte;
  // only encodes new AAC audio track). Falls back to silent original on
  // any failure so we never block a post on TTS issues.
  if (settings.voiceover?.enabled) {
    try {
      const voicedPath = addVoiceover(videoPath, overlayText, {
        voice: settings.voiceover.voice,
        rate: settings.voiceover.rate,
      });
      // Keep voiced as the upload target; remove silent original to save disk
      try { fs.unlinkSync(videoPath); } catch { /* ignore */ }
      videoPath = voicedPath;
    } catch (err) {
      console.warn('[voiceover] failed (using silent original):', (err as Error).message);
    }
  }

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
    sourceUrl: lastResp.sourceUrl,
    templateId: hook.template_id,
    chosenTopic,
    chosenAudience,
    chosenControversy,
  };
}
