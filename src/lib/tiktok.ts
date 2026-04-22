// src/lib/tiktok.ts
import type { Page } from 'patchright';
import type { Settings, TikTokResult } from './types.js';

export class SessionExpiredError extends Error {
  constructor() { super('TikTok session expired'); this.name = 'SessionExpiredError'; }
}

const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload';

/**
 * Aggressive dismissal of any lingering tour modals / tooltips / popups.
 * Tries a set of common dismissal-button texts with very short timeouts.
 * Any misses are silent — this is best-effort cleanup.
 */
async function dismissAllPopups(page: Page): Promise<void> {
  const labels = [
    'Got it',
    'Skip',
    'Skip tour',
    'Close',
    'Dismiss',
    'No thanks',
    'Not now',
    'Maybe later',
    'Cancel',      // may be wrong context (e.g. sounds editor) — only safe outside active editors
    'Turn on',     // automatic-content-checks opt-in (we default to Cancel, but Turn on dismisses too)
  ];
  for (const name of labels) {
    for (let i = 0; i < 3; i++) {
      try {
        await page.getByRole('button', { name, exact: true }).first().click({ timeout: 1500 });
      } catch {
        break; // none or no-longer-present — move on
      }
    }
  }
  // Belt-and-suspenders: press Escape a couple times to close any remaining tooltip overlays.
  await page.keyboard.press('Escape').catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
}

/**
 * Navigates to the upload page. Throws SessionExpiredError if redirected to /login.
 * Dismisses any first-run popups ("New editing features", "Turn on automatic content checks").
 */
export async function openUploadPage(page: Page, settings: Settings): Promise<void> {
  await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (page.url().includes('/login')) throw new SessionExpiredError();

  // Race the file input appearing against a /login redirect.
  // TikTok validates the session client-side after navigation; if expired, the
  // page navigates to /login a few hundred ms after domcontentloaded.
  const fileInputReady = page.locator('input[type="file"][accept="video/*"]')
    .first()
    .waitFor({ state: 'attached', timeout: 60_000 });
  const loginRedirect = page.waitForURL(/\/login/, { timeout: 60_000 }).then(() => 'login');

  const winner = await Promise.race([
    fileInputReady.then(() => 'file-input'),
    loginRedirect,
  ]).catch(() => null); // both rejected → file input timed out, treated below

  if (winner === 'login') throw new SessionExpiredError();
  if (winner !== 'file-input') {
    // Neither resolved cleanly within 60s. Re-throw with a descriptive error.
    throw new Error('upload page did not finish rendering within 60s (no file input, no /login redirect)');
  }

  // Aggressively dismiss any tour modals / tooltips / first-run popups.
  // Fresh Playwright Chromium sessions tend to see more of these than warm browsers.
  await dismissAllPopups(page);
}

