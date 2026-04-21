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
  const btn = page.locator(s.editorEntryButton).first();
  await btn.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => { /* best-effort */ });
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await btn.boundingBox();
  if (!box) throw new OverlayApplicationFailed('editor entry button has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(150);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.locator(s.editorModalRoot).waitFor({ state: 'visible', timeout: DEFAULT_TIMEOUT_MS });
  // Give the editor 2s to fully hydrate its React components before we try
  // clicking toolbar buttons. React's onClick handlers only fire for trusted
  // events targeting elements whose listeners have fully mounted.
  await page.waitForTimeout(2000);
}

async function addTextOverlay(page: Page, s: EditorSelectors, text: string): Promise<void> {
  // Click Text tool. Try a cascade of click methods because TikTok's editor
  // sometimes needs a specific event style.
  const textBtn = page.locator(s.textTool).first();
  await textBtn.waitFor({ state: 'visible', timeout: 10_000 });
  const box = await textBtn.boundingBox();
  if (!box) throw new OverlayApplicationFailed('Text tool has no bounding box');
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Diagnostic: attach a click-listener on the button BEFORE clicking to
  // verify the click events are actually landing there.
  await page.evaluate((sel) => {
    const btn = document.querySelector(sel);
    if (btn) {
      (window as unknown as { __textClickCount: number }).__textClickCount = 0;
      btn.addEventListener('click', () => {
        (window as unknown as { __textClickCount: number }).__textClickCount += 1;
      }, true);
    }
  }, s.textTool);

  // Diagnostic: what element IS at our click coordinates?
  const elementAtPoint = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!el) return 'null';
    return `<${el.tagName.toLowerCase()}> class="${(el.className || '').toString().slice(0, 80)}"`;
  }, { x: cx, y: cy });
  console.log(`[overlay] element at (${cx.toFixed(0)}, ${cy.toFixed(0)}): ${elementAtPoint}`);

  // Click the sidebar Text menu item to open AddTextPanel
  await textBtn.click({ timeout: 5000 });

  // Wait for AddTextPanel__root to appear in DOM (up to 5s).
  const panelOpened = await page.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      await new Promise(r => setTimeout(r, 100));
      const p = document.querySelector('[class*="AddTextPanel__root"]');
      if (p) return { opened: true };
    }
    return { opened: false };
  });
  if (!panelOpened.opened) {
    throw new OverlayApplicationFailed('Text tool click did not open AddTextPanel');
  }
  console.log('[overlay] AddTextPanel opened');

  // Click the "Add text" basic button — this adds a plain text clip to the
  // timeline without applying any preset effect.
  await page.locator('[class*="AddTextPanel__addTextBasicButton"]').first().click({ timeout: 5000 });

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
 * Read the selected text clip's rendered duration in seconds. TikTok's
 * timeline has no data-duration attribute; instead we compute it from the
 * ratio of the text clip's rendered width to the TimeRuler's rendered
 * width (the total-video axis), scaled by the known video duration.
 */
async function readOverlaySpanSec(
  page: Page, s: EditorSelectors, videoDurationSec: number,
): Promise<number> {
  return await page.evaluate(({ sel, videoSec }) => {
    // Find the SELECTED text clip — it has TextClip__root inside a BaseClip
    // that's marked isSelected-true. Otherwise fall back to the last TextClip.
    const selectedBaseClip = document.querySelector(
      '.BaseClip__root--isSelected-true'
    ) as HTMLElement | null;
    const textClipParent = selectedBaseClip
      || document.querySelector(sel) as HTMLElement | null;
    if (!textClipParent) return 0;

    const clipRect = textClipParent.getBoundingClientRect();
    const ruler = document.querySelector('.TimeRuler__root') as HTMLElement | null;
    if (!ruler) return 0;
    const rulerRect = ruler.getBoundingClientRect();
    if (rulerRect.width <= 0) return 0;

    // Fraction of ruler the clip covers, then scale by videoSec.
    return videoSec * (clipRect.width / rulerRect.width);
  }, { sel: s.selectedTextClip, videoSec: videoDurationSec });
}

async function verifySpan(
  page: Page, s: EditorSelectors, videoDurationSec: number,
): Promise<void> {
  const actual = await readOverlaySpanSec(page, s, videoDurationSec);
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
  // Strategy 0: maybe it's already full span. TikTok's "Add text basic" adds
  // a clip that spans the whole timeline by default — no drag needed.
  try {
    const existingSpan = await readOverlaySpanSec(page, s, videoDurationSec);
    if (spanFraction(existingSpan, videoDurationSec) >= 0.9) {
      console.log(`[overlay] text clip already full-span (${existingSpan.toFixed(1)}s of ${videoDurationSec.toFixed(1)}s)`);
      return;
    }
  } catch { /* fall through to active strategies */ }

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
