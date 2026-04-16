// src/lib/tiktok.ts
import type { Page } from 'playwright';
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
 * The caption is split into body + hashtags. The body is typed via insertText
 * (fast). Each hashtag is then typed character-by-character with a small delay
 * so TikTok's autocomplete dropdown fires; we press Enter after each hashtag
 * to commit it as a mention/hashtag entity (otherwise it stays as plain text
 * and TikTok publishes without hashtag links).
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

  // Split into body + hashtag tokens. The roll-slides caption shape is:
  //   <body paragraph>\n\n<#tag1 #tag2 #tag3 ...>
  // Some captions might not have hashtags; we handle that gracefully.
  const hashtagPattern = /#[A-Za-z0-9_]+/g;
  const allHashtags = caption.match(hashtagPattern) ?? [];
  // Split off the hashtag line — everything before the FIRST # token is the body.
  const firstHashIdx = caption.search(/(^|\s)#[A-Za-z0-9_]/);
  const body = firstHashIdx >= 0 ? caption.slice(0, firstHashIdx).trimEnd() : caption.trimEnd();

  // Type the body fast (no hashtag handling needed).
  if (body.length > 0) {
    await page.keyboard.insertText(body);
  }

  // Insert separator between body and hashtags (matches rollSlides output: \n\n).
  if (allHashtags.length > 0) {
    if (body.length > 0) {
      // Use type to send actual newline keystrokes (Draft.js handles them via key events).
      await page.keyboard.press('Enter');
      await page.keyboard.press('Enter');
    }

    // Type each hashtag character-by-character + Enter to commit.
    for (let i = 0; i < allHashtags.length; i++) {
      const tag = allHashtags[i]!; // includes leading #
      // type() sends individual keypresses with an optional per-char delay.
      // 30ms is enough to let TikTok's autocomplete fire without being painfully slow.
      await page.keyboard.type(tag, { delay: 30 });
      // Wait briefly for the autocomplete dropdown to appear.
      await page.waitForTimeout(500);
      // Press Enter to commit the hashtag as a mention entity.
      await page.keyboard.press('Enter');
      await page.waitForTimeout(150);
      // Add a space between hashtags (but not after the last one).
      if (i < allHashtags.length - 1) {
        await page.keyboard.type(' ');
      }
    }
  }

  // Final dismissal in case any dropdown is still showing.
  await page.keyboard.press('Escape').catch(() => {});
}

/**
 * Clicks the first chip in the row of suggested locations under "Search locations".
 * Returns the location name, or null if no chips were available.
 *
 * Selectors verified live: .poi-suggestion is the container, .suggest-item is each chip.
 */
export async function setFirstLocationChip(page: Page): Promise<string | null> {
  const result = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('.poi-suggestion .suggest-item'));
    if (chips.length === 0) return { clicked: false as const };
    const first = chips[0] as HTMLElement;
    const text = (first.textContent || '').trim();
    first.click();
    return { clicked: true as const, name: text };
  });
  if (!result.clicked) return null;
  return result.name ?? null;
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
