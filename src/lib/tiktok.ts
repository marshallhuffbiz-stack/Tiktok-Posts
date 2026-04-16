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
  await editor.click();
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
  await page.getByRole('button', { name: /^Discard$/ }).first().click();
  // Dialog appears; click the destructive Discard inside it.
  await page.locator('div[role="dialog"]').getByRole('button', { name: /^Discard$/ }).click();
  await page.waitForTimeout(1500);
}

export class PostFailedError extends Error {
  constructor(reason: string) { super(`post failed: ${reason}`); this.name = 'PostFailedError'; }
}

/**
 * Clicks the Post button. Selects the LAST enabled "Post" button on the page
 * (defends against multiple matching buttons in the DOM — there's typically a
 * navigation-rail button or icon button with the same accessible name).
 */
export async function clickPost(page: Page): Promise<void> {
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll('button'))
      .filter(b => (b.textContent || '').trim() === 'Post' && !(b as HTMLButtonElement).disabled);
    if (candidates.length === 0) return false;
    (candidates[candidates.length - 1] as HTMLButtonElement).click();
    return true;
  });
  if (!clicked) throw new PostFailedError('no enabled Post button found');
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
