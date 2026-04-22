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

  // TikTok's "Add text basic" seeds the contenteditable with a default
  // placeholder (usually the word "Text"). Select-all + delete first so
  // our content REPLACES it instead of appending.
  await page.keyboard.press('ControlOrMeta+a');
  await page.waitForTimeout(50);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(50);

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
 * Read the selected text clip's rendered duration in seconds.
 *
 * The TimeRuler stretches to match the LONGEST clip on any track, so it's
 * not a reliable seconds-per-pixel reference when the text clip is longer
 * than the video. Instead we calibrate from the VIDEO clip itself: we know
 * its duration (passed in) and its rendered width, so px-per-sec is
 * videoClipWidth / videoDurationSec. Then text-clip-duration =
 * textClipWidth / px-per-sec.
 */
async function readOverlaySpanSec(
  page: Page, s: EditorSelectors, videoDurationSec: number,
): Promise<number> {
  return await page.evaluate(({ sel, videoSec }) => {
    // Find the selected text clip
    const textClipNode = document.querySelector(sel) as HTMLElement | null;
    if (!textClipNode) return 0;
    const textBaseClip = (textClipNode.closest('[data-mov-timeline-el-type="clip"]')
      || textClipNode) as HTMLElement;
    const textRect = textBaseClip.getBoundingClientRect();

    // Find the video clip — the BaseClip element that does NOT contain a TextClip
    const allClips = Array.from(document.querySelectorAll('[data-mov-timeline-el-type="clip"]')) as HTMLElement[];
    const videoClip = allClips.find(c => !c.querySelector('.TextClip__root'));
    if (!videoClip) return 0;
    const videoRect = videoClip.getBoundingClientRect();
    if (videoRect.width <= 0 || videoSec <= 0) return 0;
    const pxPerSec = videoRect.width / videoSec;
    return textRect.width / pxPerSec;
  }, { sel: s.selectedTextClip, videoSec: videoDurationSec });
}

/**
 * Get the X coordinates needed to drag the text clip's right trim handle
 * so the clip aligns to the video clip's right edge.
 */
async function getDragTargets(page: Page, s: EditorSelectors): Promise<{
  handleStartX: number; handleY: number; handleStartY: number;
  videoClipRight: number; textClipRight: number;
} | null> {
  return await page.evaluate((sel) => {
    const textClipNode = document.querySelector(sel) as HTMLElement | null;
    if (!textClipNode) return null;
    const textBaseClip = (textClipNode.closest('[data-mov-timeline-el-type="clip"]')
      || textClipNode) as HTMLElement;
    const textRect = textBaseClip.getBoundingClientRect();

    const allClips = Array.from(document.querySelectorAll('[data-mov-timeline-el-type="clip"]')) as HTMLElement[];
    const videoClip = allClips.find(c => !c.querySelector('.TextClip__root'));
    if (!videoClip) return null;
    const videoRect = videoClip.getBoundingClientRect();

    // Find the right trim handle — the actual draggable element
    const rightHandle = textBaseClip.querySelector(
      '.BaseClip__rightTrimHandler, [class*="rightTrimHandler"]'
    ) as HTMLElement | null;
    let handleX: number; let handleY: number;
    if (rightHandle) {
      const hr = rightHandle.getBoundingClientRect();
      handleX = hr.left + hr.width / 2;
      handleY = hr.top + hr.height / 2;
    } else {
      // Fallback: drag from the visual right edge of the text clip
      handleX = textRect.right - 2;
      handleY = textRect.top + textRect.height / 2;
    }
    return {
      handleStartX: handleX,
      handleY,
      handleStartY: handleY,
      videoClipRight: videoRect.right,
      textClipRight: textRect.right,
    };
  }, s.selectedTextClip);
}

async function verifySpan(
  page: Page, s: EditorSelectors, videoDurationSec: number,
): Promise<void> {
  const actual = await readOverlaySpanSec(page, s, videoDurationSec);
  const frac = spanFraction(actual, videoDurationSec);
  // Accept anything between 90% and 110% of video duration
  if (frac < 0.9 || frac > 1.1) {
    throw new OverlayApplicationFailed(
      `overlay span ${actual.toFixed(2)}s is ${(frac * 100).toFixed(0)}% of ${videoDurationSec.toFixed(2)}s video (need 90-110%)`,
    );
  }
  console.log(`[overlay] span verified: ${actual.toFixed(1)}s (${(frac * 100).toFixed(0)}% of video)`);
}

async function extendOverlayToVideoEnd(
  page: Page, s: EditorSelectors, videoDurationSec: number,
): Promise<void> {
  // Already correct? Skip.
  try {
    const existing = await readOverlaySpanSec(page, s, videoDurationSec);
    const frac = spanFraction(existing, videoDurationSec);
    if (frac >= 0.9 && frac <= 1.1) {
      console.log(`[overlay] text clip already matches video (${existing.toFixed(1)}s ≈ ${videoDurationSec.toFixed(1)}s)`);
      return;
    }
    console.log(`[overlay] text clip is ${existing.toFixed(1)}s, video is ${videoDurationSec.toFixed(1)}s — dragging right handle`);
  } catch { /* fall through */ }

  // Drag the right trim handle so the text clip's right edge aligns with
  // the video clip's right edge. We compute both X coordinates from the
  // live DOM and drag in incremental steps to give TikTok's drag listener
  // a chance to honor every intermediate position (otherwise the handle
  // can "snap back" if we move too fast).
  const targets = await getDragTargets(page, s);
  if (!targets) throw new OverlayApplicationFailed('could not locate text clip + video clip for drag');
  const deltaX = targets.videoClipRight - targets.textClipRight;
  const targetHandleX = targets.handleStartX + deltaX;

  await page.mouse.move(targets.handleStartX, targets.handleStartY);
  await page.waitForTimeout(120);
  await page.mouse.down();
  // Multi-step move (drag): increase steps for longer drags
  const distance = Math.abs(deltaX);
  const steps = Math.max(20, Math.round(distance / 10));
  await page.mouse.move(targetHandleX, targets.handleY, { steps });
  await page.waitForTimeout(80);
  await page.mouse.up();
  await page.waitForTimeout(400);

  // Verify span is now within tolerance of video duration
  await verifySpan(page, s, videoDurationSec);
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
