// src/lib/sounds.ts
import type { Page } from 'playwright';
import type { RunEntry } from './types.js';

export interface SoundPickResult {
  soundName: string;
  fallback: boolean;
}

/**
 * Opens the Sounds editor, picks the least-recently-used sound from Favorites
 * (filtering against `recentRuns`), saves, and returns. On any failure, falls back
 * to the first sound in the For You tab (the editor's default tab).
 */
export async function pickSound(
  page: Page,
  recentRuns: RunEntry[],
  antiRepeatN: number,
): Promise<SoundPickResult> {
  // Open the Sounds editor.
  await page.getByRole('button', { name: 'Sounds' }).click();
  // The editor view is identifiable by the title becoming "My Multimedia Project".
  await page.getByText('My Multimedia Project').waitFor({ timeout: 30_000 });

  const recentSoundNames = new Set(
    recentRuns
      .slice(-antiRepeatN)
      .map(r => r.soundName)
      .filter((n): n is string => Boolean(n)),
  );

  try {
    const picked = await pickFromFavorites(page, recentSoundNames);
    if (picked) {
      await saveSoundEditor(page);
      return { soundName: picked, fallback: false };
    }
    // No usable favorite — fall through to fallback.
  } catch {
    // Selector miss, click failed, etc. — fall through.
  }

  const fallback = await pickFirstForYou(page);
  await saveSoundEditor(page);
  return { soundName: fallback, fallback: true };
}

async function pickFromFavorites(page: Page, recentNames: Set<string>): Promise<string | null> {
  // Click the Favorites tab.
  await page.getByText('Favorites', { exact: true }).click();
  await page.waitForTimeout(800); // let list render

  // Read the visible sound items. Each item shows: thumbnail + name + duration · artist + "+" button.
  const candidates = await page.evaluate(() => {
    // Look for "+" buttons in the sounds panel; each one is associated with a sound row.
    const plusButtons = Array.from(document.querySelectorAll('button'))
      .filter(b => (b.textContent || '').trim() === '+' || (b.textContent || '').trim() === '＋');
    return plusButtons.map((btn, idx) => {
      // Walk up to the row container, then read the strong/heading-ish text inside it.
      const row = btn.closest('div[class*="item"], li, .sound-item, div[class*="row"]') ?? btn.parentElement;
      const titleEl = row?.querySelector('strong, h4, h5, [class*="title"], [class*="name"]');
      const name = titleEl?.textContent?.trim() || (row?.textContent || '').trim().split('\n')[0] || `unknown-${idx}`;
      return { name: name.slice(0, 80) };
    });
  });

  if (candidates.length === 0) return null;

  // Pick least-recently-used: first candidate not in the recent set, else the first overall.
  const usable = candidates.find(c => !recentNames.has(c.name)) ?? candidates[0];

  if (!usable) return null;

  // Click the "+" for the chosen item, by its index in the list of plus buttons.
  const idx = candidates.indexOf(usable);
  await page.evaluate((targetIdx) => {
    const plusButtons = Array.from(document.querySelectorAll('button'))
      .filter(b => (b.textContent || '').trim() === '+' || (b.textContent || '').trim() === '＋');
    plusButtons[targetIdx]?.click();
  }, idx);

  await page.waitForTimeout(500);
  return usable.name;
}

async function pickFirstForYou(page: Page): Promise<string> {
  // Switch to For You (default tab — clicking is harmless if already there).
  await page.getByText('For You', { exact: true }).click();
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => {
    const plusButtons = Array.from(document.querySelectorAll('button'))
      .filter(b => (b.textContent || '').trim() === '+' || (b.textContent || '').trim() === '＋');
    if (plusButtons.length === 0) throw new Error('no sounds in For You');
    const btn = plusButtons[0]!;
    const row = btn.closest('div[class*="item"], li, .sound-item, div[class*="row"]') ?? btn.parentElement;
    const titleEl = row?.querySelector('strong, h4, h5, [class*="title"], [class*="name"]');
    const name = titleEl?.textContent?.trim() || (row?.textContent || '').trim().split('\n')[0] || 'unknown';
    btn.click();
    return name.slice(0, 80);
  });
  await page.waitForTimeout(500);
  return result;
}

async function saveSoundEditor(page: Page): Promise<void> {
  // Click the top-right Save button. Use a locator scoped to the editor toolbar.
  await page.getByRole('button', { name: 'Save' }).click();
  // After save, the editor closes and we return to the upload form. The "Description" label reappears.
  await page.getByText('Description', { exact: true }).waitFor({ timeout: 30_000 });
}
