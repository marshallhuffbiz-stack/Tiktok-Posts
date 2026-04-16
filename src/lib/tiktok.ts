// src/lib/tiktok.ts
import type { Page } from 'playwright';
import type { Settings, TikTokResult } from './types.js';

export class SessionExpiredError extends Error {
  constructor() { super('TikTok session expired'); this.name = 'SessionExpiredError'; }
}

const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload';

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

  // Dismiss the two known first-run popups, with very short timeouts because they may not appear.
  await tryClickButton(page, 'Got it', 3_000);
  if (settings.tiktok.firstRunContentChecks === 'Cancel') {
    await tryClickButton(page, 'Cancel', 3_000);
  } else {
    await tryClickButton(page, 'Turn on', 3_000);
  }
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
 * The Description editor is Draft.js; we cannot fill() — must select-all + delete + insertText.
 */
export async function setCaption(page: Page, caption: string): Promise<void> {
  const editor = page.locator('.public-DraftEditor-content').first();
  // Wait for the editor to exist in the DOM before trying to interact.
  await editor.waitFor({ state: 'attached', timeout: 30_000 });
  // Use force:true to bypass Playwright's actionability checks. The Draft.js
  // editor sometimes gets a transient pointer-events block during the upload
  // settle phase; we just need a click event to fire so the element gains focus.
  try {
    await editor.click({ force: true, timeout: 10_000 });
  } catch {
    // Final fallback: focus directly via JS
    await editor.evaluate((el) => (el as HTMLElement).focus());
  }
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(caption);
  await page.keyboard.press('Escape'); // dismiss hashtag autocomplete
}

/**
 * Clicks the first chip in the row of suggested locations under "Search locations".
 * Returns the location name, or null if no chips were available.
 */
export async function setFirstLocationChip(page: Page): Promise<string | null> {
  // Locate the "Location" label, then the suggestion list directly below it.
  // Chips are <li><div>Name</div></li> — the last item ("Advance") is a "see more" link, skip it.
  const result = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('div, span'))
      .filter(el => (el.textContent || '').trim() === 'Location' && el.children.length === 0);
    if (labels.length === 0) return { clicked: false, reason: 'no Location label' };
    const labelParent = labels[0]!.parentElement?.parentElement;
    if (!labelParent) return { clicked: false, reason: 'no parent' };
    const list = labelParent.querySelector('ul, [role="list"]') as HTMLElement | null;
    if (!list) return { clicked: false, reason: 'no chip list' };
    const items = Array.from(list.querySelectorAll('li')) as HTMLLIElement[];
    // Filter out the "Advance" / "See more" entry by checking text length / known label.
    const usable = items.filter(li => {
      const t = (li.textContent || '').trim();
      return t.length > 0 && t.toLowerCase() !== 'advance';
    });
    if (usable.length === 0) return { clicked: false, reason: 'no usable chips' };
    const first = usable[0]!;
    const text = (first.textContent || '').trim();
    (first as HTMLElement).click();
    return { clicked: true, name: text };
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
