// src/lib/overlay.ts
//
// Drives TikTok Studio's in-browser video editor to add a single text
// overlay spanning the full video duration. No crop step: TikTok's web
// editor exposes no crop tool, and local re-encoding would strip the
// authentic camera fingerprint we care about. bRoll.ts filters for 9:16
// at the source instead.
//
// This is the most fragile code in the project. TikTok's editor DOM is
// undocumented and may change at any time. We follow these defensive
// patterns:
//
// - Every step has an explicit timeout (no open-ended waits).
// - Every post-interaction state change is verified by re-reading the DOM.
// - Failures in non-critical steps (crop) are logged and swallowed; the
//   overlay step itself must succeed or the whole run aborts.
//
// Selectors live in `config/tiktok-editor-selectors.json` and are loaded
// once per run. If that file is missing, applyCropAndOverlay throws a
// clear error pointing at the runbook. See:
//   docs/superpowers/specs/2026-04-21-editor-selector-runbook.md
//
// That runbook is written for a single manual inspection session via the
// browser's DevTools — 10-15 minutes to capture every selector in one go.

import fs from 'node:fs';
import path from 'node:path';
import type { Page } from 'patchright';
import { computeHandleTargetX, spanFraction } from './overlayMath.js';

export class OverlayApplicationFailed extends Error {
  constructor(msg: string) { super(`applyCropAndOverlay: ${msg}`); this.name = 'OverlayApplicationFailed'; }
}

export class SelectorsNotConfigured extends Error {
  constructor(missing: string) {
    super(`TikTok editor selectors not configured (missing: ${missing}). ` +
          `See docs/superpowers/specs/2026-04-21-editor-selector-runbook.md`);
    this.name = 'SelectorsNotConfigured';
  }
}

export interface EditorSelectors {
  /** Button / affordance that opens the editor from the upload page */
  editorEntryButton: string;
  /** Root element of the editor modal — used to wait for open/close */
  editorModalRoot: string;

  /** Text tool button inside the editor */
  textTool: string;
  /** The text input that receives the overlay text */
  textInput: string;
  /** The selected text clip's rendered element — used to verify span */
  selectedTextClip: string;

  /** Root of the timeline where handle drags happen */
  timelineRoot: string;
  /** The drag handle(s) for extending the selected clip's duration */
  timelineHandle: string;

  /** Optional: a numeric duration input that sets the clip's span directly */
  durationInput?: string;
  /** Optional: a "fit to video" / "extend to full" affordance */
  fitToVideoButton?: string;

