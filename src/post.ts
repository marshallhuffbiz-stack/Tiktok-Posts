// src/post.ts
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser } from './lib/browser.js';
import { pickRandomTopic } from './lib/topics.js';
import { generateVideo } from './lib/rollSlides.js';
import {
  openUploadPage,
  attachVideo,
  setCaption,
  setFirstLocationChip,
  clickPost,
  waitForPostSuccess,
  installDialogAutoAccept,
  SessionExpiredError,
  PostFailedError,
} from './lib/tiktok.js';
import { pickSound } from './lib/sounds.js';
import { appendRun, readRecentRuns } from './lib/log.js';
import { notify } from './lib/notify.js';
import { acquireLock } from './lib/lockfile.js';
import { spawnSync } from 'node:child_process';
import type { Settings, RunEntry, ErrorType } from './lib/types.js';
import { sanitizeVideo } from './lib/sanitizeVideo.js';

const ROOT = process.cwd();
const SETTINGS_PATH = path.join(ROOT, 'config', 'settings.json');
const TOPICS_PATH = path.join(ROOT, 'config', 'topics.txt');
const LOG_PATH = path.join(ROOT, 'logs', 'runs.jsonl');
const LOCK_PATH = path.join(ROOT, '.post.lock');
const DOWNLOADS_DIR = path.join(ROOT, 'downloads');
const BROWSER_DATA = path.join(ROOT, 'browser-data');

function classify(err: unknown): ErrorType {
  if (err instanceof SessionExpiredError) return 'tiktok-session-expired';
  if (err instanceof PostFailedError) return 'tiktok-post-failed';
  const msg = (err as Error)?.message ?? '';
  if (/no topics/i.test(msg)) return 'unknown-error';
  if (/Generate.*timeout|waitForFunction.*timeout/i.test(msg)) return 'roll-slides-timeout';
  if (/unexpected video src/i.test(msg)) return 'roll-slides-no-video';
  if (/Uploaded.*timeout/i.test(msg)) return 'tiktok-upload-stuck';
  if (/violat|community guidelines|rate limit/i.test(msg)) return 'tiktok-account-flagged';
  return 'unknown-error';
}

function isHardFailure(t: ErrorType): boolean {
  return t === 'tiktok-session-expired' || t === 'tiktok-account-flagged';
}

function pauseSchedule(): void {
  const uid = process.getuid?.() ?? 0;
  spawnSync('launchctl', ['bootout', `gui/${uid}/com.user.tiktokpost`]);
}

function pruneOldDownloads(maxAgeDays: number): void {
  if (!fs.existsSync(DOWNLOADS_DIR)) return;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const f of fs.readdirSync(DOWNLOADS_DIR)) {
    const p = path.join(DOWNLOADS_DIR, f);
    try {
      const stat = fs.statSync(p);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(p);
    } catch { /* ignore */ }
  }
}

async function main() {
  const startTs = Date.now();
  const isDryRun = process.argv.includes('--dry-run');

  // Pre-flight
  if (!fs.existsSync(BROWSER_DATA)) {
    await notify('TikTok Schedule', 'browser-data/ missing — run `npm run login`', 'Basso');
    process.exit(1);
  }
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Settings;
  const lock = await acquireLock(LOCK_PATH).catch(async err => {
    console.error(err.message);
    process.exit(1);
  }) as { release(): Promise<void> };

  let entry: RunEntry = { ts: new Date().toISOString(), status: 'fail', durationMs: 0 };
  const browser = await openBrowser();

  // CRITICAL: install dialog auto-accept BEFORE any TikTok interactions.
  // Locked from Task 11 spike — TikTok fires beforeunload on success navigation.
  installDialogAutoAccept(browser.page);

  try {
    const topic = pickRandomTopic(TOPICS_PATH);
    entry.topic = topic;

    // Roll slides
    const rs = await generateVideo(browser.page, topic, settings, DOWNLOADS_DIR);
    entry.slug = rs.slug;
    entry.captionFirst80 = rs.caption.slice(0, 80);

    // Re-encode with Apple HW encoder + iPhone metadata to mask the libx264/FFmpeg
    // fingerprint TikTok uses to flag automated content.
    const uploadPath = sanitizeVideo(rs.videoPath);

    // TikTok
    await openUploadPage(browser.page, settings);
    await attachVideo(browser.page, uploadPath);
    await setCaption(browser.page, rs.caption);

    if (settings.tiktok.clickFirstLocationChip) {
      const loc = await setFirstLocationChip(browser.page);
      if (loc) entry.location = loc;
    }

    const recent = await readRecentRuns(LOG_PATH, 50);
    const sound = await pickSound(browser.page, recent, settings.antiRepeat.soundLastN);
    entry.soundName = sound.soundName;
    entry.soundFallback = sound.fallback;
    if (sound.skipped) {
      // Don't fail the post, but surface the degradation.
      await notify('TikTok Schedule', 'Sound editor failed to open — posted with Original Sound', 'Glass');
    }

    if (isDryRun) {
      // Dry-run: do NOT click Post. The post never sends. Closing the browser
      // (in finally) discards the form. We deliberately skip the Discard
      // confirmation UI because it's brittle and unnecessary — not clicking
      // Post is sufficient to ensure no post.
      entry.status = 'dry-run-success';
    } else {
      await clickPost(browser.page);
      await waitForPostSuccess(browser.page);
      entry.status = 'success';
    }
  } catch (err) {
    const errorType = classify(err);
    entry.status = 'fail';
    entry.errorType = errorType;
    entry.errorMsg = (err as Error).message?.slice(0, 200);
    await notify('TikTok Schedule', `${errorType}: ${entry.errorMsg ?? ''}`.slice(0, 200), 'Basso');
    if (isHardFailure(errorType)) {
      await notify('TikTok Schedule', 'Schedule auto-paused. Fix and run `npm run resume`.', 'Basso');
      pauseSchedule();
    }
  } finally {
    entry.durationMs = Date.now() - startTs;
    try { await appendRun(LOG_PATH, entry); } catch { /* ignore log errors */ }
    await browser.close();
    pruneOldDownloads(settings.retention.downloadsKeepDays);
    await lock.release();
  }

  process.exit(entry.status === 'fail' ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
