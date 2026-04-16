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