async function tryClickButton(page: Page, name: string, timeoutMs: number): Promise<boolean> {
  try {
    await page.getByRole('button', { name }).first().click({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Uploads the MP4 via the hidden file input and waits for "Uploaded" indicator.
 */
export async function attachVideo(page: Page, mp4Path: string): Promise<void> {
  const input = page.locator('input[type="file"][accept="video/*"]').first();
  await input.setInputFiles(mp4Path);
  // The "Uploaded（XMB）" text appears once the upload completes.
  await page.getByText(/Uploaded\s*[（(]/).waitFor({ timeout: 90_000 });
}

/**
 * Replaces the auto-prefilled (filename) caption with the real caption.
 *
 * The body is typed via insertText (fast). Each hashtag is then typed
 * character-by-character with a small delay so TikTok's autocomplete
 * dropdown fires; we wait for the dropdown's focused item to be visible
 * (NOT a fixed timeout — we wait for the actual element), then press Enter
 * to commit it as a <span class="mention"> entity. Pressing Enter auto-adds
 * a trailing space, so we don't add our own.
 *
 * Verified live: mentionCount goes from 0 -> N for N hashtags.
 */
export async function setCaption(page: Page, caption: string): Promise<void> {
  const editor = page.locator('.public-DraftEditor-content').first();
  await editor.waitFor({ state: 'attached', timeout: 30_000 });
  try {
    await editor.click({ force: true, timeout: 10_000 });
  } catch {
    await editor.evaluate((el) => (el as HTMLElement).focus());
  }
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Delete');

  // Split: body is everything before the first #token; remaining tokens are hashtags.
  const allHashtags = caption.match(/#[A-Za-z0-9_]+/g) ?? [];
  const firstHashIdx = caption.search(/(^|\s)#[A-Za-z0-9_]/);
  const body = firstHashIdx >= 0 ? caption.slice(0, firstHashIdx).trimEnd() : caption.trimEnd();

  // Body via fast insertText.
  if (body.length > 0) {
    await page.keyboard.insertText(body);
  }

  // Paragraph break before hashtags (matches the rollSlides caption shape).
  if (allHashtags.length > 0 && body.length > 0) {
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
  }

  // Type each hashtag, wait for the autocomplete focused item, press Enter to commit.
  // Enter auto-adds a trailing space — don't add our own.
  for (const tag of allHashtags) {
    await page.keyboard.type(tag, { delay: 60 });
    try {
      await page.locator('.hashtag-suggestion-item.focused').first().waitFor({
        state: 'visible',
        timeout: 3_000,
      });
      await page.keyboard.press('Enter');
      await page.waitForTimeout(300);
    } catch {
      // Dropdown didn't appear — leave the tag as plain text and move on.
      // (Should be rare; logs would help debug.)
    }
  }

  // Best-effort dismiss any lingering dropdown.
  await page.keyboard.press('Escape').catch(() => {});
}

/**
 * Clicks a RANDOM chip in the row of suggested locations under "Search locations".
 * Returns the location name, or null if no chips were available.
 *
 * Selectors verified live: .poi-suggestion is the container, .suggest-item is each chip.
 * Random pick (not always first) reduces "same location every post" detection signal.
 */
export async function setRandomLocationChip(page: Page): Promise<string | null> {
  const result = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('.poi-suggestion .suggest-item'));
    // Filter out the "Advance" link (it's a "see more" that opens a location
    // search modal — not a real location chip).
    const usable = chips.filter((el) => {
      const t = (el.textContent || '').trim().toLowerCase();
      return t.length > 0 && t !== 'advance';
    });
    if (usable.length === 0) return { clicked: false as const };
    const idx = Math.floor(Math.random() * usable.length);
    const chosen = usable[idx] as HTMLElement;
    const text = (chosen.textContent || '').trim();
    chosen.click();
    return { clicked: true as const, name: text };
  });
  if (!result.clicked) return null;
  return result.name ?? null;
}

// Keep the old name as an alias for backwards compat — orchestrator can use either.
export const setFirstLocationChip = setRandomLocationChip;

/**
 * Type a specific location into the location search box and click the
 * first matching result. Used when locationMode === 'search'.
 *
 * Returns the location name chosen, or null if no match appeared.
 */
export async function setLocationBySearch(page: Page, query: string): Promise<string | null> {
  const input = page.locator('input.Select__searchInput').first();
  try {
    await input.waitFor({ state: 'visible', timeout: 5000 });
  } catch {
    return null;  // search input not found — TikTok may hide it on some uploads
  }
  await input.click();
  await input.fill('');
  await input.type(query, { delay: 40 });
  // Wait for a result dropdown item
  await page.waitForTimeout(1200);
  const firstResult = await page.evaluate(() => {
    // Location results typically render as clickable rows in a list.
    // Try several selector patterns since TikTok rearranges class names.
    const candidates = [
      '.poi-suggestion .suggest-item',
      '[class*="PoiList"] [class*="item"]',
      '[class*="location"] [role="option"]',
      '[class*="Select__options"] [class*="item"]',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel) as HTMLElement | null;
      if (el) {
        const name = (el.textContent || '').trim();
        el.click();
        return name || '(unnamed)';
      }
    }
    return null;
  });
  return firstResult;
}

/**
 * Clicks Discard, then confirms in the dialog. Used for --dry-run smoke tests.
 */
export async function discardUpload(page: Page): Promise<void> {
  // First Discard — the action button at the bottom of the form
  const firstDiscard = page.getByRole('button', { name: /^Discard$/ }).first();
  await firstDiscard.scrollIntoViewIfNeeded();
  try {
    await firstDiscard.click({ timeout: 15_000 });
  } catch {
    await firstDiscard.click({ force: true, timeout: 5_000 });
  }
  // Second Discard — the destructive confirm inside the dialog
  const dialogDiscard = page.locator('div[role="dialog"]').getByRole('button', { name: /^Discard$/ });
  await dialogDiscard.waitFor({ state: 'visible', timeout: 10_000 });
  try {
    await dialogDiscard.click({ timeout: 15_000 });
  } catch {
    await dialogDiscard.click({ force: true, timeout: 5_000 });
  }
  await page.waitForTimeout(1500);
}

export class PostFailedError extends Error {
  constructor(reason: string) { super(`post failed: ${reason}`); this.name = 'PostFailedError'; }
}

/**
 * Clicks the Post button using TikTok's stable E2E test attribute.
 */
export async function clickPost(page: Page): Promise<void> {
  // TikTok's stable E2E test attribute on the post action button.
  const postBtn = page.locator('button[data-e2e="post_video_button"]');
  await postBtn.waitFor({ state: 'attached', timeout: 30_000 });
  const isDisabled = await postBtn.isDisabled().catch(() => true);
  if (isDisabled) throw new PostFailedError('Post button is disabled');
  await postBtn.scrollIntoViewIfNeeded();
  await postBtn.click({ timeout: 15_000 });
}

/**
 * Clicks "Save draft" instead of "Post". Useful for development and for
 * review-before-publish flows. Draft lands in the Drafts tab; the user
 * publishes it manually later.
 */
export async function clickSaveDraft(page: Page): Promise<void> {
  const btn = page.locator('button[data-e2e="save_draft_button"]');
  await btn.waitFor({ state: 'attached', timeout: 30_000 });
  const isDisabled = await btn.isDisabled().catch(() => true);
  if (isDisabled) throw new PostFailedError('Save draft button is disabled');
  await btn.scrollIntoViewIfNeeded();
  await btn.click({ timeout: 15_000 });
}

/**
 * Waits for evidence that the post succeeded.
 *
 * Locked from Task 11 spike: TikTok's success signal is a URL change from
 * /tiktokstudio/upload → /tiktokstudio/content within ~2 seconds.
 *
 * Throws PostFailedError on timeout.
 */
export async function waitForPostSuccess(page: Page): Promise<void> {
  try {
    await page.waitForURL(/tiktokstudio\/content/, { timeout: 60_000 });
  } catch (err) {
    throw new PostFailedError(`URL did not change to /tiktokstudio/content within 60s (still at ${page.url()})`);
  }
}

/**
 * After a real post lands on /tiktokstudio/content, find the newest post
 * card, click into its analytics page, and let the video play for at
 * least `durationSec + 2`s (plus a small random extra). This creates the
 * "creator watched their own post end-to-end" engagement signal that a
 * manual-iPhone poster always generates but automation normally skips.
 *
 * Best-effort: any failure is logged and swallowed; we don't want the
 * watch step to cause a run to fail after the post already succeeded.
 */
export async function watchOwnPost(page: Page, durationSec: number): Promise<void> {
  try {
    // The content list page loads — wait briefly for the first card
    const firstCard = page.locator('a[href*="/tiktokstudio/analytics/"]').first();
    await firstCard.waitFor({ state: 'visible', timeout: 15_000 });
    await firstCard.click({ timeout: 10_000 });
    // Let the video play; TikTok's analytics page auto-plays videos.
    const watchMs = Math.max(3_000, durationSec * 1000 + 2_000 + Math.floor(Math.random() * 3_000));
    await page.waitForTimeout(watchMs);
  } catch (err) {
    console.warn('[post] watchOwnPost failed (non-fatal):', (err as Error).message);
  }
}

/**
 * Installs a `dialog` event handler that auto-accepts any popup (including
 * `beforeunload`). TikTok fires `beforeunload` when navigating away from
 * a populated upload form, which it does on a successful post — without this
 * handler, navigation hangs and waitForPostSuccess times out.
 *
 * Call this ONCE per Page, BEFORE clickPost.
 */
export function installDialogAutoAccept(page: Page): void {
  page.on('dialog', async (d) => {
    try { await d.accept(); } catch { /* dialog already gone */ }
  });
}
