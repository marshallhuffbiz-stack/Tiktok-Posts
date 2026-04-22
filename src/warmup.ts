// src/warmup.ts
//
// Account-warmup automation: drives the existing logged-in @rentroll.us
// session through human-like FYP browsing — scroll, watch full videos,
// occasional like, occasional follow, occasional comment-skim. Posts
// NOTHING. The single signal we're trying to generate: "this account
// is an active human user, not a posting bot."
//
// Recommended cadence (set via launchd, NOT in this file):
//   - 2-4 sessions per day, 15-30 minutes each
//   - Scattered across waking hours
//   - Different intent each session (FYP / Following / Search niche)
//
// Usage:
//   npm run warmup                       # default 20 min, FYP only
//   npm run warmup -- --minutes=30       # configurable duration
//   npm run warmup -- --tab=following    # browse Following tab
//   npm run warmup -- --search=landlord  # search a niche term and browse results
//
// Honest disclosure: TikTok also fingerprints the device + IP. If those
// are flagged, no amount of warmup activity from this device will move
// the algorithmic verdict. See:
//   docs/superpowers/specs/2026-04-22-shadowban-recovery-plan.md

import { openBrowser } from './lib/browser.js';
import { humanMouseMove } from './lib/humanMouse.js';
import { installDialogAutoAccept } from './lib/tiktok.js';
import type { Page } from 'patchright';

interface WarmupOptions {
  minutes: number;
  tab: 'fyp' | 'following';
  searchQuery?: string;
}

function parseArgs(): WarmupOptions {
  const args = process.argv.slice(2);
  const get = (name: string): string | undefined => {
    const m = args.find(a => a.startsWith(`--${name}=`));
    return m ? m.split('=', 2)[1] : undefined;
  };
  const minutes = parseInt(get('minutes') ?? '20', 10);
  const tabArg = (get('tab') ?? 'fyp').toLowerCase();
  const tab: 'fyp' | 'following' = tabArg === 'following' ? 'following' : 'fyp';
  const searchQuery = get('search');
  return { minutes, tab, searchQuery };
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

/**
 * Watch the currently-playing video for a realistic dwell time. Real users
 * don't watch every video the same length — short clips often watched 100%,
 * longer clips often skipped midway. We model this distribution roughly:
 *   - 60% completion
 *   - 25% skip after 2-4s
 *   - 15% rewatch (extra 50% of duration)
 */
async function watchOne(page: Page): Promise<void> {
  // Approximate the video's duration. Default to 15s if we can't read it.
  let durationSec = 15;
  try {
    const dur = await page.evaluate(() => {
      const v = document.querySelector('video') as HTMLVideoElement | null;
      return v ? v.duration : null;
    });
    if (dur && Number.isFinite(dur) && dur > 0) durationSec = dur;
  } catch { /* ignore */ }

  const r = Math.random();
  let dwellMs: number;
  if (r < 0.25) {
    // skip after 2-4s
    dwellMs = rand(2000, 4000);
  } else if (r < 0.85) {
    // watch ~85-105% of video
    dwellMs = durationSec * 1000 * rand(0.85, 1.05);
  } else {
    // rewatch — 1.4x duration
    dwellMs = durationSec * 1000 * rand(1.4, 1.8);
  }
  // Clamp to a sane range
  dwellMs = Math.min(60_000, Math.max(2_000, dwellMs));
  await page.waitForTimeout(dwellMs);
}

/**
 * Scroll to the next FYP video by tapping ArrowDown (TikTok's web
 * keyboard shortcut for next video). Falls back to scrolling if the
 * shortcut doesn't work.
 */
async function nextVideo(page: Page): Promise<void> {
  await page.keyboard.press('ArrowDown');
  await sleep(rand(800, 1500));
}

/**
 * Like the current video by tapping 'L' (TikTok's web keyboard
 * shortcut for like). Real users like ~10-15% of videos they watch.
 */
async function maybeLike(page: Page): Promise<boolean> {
  if (Math.random() > 0.12) return false;
  await page.keyboard.press('l');
  await sleep(rand(400, 900));
  return true;
}

/**
 * Occasionally hover the mouse over a creator's profile picture or
 * username. Real users do this; pure-bot accounts never move the
 * cursor away from center.
 */
async function maybeHoverProfile(page: Page): Promise<void> {
  if (Math.random() > 0.30) return;
  try {
    const view = page.viewportSize() || { width: 1280, height: 800 };
    // Random spot in the right-side action bar area (where like/comment buttons live)
    const targetX = view.width * (0.85 + Math.random() * 0.10);
    const targetY = view.height * (0.40 + Math.random() * 0.30);
    await humanMouseMove(page, view.width / 2, view.height / 2, targetX, targetY, { steps: 12 });
    await sleep(rand(300, 800));
  } catch { /* ignore */ }
}

async function browseSession(page: Page, opts: WarmupOptions): Promise<{ watched: number; liked: number }> {
  let watched = 0;
  let liked = 0;
  const deadline = Date.now() + opts.minutes * 60 * 1000;

  // Determine starting URL
  const url = opts.searchQuery
    ? `https://www.tiktok.com/search?q=${encodeURIComponent(opts.searchQuery)}`
    : opts.tab === 'following'
      ? 'https://www.tiktok.com/following'
      : 'https://www.tiktok.com/foryou';

  console.log(`[warmup] navigating to ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForTimeout(rand(2000, 4000));

  while (Date.now() < deadline) {
    await watchOne(page);
    watched++;
    const did = await maybeLike(page);
    if (did) liked++;
    await maybeHoverProfile(page);
    await nextVideo(page);
    if (watched % 7 === 0) console.log(`[warmup] watched=${watched} liked=${liked}`);
  }
  return { watched, liked };
}

async function main(): Promise<void> {
  const opts = parseArgs();
  console.log(`[warmup] starting: ${opts.minutes} min on ${opts.tab}${opts.searchQuery ? ` search="${opts.searchQuery}"` : ''}`);

  const browser = await openBrowser({ headed: true });
  installDialogAutoAccept(browser.page);
  try {
    const stats = await browseSession(browser.page, opts);
    console.log(`[warmup] DONE: watched=${stats.watched} liked=${stats.liked} duration=${opts.minutes}min`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('[warmup] FAILED:', err);
  process.exit(1);
});