  /** Save / Done button that closes the editor and returns to the upload page */
  editorSaveButton: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const SELECTORS_PATH_ENV = 'TIKTOK_EDITOR_SELECTORS_PATH';

function resolveSelectorsPath(): string {
  const envPath = process.env[SELECTORS_PATH_ENV];
  if (envPath) return envPath;
  return path.join(process.cwd(), 'config', 'tiktok-editor-selectors.json');
}

/**
 * Load selectors from disk. Throws SelectorsNotConfigured if the file is
 * missing or any required field is absent.
 *
 * Exported for unit testing.
 */
export function loadSelectors(filePath: string = resolveSelectorsPath()): EditorSelectors {
  if (!fs.existsSync(filePath)) {
    throw new SelectorsNotConfigured(`config file not found at ${filePath}`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  let parsed: Partial<EditorSelectors>;
  try { parsed = JSON.parse(raw); }
  catch { throw new SelectorsNotConfigured(`config file is not valid JSON: ${filePath}`); }

  const required: (keyof EditorSelectors)[] = [
    'editorEntryButton', 'editorModalRoot',
    'textTool', 'textInput', 'selectedTextClip',
    'timelineRoot', 'timelineHandle',
    'editorSaveButton',
  ];
  for (const k of required) {
    if (!parsed[k] || typeof parsed[k] !== 'string') {
      throw new SelectorsNotConfigured(k);
    }
  }
  return parsed as EditorSelectors;
}

async function openEditor(page: Page, s: EditorSelectors): Promise<void> {
  await page.locator(s.editorEntryButton).first().click({ force: true, timeout: 5000 });
  await page.locator(s.editorModalRoot).waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
  // Let the editor finish its mount animation + dismiss any first-run editor
  // tour ("New features", "Got it", etc.) that might cover toolbar buttons.
  await page.waitForTimeout(1200);
  const popupLabels = ['Got it', 'Skip', 'Close', 'Dismiss', 'No thanks', 'Not now', 'Maybe later'];
  for (const name of popupLabels) {
    try { await page.getByRole('button', { name, exact: true }).first().click({ timeout: 800 }); } catch { /* no popup */ }
  }
  await page.keyboard.press('Escape').catch(() => {});
}

async function addTextOverlay(page: Page, s: EditorSelectors, text: string): Promise<void> {
  // Click the Text tool → opens AddTextPresetPanel. Use force:true because
  // TikTok's Sidebar component can pass Playwright's "attached" check while
  // React hasn't attached the click handler yet — the normal click then
  // times out waiting for actionability. force:true fires the event directly.
  await page.locator(s.textTool).first().click({ force: true, timeout: 5000 });
  await page.waitForTimeout(800);

  // Click the first preset to add a text clip to the timeline. TikTok's
  // preset panel doesn't expose a single stable selector, so we try a
  // few heuristics. Any of them adding a text clip is enough.
  const presetTried: string[] = [];
  const presetCandidates = [
    '[class*="AddTextPreset"] [class*="item"]',
    '[class*="AddTextPreset"] button',
    '[class*="TextPreset"] [class*="item"]',
    '[class*="Preset"] button',
    '[class*="Preset"] [role="button"]',
  ];
  let presetClicked = false;
  for (const sel of presetCandidates) {
    presetTried.push(sel);
    try {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0) > 0) {
        await loc.click({ timeout: 2000 });
        presetClicked = true;
        break;
      }
    } catch { /* try next */ }
  }
  if (!presetClicked) {
    throw new OverlayApplicationFailed(`no text preset matched any of: ${presetTried.join(', ')}`);
  }

  // Text input / contenteditable should now be focused
  const input = page.locator(s.textInput).first();
  await input.waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
  await input.click();

  // Prefer execCommand('insertText') — single event, works for both <input>
  // and contenteditable. Fall back to char-by-char type if that fails.
  const inserted = await page.evaluate((t: string) => {
    const el = document.activeElement as HTMLElement | HTMLInputElement | null;
    if (!el) return false;
    if ('value' in el && typeof (el as HTMLInputElement).value === 'string') {
      (el as HTMLInputElement).value = t;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    return document.execCommand('insertText', false, t);
  }, text);

  if (!inserted) {
    await page.keyboard.type(text, { delay: 15 });
  }
}

/**
 * Read the selected text clip's rendered duration (in seconds) from the
 * DOM. Looks for a data-duration attribute first; then a computed width
 * divided by a computed px-per-sec; falls back to 0 if neither are found.
 *
 * If your editor uses a different attribute for duration, update the
 * extraction logic here — it's the single point of span verification.
 */
async function readOverlaySpanSec(page: Page, s: EditorSelectors): Promise<number> {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return 0;
    const dur = el.getAttribute('data-duration');
    if (dur) {
      const n = parseFloat(dur);
      return Number.isFinite(n) ? n : 0;
    }
    // Heuristic fallback: if there's a data-total-sec on the timeline root,
    // use that + the clip's width / timeline width.
    const timeline = el.closest('[data-total-sec]') as HTMLElement | null;
    if (timeline) {
      const total = parseFloat(timeline.getAttribute('data-total-sec') || '0');
      const clipW = el.getBoundingClientRect().width;
      const tlW = timeline.getBoundingClientRect().width;
      if (total > 0 && tlW > 0) return total * (clipW / tlW);
    }
    return 0;
  }, s.selectedTextClip);
}

