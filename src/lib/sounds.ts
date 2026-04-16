// src/lib/sounds.ts
import type { Page } from 'playwright';
import type { RunEntry } from './types.js';

export interface SoundPickResult {
  soundName: string;
  fallback: boolean;
  /** True if the sound editor failed to open and we left Original Sound in place. */
  skipped?: boolean;
}

export async function pickSound(
  page: Page,
  recentRuns: RunEntry[],
  antiRepeatN: number,
): Promise<SoundPickResult> {
  try {
    return await pickSoundInner(page, recentRuns, antiRepeatN);
  } catch (err) {
    // Editor flow failed — leave the default Original Sound in place.
    return { soundName: '<original sound>', fallback: true, skipped: true };
  }
}

async function pickSoundInner(
  page: Page,
  recentRuns: RunEntry[],
  antiRepeatN: number,
): Promise<SoundPickResult> {
  // Open the Sounds editor via its stable data attribute.
  const soundsBtn = page.locator('button[data-button-name="sounds"]');
  await soundsBtn.waitFor({ state: 'attached', timeout: 15_000 });
  await soundsBtn.scrollIntoViewIfNeeded();
  await soundsBtn.click({ timeout: 15_000 });

  // Wait for the editor to be ready. Any of these signals confirms it opened.
  await Promise.race([
    page.getByText('My Multimedia Project').waitFor({ timeout: 30_000 }),
    page.getByRole('button', { name: 'Save', exact: true }).waitFor({ timeout: 30_000 }),
    page.getByText('For You', { exact: true }).first().waitFor({ timeout: 30_000 }),
    page.getByText('Favorites', { exact: true }).first().waitFor({ timeout: 30_000 }),
  ]);

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
    // No usable favorite — fall through to the default-tab fallback.
  } catch {
    // Selector miss or click error inside Favorites — fall through.
  }

  const fallback = await pickFirstForYou(page);
  await saveSoundEditor(page);
  return { soundName: fallback, fallback: true };
}

async function pickFromFavorites(page: Page, recentNames: Set<string>): Promise<string | null> {
  // Switch to the Favorites tab.
  await page.getByText('Favorites', { exact: true }).first().click();
  // Let the list render.
  await page.waitForTimeout(800);

  // Each favorite row is a .MusicPanelMusicItem__wrap with a title and an add button.
  const candidates = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.MusicPanelMusicItem__wrap'));
    return rows.map((row, idx) => {
      const title = row.querySelector('.MusicPanelMusicItem__infoBasicTitle')?.textContent?.trim() ?? `unknown-${idx}`;
      return { idx, title };
    });
  });

  if (candidates.length === 0) return null;

  // Pick least-recently-used: first candidate not in the recent set, else the first overall.
  const usable = candidates.find(c => !recentNames.has(c.title)) ?? candidates[0]!;

  // Click the add button for the chosen row.
  const clicked = await page.evaluate((targetIdx) => {
    const rows = Array.from(document.querySelectorAll('.MusicPanelMusicItem__wrap'));
    const row = rows[targetIdx];
    if (!row) return false;
    const btn = row.querySelector('.MusicPanelMusicItem__content button') as HTMLButtonElement | null;
    if (!btn) return false;
    btn.click();
    return true;
  }, usable.idx);

  if (!clicked) return null;

  // Let the add take effect (track appears in timeline, Save becomes enabled).
  await page.waitForTimeout(600);
  return usable.title;
}

async function pickFirstForYou(page: Page): Promise<string> {
  // Switch to For You (default tab — clicking is harmless if already there).
  await page.getByText('For You', { exact: true }).first().click();
  await page.waitForTimeout(800);

  const result = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.MusicPanelMusicItem__wrap'));
    if (rows.length === 0) throw new Error('no sounds in For You');
    const row = rows[0]!;
    const title = row.querySelector('.MusicPanelMusicItem__infoBasicTitle')?.textContent?.trim() ?? 'unknown';
    const btn = row.querySelector('.MusicPanelMusicItem__content button') as HTMLButtonElement | null;
    if (!btn) throw new Error('no add button in first For You row');
    btn.click();
    return title;
  });
  await page.waitForTimeout(600);
  return result;
}

async function saveSoundEditor(page: Page): Promise<void> {
  // Click the top-right Save button. It enables once a sound has been added.
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  // After save, the editor closes and we return to the upload form.
  // The "Description" label reappears.
  await page.getByText('Description', { exact: true }).first().waitFor({ timeout: 30_000 });
}