async function verifySpan(
  page: Page, s: EditorSelectors, videoDurationSec: number,
): Promise<void> {
  const actual = await readOverlaySpanSec(page, s);
  const frac = spanFraction(actual, videoDurationSec);
  if (frac < 0.9) {
    throw new OverlayApplicationFailed(
      `overlay span ${actual.toFixed(2)}s is only ${(frac * 100).toFixed(0)}% of ${videoDurationSec.toFixed(2)}s video`,
    );
  }
}

async function extendOverlayToVideoEnd(
  page: Page, s: EditorSelectors, videoDurationSec: number,
): Promise<void> {
  // Strategy 1: numeric duration input (simplest and most reliable if present)
  if (s.durationInput) {
    const di = page.locator(s.durationInput);
    if (await di.count().catch(() => 0) > 0) {
      await di.fill(String(Math.round(videoDurationSec * 10) / 10));
      await page.keyboard.press('Enter');
      await verifySpan(page, s, videoDurationSec);
      return;
    }
  }

  // Strategy 2: drag the timeline handle
  const handle = page.locator(s.timelineHandle).first();
  const timeline = page.locator(s.timelineRoot).first();
  const timelineBox = await timeline.boundingBox();
  const handleBox = await handle.boundingBox();
  if (timelineBox && handleBox) {
    const targetX = timelineBox.x + computeHandleTargetX(
      videoDurationSec, videoDurationSec, timelineBox.width,
    );
    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Multi-step move so TikTok's drag listeners receive intermediate events
    await page.mouse.move(targetX, startY, { steps: 20 });
    await page.mouse.up();
    await verifySpan(page, s, videoDurationSec);
    return;
  }

  // Strategy 3: fit-to-video affordance
  if (s.fitToVideoButton) {
    const fit = page.locator(s.fitToVideoButton);
    if (await fit.count().catch(() => 0) > 0) {
      await fit.click();
      await verifySpan(page, s, videoDurationSec);
      return;
    }
  }

  throw new OverlayApplicationFailed('all 3 strategies for extending overlay failed');
}

async function saveEditor(page: Page, s: EditorSelectors): Promise<void> {
  await page.locator(s.editorSaveButton).click();
  await page.locator(s.editorModalRoot).waitFor({ state: 'hidden', timeout: DEFAULT_TIMEOUT_MS });
}

/**
 * Main export. Assumes a 9:16 video has already been attached via the
 * upload page's file input (bRoll.ts enforces portrait). Opens the
 * editor, adds a single text overlay spanning the full video, saves
 * and closes the editor.
 */
export async function applyOverlay(
  page: Page,
  opts: { overlayText: string; videoDurationSec: number },
): Promise<void> {
  const s = loadSelectors();

  const dumpOnFailure = async (tag: string, err: Error): Promise<Error> => {
    try {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const dir = '/tmp/tiktok-overlay-failures';
      fs.mkdirSync(dir, { recursive: true });
      const ts = Date.now();
      await page.screenshot({ path: path.join(dir, `${ts}-${tag}.png`), fullPage: true });
      const html = await page.content();
      fs.writeFileSync(path.join(dir, `${ts}-${tag}.html`), html);
      console.error(`[overlay] ${tag} failed; dumped to ${dir}/${ts}-${tag}.{png,html}`);
    } catch { /* best-effort */ }
    return err;
  };

  try { await openEditor(page, s); }
  catch (e) { throw await dumpOnFailure('openEditor', e as Error); }

  try { await addTextOverlay(page, s, opts.overlayText); }
  catch (e) { throw await dumpOnFailure('addTextOverlay', e as Error); }

  try { await extendOverlayToVideoEnd(page, s, opts.videoDurationSec); }
  catch (e) { throw await dumpOnFailure('extendOverlayToVideoEnd', e as Error); }

  try { await saveEditor(page, s); }
  catch (e) { throw await dumpOnFailure('saveEditor', e as Error); }
}
