# B-roll + Native TikTok Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the AI-slideshow generation + ffmpeg-sanitize pipeline with rent-roll-slides B-roll mode (stream-copied Mixkit clips) and add TikTok-native video-editor text overlays. Verify end-to-end against a real post.

**Architecture:** Two new isolated modules (`bRoll.ts`, `overlay.ts`) follow the existing `sounds.ts` pattern — one file per fragile subsystem, with parsing/math pure-functions extracted for unit testing. `post.ts` orchestrates. The old `rollSlides.ts` and `sanitizeVideo.ts` code paths stay on disk but are no longer called in the default run. Phase 0 captures live DOM selectors before implementation code is written.

**Tech Stack:** TypeScript (NodeNext), Patchright, node:test, tsc. No new runtime dependencies.

**Spec reference:** [docs/superpowers/specs/2026-04-21-broll-native-overlay-design.md](../specs/2026-04-21-broll-native-overlay-design.md)

**Known constraints:**
- Headed browser launches fail from Claude's bash subprocess. Real end-to-end verification in Phase 5 runs in the user's terminal.
- TikTok web session cookies only exist in the user's real Chrome profile (not the Playwright MCP browser). Selector discovery in Phase 0 uses the Claude-in-Chrome MCP, which drives the user's actual Chrome.

---

## Phase 0 — Live selector discovery

Output of this phase is a checked-in file `docs/superpowers/specs/2026-04-21-selectors.md` with every concrete selector later tasks depend on. Phase 0 tasks have no TDD cycle — they are live inspection.

### Task 0.1: Create the selectors doc skeleton

**Files:**
- Create: `docs/superpowers/specs/2026-04-21-selectors.md`

- [ ] **Step 1: Write skeleton file**

```markdown
# Phase 0 Selector Discovery

## rent-roll-slides B-roll mode

- Overlay copy/paste box selector: _TBD_
- Caption copy/paste box selector: _TBD_
- Video delivery mechanism (download event / blob URL / data URI): _TBD_
- Save button selector: _TBD_
- Result card structure — where is slug/duration/aspect ratio text: _TBD_

## TikTok Studio video editor

- Edit entry-point selector on upload page: _TBD_
- Editor modal root selector: _TBD_
- Crop tool selector: _TBD_
- Crop 9:16 option selector + Apply: _TBD_
- Text tool selector: _TBD_
- Text input element (type: contenteditable/textarea/input): _TBD_
- Timeline root selector, selected-text-clip selector, drag handle selector(s): _TBD_
- Timeline width in px (measured): _TBD_
- Numeric duration input on selected text clip (exists? selector): _TBD_
- Save / Done selector: _TBD_
- Whether crop re-encodes (inspect network tab): _TBD_
```

- [ ] **Step 2: Commit the skeleton**

```bash
git add docs/superpowers/specs/2026-04-21-selectors.md
git commit -m "docs(selectors): create Phase 0 discovery skeleton"
```

### Task 0.2: Capture rent-roll-slides B-roll output selectors

Live exploration via `mcp__playwright__browser_*`. Cannot be scripted as a test.

- [ ] **Step 1: Navigate to the app in Playwright MCP**

```
mcp__playwright__browser_navigate → https://rent-roll-slides.vercel.app/
mcp__playwright__browser_click → "🎥 B-roll clip" button
mcp__playwright__browser_click → "Generate 1 B-roll clip" button
```

- [ ] **Step 2: Retry generation until overlay is non-empty**

The overlay generator is flaky. Retry up to 5× until the result card lacks the "No overlay generated — model returned empty" warning. Stop and report to user if all 5 fail.

- [ ] **Step 3: Capture DOM for the result card**

```
mcp__playwright__browser_evaluate → "() => document.querySelector('h2')?.closest('div')?.outerHTML"
```

Record in `selectors.md`: the overlay box selector, caption box selector, download mechanism, Save button selector, and the progress-line format strings actually observed.

- [ ] **Step 4: Commit findings**

```bash
git add docs/superpowers/specs/2026-04-21-selectors.md
git commit -m "docs(selectors): capture rent-roll-slides B-roll DOM"
```

### Task 0.3: Capture TikTok Studio editor selectors

Uses the Claude-in-Chrome MCP (logged-in session).

- [ ] **Step 1: Navigate to upload page in user's real Chrome**

```
mcp__Claude_in_Chrome__navigate → https://www.tiktok.com/tiktokstudio/upload
```

Stop here. Ask the user to manually upload a test video (any 10–15s landscape clip). Their login is on their Chrome; extension file_upload returns "Not allowed" (confirmed in brainstorming).

- [ ] **Step 2: After manual upload, capture the Edit entry-point**

Once the video preview renders:

```
mcp__Claude_in_Chrome__read_page → filter "interactive"
```

Find the Edit button/affordance; record selector.

- [ ] **Step 3: Click into the editor and capture its DOM**

```
mcp__Claude_in_Chrome__javascript_tool → "document.querySelector('[class*=editor], [class*=modal]')?.outerHTML?.slice(0, 5000)"
```

Record: modal root, Crop tool, 9:16 option, Apply, Text tool, text input element type, Save button.

- [ ] **Step 4: Add a text overlay and capture timeline DOM**

After a text element is placed, inspect the selected-clip DOM, the timeline container, the handle element(s), and whether there's a numeric duration input. Measure timeline width in px via `getBoundingClientRect().width`.

- [ ] **Step 5: Verify whether Crop is a re-encode**

```
mcp__Claude_in_Chrome__read_network_requests → urlPattern: "upload"
```

If clicking Crop → Apply triggers a new upload, crop re-encodes; log this and reconsider cropping in Phase 3.

- [ ] **Step 6: Commit findings**

```bash
git add docs/superpowers/specs/2026-04-21-selectors.md
git commit -m "docs(selectors): capture TikTok Studio editor DOM"
```

---

## Phase 1 — Types, config, and pure helpers (fully TDD'd)

### Task 1.1: Add `BRollResult` type and `Settings.bRoll` section

**Files:**
- Modify: [src/lib/types.ts](src/lib/types.ts)

- [ ] **Step 1: Read current types.ts**

```
Read → src/lib/types.ts
```

- [ ] **Step 2: Add BRollResult type and bRoll settings**

Append to `types.ts`:

```typescript
export interface BRollResult {
  videoPath: string;
  overlayPath: string;
  overlayText: string;
  captionPath: string;
  caption: string;
  hashtags: string;
  slug: string;
  clipDurationSec: number;
  aspectRatio: string;  // format "WxH" e.g. "3840x2160"
}

export interface BRollSettings {
  category: string;
  minSec: number;
  maxSec: number;
  cropServerSide: boolean;
  generateText: boolean;
  audience: 'Both landlord + investor' | 'Landlord' | 'Investor / wholesaler';
  controversy: 1 | 2 | 3 | 4 | 5;
  pullTrending: boolean;
  overlayRetries: number;
}
```

Add a `bRoll: BRollSettings` field to the existing `Settings` interface.

- [ ] **Step 3: Verify tsc is clean**

```bash
cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit
```

Expected: no errors. If there are errors about missing `bRoll` on `Settings` elsewhere, those are in Task 1.2.

- [ ] **Step 4: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): add BRollResult and Settings.bRoll"
```

### Task 1.2: Add `bRoll` section to `config/settings.json`

**Files:**
- Modify: `config/settings.json`

- [ ] **Step 1: Read current settings.json**

```
Read → config/settings.json
```

- [ ] **Step 2: Add `bRoll` object**

Insert alongside `rollSlides`:

```json
"bRoll": {
  "category": "Any (random)",
  "minSec": 8,
  "maxSec": 13,
  "cropServerSide": false,
  "generateText": true,
  "audience": "Both landlord + investor",
  "controversy": 3,
  "pullTrending": true,
  "overlayRetries": 3
}
```

- [ ] **Step 3: Verify tsc clean (if settings is type-checked)**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run existing tests**

```bash
npm test
```

Expected: all 17 existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts config/settings.json
git commit -m "feat(config): add bRoll settings section"
```

### Task 1.3: Add parsing helpers with unit tests

**Files:**
- Create: `src/lib/bRollParse.ts`
- Create: `test/bRollParse.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/bRollParse.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDurationSec,
  parseAspectRatio,
  parseSlug,
  is916,
} from '../src/lib/bRollParse.js';

test('parseDurationSec extracts seconds from "roof · 8.4s"', () => {
  assert.equal(parseDurationSec('roof · 8.4s'), 8.4);
});

test('parseDurationSec handles multi-word slugs', () => {
  assert.equal(parseDurationSec('buildings · 9.7s · 28.7MB · stream-copy'), 9.7);
});

test('parseDurationSec throws on unparseable input', () => {
  assert.throws(() => parseDurationSec('nope'));
});

test('parseAspectRatio extracts WxH from "3840×2160 h264"', () => {
  assert.equal(parseAspectRatio('stream-copy trim · 3840×2160 h264/no-audio'), '3840x2160');
});

test('parseAspectRatio handles ASCII x separator too', () => {
  assert.equal(parseAspectRatio('1080x1920 h264'), '1080x1920');
});

test('parseSlug extracts slug from result card header', () => {
  assert.equal(parseSlug('roof · 8.4s'), 'roof');
  assert.equal(parseSlug('city-street · 12.3s'), 'city-street');
});

test('is916 true for 1080x1920', () => {
  assert.equal(is916('1080x1920'), true);
});

test('is916 true for any portrait 9:16 ratio within 1% tolerance', () => {
  assert.equal(is916('720x1280'), true);
  assert.equal(is916('540x960'), true);
});

test('is916 false for landscape 16:9', () => {
  assert.equal(is916('1920x1080'), false);
  assert.equal(is916('3840x2160'), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --test-name-pattern="parseDurationSec|parseAspectRatio|parseSlug|is916"
```

Expected: all 9 tests FAIL (module not found).

- [ ] **Step 3: Create the implementation**

Create `src/lib/bRollParse.ts`:

```typescript
/**
 * Parse the duration in seconds from a result-card header like "roof · 8.4s"
 * or "buildings · 9.7s · 28.7MB · stream-copy".
 */
export function parseDurationSec(headerText: string): number {
  const match = headerText.match(/·\s*([\d.]+)s/);
  if (!match) throw new Error(`parseDurationSec: no duration in "${headerText}"`);
  return parseFloat(match[1]!);
}

/**
 * Parse "WxH" from a metadata line containing "3840×2160" or "1080x1920".
 * Accepts both the Unicode multiplication sign (×, U+00D7) and ASCII x.
 */
export function parseAspectRatio(text: string): string {
  const match = text.match(/(\d{3,5})\s*[×x]\s*(\d{3,5})/);
  if (!match) throw new Error(`parseAspectRatio: no WxH in "${text}"`);
  return `${match[1]}x${match[2]}`;
}

/**
 * Extract the slug (first token before " · ") from a result-card header.
 */
export function parseSlug(headerText: string): string {
  const match = headerText.match(/^([a-z0-9-]+)\s*·/i);
  if (!match) throw new Error(`parseSlug: no slug in "${headerText}"`);
  return match[1]!;
}

/**
 * Return true if the aspect ratio "WxH" is within 1% of 9:16 portrait.
 */
export function is916(aspectRatio: string): boolean {
  const [w, h] = aspectRatio.split('x').map(Number);
  if (!w || !h) return false;
  const target = 9 / 16;
  const actual = w / h;
  return Math.abs(actual - target) / target < 0.01;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern="parseDurationSec|parseAspectRatio|parseSlug|is916"
```

Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/bRollParse.ts test/bRollParse.test.ts
git commit -m "feat(bRoll): add parse helpers with tests"
```

### Task 1.4: Add overlay math helpers with unit tests

**Files:**
- Create: `src/lib/overlayMath.ts`
- Create: `test/overlayMath.test.ts`

- [ ] **Step 1: Write failing tests**

Create `test/overlayMath.test.ts`:

```typescript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHandleTargetX, spanFraction } from '../src/lib/overlayMath.js';

test('computeHandleTargetX at 0s returns 0', () => {
  assert.equal(computeHandleTargetX(0, 10, 500), 0);
});

test('computeHandleTargetX at full duration returns full width', () => {
  assert.equal(computeHandleTargetX(10, 10, 500), 500);
});

test('computeHandleTargetX scales linearly', () => {
  assert.equal(computeHandleTargetX(5, 10, 500), 250);
  assert.equal(computeHandleTargetX(2.5, 10, 500), 125);
});

test('computeHandleTargetX clamps above total to full width', () => {
  assert.equal(computeHandleTargetX(15, 10, 500), 500);
});

test('spanFraction returns span / total', () => {
  assert.equal(spanFraction(5, 10), 0.5);
  assert.equal(spanFraction(10, 10), 1.0);
});

test('spanFraction handles tiny spans', () => {
  assert.equal(spanFraction(0.1, 10), 0.01);
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test -- --test-name-pattern="computeHandleTargetX|spanFraction"
```

Expected: 6 tests FAIL (module not found).

- [ ] **Step 3: Create implementation**

Create `src/lib/overlayMath.ts`:

```typescript
/**
 * Compute the x pixel target for dragging a timeline handle to a given duration.
 * Clamps to timelineWidthPx when durationSec > totalSec.
 */
export function computeHandleTargetX(
  durationSec: number,
  totalSec: number,
  timelineWidthPx: number,
): number {
  if (totalSec <= 0) return 0;
  const clamped = Math.min(durationSec, totalSec);
  return (clamped / totalSec) * timelineWidthPx;
}

/**
 * Fraction of the total timeline a given overlay span covers.
 * Used by overlay.ts to verify the drag succeeded (>= 0.9 passes).
 */
export function spanFraction(spanSec: number, totalSec: number): number {
  if (totalSec <= 0) return 0;
  return spanSec / totalSec;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npm test -- --test-name-pattern="computeHandleTargetX|spanFraction"
```

Expected: 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/overlayMath.ts test/overlayMath.test.ts
git commit -m "feat(overlay): add math helpers with tests"
```

---

## Phase 2 — `bRoll.ts` module

This phase depends on selectors captured in Task 0.2. If Phase 0 didn't produce concrete selectors, DO NOT proceed — stop and report to the user. Each task below references `[selectors.md]` for the exact DOM queries to use.

### Task 2.1: Create `bRoll.ts` skeleton + driveForm

**Files:**
- Create: `src/lib/bRoll.ts`

- [ ] **Step 1: Create skeleton with `driveForm`**

```typescript
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'patchright';
import type { Settings, BRollResult } from './types.js';

const URL = 'https://rent-roll-slides.vercel.app/';

export class OverlayGenerationFailed extends Error {
  constructor(attempts: number) {
    super(`Overlay generator returned empty ${attempts}x`);
  }
}

async function driveForm(page: Page, settings: Settings): Promise<void> {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.getByRole('button', { name: '🎥 B-roll clip' }).click();

  const { bRoll } = settings;

  // Category dropdown (first combobox in the B-roll section)
  // Count = 1, min/max sec set via selectors matched by surrounding label
  // "Crop to 9:16" checkbox — ensure matches bRoll.cropServerSide
  // "Generate text" checkbox — ensure matches bRoll.generateText
  // Audience / Controversy / Pull trending set similarly

  // Select "Any (random)" or configured category
  await page.locator('select').nth(0).selectOption(bRoll.category);
  // Count = 1
  await page.locator('select').nth(1).selectOption('1');
  // Min/Max sec
  await page.locator('select').nth(2).selectOption(`${bRoll.minSec}s`);
  await page.locator('select').nth(3).selectOption(`${bRoll.maxSec}s`);

  // Crop server-side
  const cropCheckbox = page.getByRole('checkbox', { name: /Crop to 9:16/i });
  const cropChecked = await cropCheckbox.isChecked();
  if (cropChecked !== bRoll.cropServerSide) await cropCheckbox.click();

  // Generate text
  const textCheckbox = page.getByRole('checkbox', { name: /Generate text/i });
  const textChecked = await textCheckbox.isChecked();
  if (textChecked !== bRoll.generateText) await textCheckbox.click();

  // Audience, Controversy
  await page.locator('select').nth(4).selectOption(bRoll.audience);
  const controversyOption = [
    '1 — safe / teach',
    '2 — sharp, neutral',
    '3 — edgy (default)',
    '4 — bold opinion',
    '5 — spicy (adds disclaimer)',
  ][bRoll.controversy - 1]!;
  await page.locator('select').nth(5).selectOption(controversyOption);

  // Pull trending
  const trendingCheckbox = page.getByRole('checkbox', { name: /Pull trending/i });
  const trendingChecked = await trendingCheckbox.isChecked();
  if (trendingChecked !== bRoll.pullTrending) await trendingCheckbox.click();
}

// Additional helpers added in later tasks

export async function generateBRoll(
  _page: Page,
  _settings: Settings,
  _outDir: string,
): Promise<BRollResult> {
  throw new Error('generateBRoll: not implemented until Task 2.5');
}
```

- [ ] **Step 2: Verify tsc clean**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/bRoll.ts
git commit -m "feat(bRoll): add driveForm skeleton"
```

### Task 2.2: Add `clickGenerateAndWait`

**Files:**
- Modify: `src/lib/bRoll.ts`

- [ ] **Step 1: Add function**

Below `driveForm`:

```typescript
async function clickGenerateAndWait(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Generate \d+ B-roll clip/ }).click();
  // Wait for either the result card (heading "N B-roll clip") or an error banner.
  // Timeout: 120s — the app hits OpenAI + pulls video from Mixkit.
  await page.locator('h2', { hasText: /B-roll clip/ }).waitFor({ state: 'visible', timeout: 120_000 });
}
```

- [ ] **Step 2: Verify tsc clean**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/bRoll.ts
git commit -m "feat(bRoll): add clickGenerateAndWait"
```

### Task 2.3: Add `extractOutputs`

**Files:**
- Modify: `src/lib/bRoll.ts`

Depends on Task 0.2 findings. Replace the placeholder selectors below (`TASK_0_2_*`) with the real ones captured in `selectors.md`.

- [ ] **Step 1: Add function**

```typescript
import { parseDurationSec, parseAspectRatio, parseSlug } from './bRollParse.js';

async function extractOutputs(
  page: Page,
  outDir: string,
): Promise<{
  videoPath: string;
  overlayText: string;
  caption: string;
  hashtags: string;
  slug: string;
  clipDurationSec: number;
  aspectRatio: string;
  overlayEmpty: boolean;
}> {
  // Detect empty-overlay warning
  const empty = await page
    .getByText(/No overlay generated — model returned empty/i)
    .isVisible()
    .catch(() => false);

  // Header like "roof · 8.4s" — selector from Task 0.2 selectors.md
  const headerText = await page
    .locator('TASK_0_2_RESULT_HEADER_SELECTOR')
    .first()
    .textContent() ?? '';
  const metaText = await page
    .locator('TASK_0_2_META_LINE_SELECTOR')
    .first()
    .textContent() ?? '';

  const slug = parseSlug(headerText);
  const clipDurationSec = parseDurationSec(headerText);
  const aspectRatio = parseAspectRatio(metaText);

  const overlayText = empty
    ? ''
    : (await page.locator('TASK_0_2_OVERLAY_BOX_SELECTOR').first().textContent() ?? '').trim();
  const caption = (await page.locator('TASK_0_2_CAPTION_BOX_SELECTOR').first().textContent() ?? '').trim();

  // Hashtags = the trailing "#..." block in the caption
  const hashtagMatch = caption.match(/(#\S+(?:\s+#\S+)*)\s*$/);
  const hashtags = hashtagMatch ? hashtagMatch[1]! : '';

  // Download video via the Save button — selector from Task 0.2
  const ts = Date.now();
  const videoPath = path.join(outDir, `${ts}-${slug}.mp4`);
  await fsp.mkdir(outDir, { recursive: true });

  // Prefer download-event interception (specific approach TBD from Task 0.2 findings).
  // If the Save button triggers a regular download:
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30_000 }),
    page.locator('TASK_0_2_SAVE_BUTTON_SELECTOR').first().click(),
  ]);
  await download.saveAs(videoPath);

  return {
    videoPath,
    overlayText,
    caption,
    hashtags,
    slug,
    clipDurationSec,
    aspectRatio,
    overlayEmpty: empty,
  };
}
```

- [ ] **Step 2: Replace TASK_0_2_* placeholders**

Open `docs/superpowers/specs/2026-04-21-selectors.md`, find each recorded selector, and replace the `TASK_0_2_*` strings in the code above.

- [ ] **Step 3: Verify tsc clean**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/bRoll.ts
git commit -m "feat(bRoll): add extractOutputs"
```

### Task 2.4: Add retry wrapper and main `generateBRoll`

**Files:**
- Modify: `src/lib/bRoll.ts`

- [ ] **Step 1: Add retry wrapper + wire up main function**

Replace the stub `generateBRoll` with:

```typescript
export async function generateBRoll(
  page: Page,
  settings: Settings,
  outDir: string,
): Promise<BRollResult> {
  await driveForm(page, settings);

  let lastAttempt = 0;
  const maxAttempts = Math.max(1, settings.bRoll.overlayRetries);

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    lastAttempt = attempt;
    if (attempt === 1) {
      await clickGenerateAndWait(page);
    } else {
      // Re-click Generate without leaving the page
      await page.getByRole('button', { name: /Generate \d+ B-roll clip/ }).click();
      await page.locator('h2', { hasText: /B-roll clip/ }).waitFor({ state: 'visible', timeout: 120_000 });
    }

    const out = await extractOutputs(page, outDir);
    if (!out.overlayEmpty && out.overlayText.length > 0) {
      const overlayPath = out.videoPath.replace(/\.mp4$/, '.overlay.txt');
      const captionPath = out.videoPath.replace(/\.mp4$/, '.caption.txt');
      fs.writeFileSync(overlayPath, out.overlayText);
      fs.writeFileSync(captionPath, out.caption);
      return {
        videoPath: out.videoPath,
        overlayPath,
        overlayText: out.overlayText,
        captionPath,
        caption: out.caption,
        hashtags: out.hashtags,
        slug: out.slug,
        clipDurationSec: out.clipDurationSec,
        aspectRatio: out.aspectRatio,
      };
    }
    // Delete the failed video; we don't want orphan MP4s when overlay was empty
    try { fs.unlinkSync(out.videoPath); } catch { /* ignore */ }
  }

  throw new OverlayGenerationFailed(lastAttempt);
}
```

- [ ] **Step 2: Verify tsc clean**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Run existing tests**

```bash
npm test
```

Expected: all pass (no new tests in this task; live behavior verified in Phase 5).

- [ ] **Step 4: Commit**

```bash
git add src/lib/bRoll.ts
git commit -m "feat(bRoll): implement generateBRoll with retry"
```

---

## Phase 3 — `overlay.ts` module

This phase depends on selectors from Task 0.3. Same rule: do not proceed without concrete selectors.

### Task 3.1: Create `overlay.ts` skeleton + `openEditor`

**Files:**
- Create: `src/lib/overlay.ts`

- [ ] **Step 1: Create skeleton**

```typescript
import type { Page } from 'patchright';
import { computeHandleTargetX, spanFraction } from './overlayMath.js';

export class OverlayApplicationFailed extends Error {}

const EDITOR_TIMEOUT_MS = 15_000;

async function openEditor(page: Page): Promise<void> {
  // TASK_0_3_EDIT_BUTTON_SELECTOR — replace from selectors.md
  await page.locator('TASK_0_3_EDIT_BUTTON_SELECTOR').click();
  await page
    .locator('TASK_0_3_EDITOR_MODAL_ROOT_SELECTOR')
    .waitFor({ state: 'visible', timeout: EDITOR_TIMEOUT_MS });
}

export async function applyCropAndOverlay(
  _page: Page,
  _opts: { overlayText: string; videoDurationSec: number; needsCrop: boolean },
): Promise<void> {
  throw new Error('applyCropAndOverlay: not implemented until Task 3.6');
}
```

- [ ] **Step 2: Replace selector placeholders with selectors.md findings**

- [ ] **Step 3: Verify tsc clean**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add src/lib/overlay.ts
git commit -m "feat(overlay): skeleton + openEditor"
```

### Task 3.2: Add `cropTo916`

**Files:**
- Modify: `src/lib/overlay.ts`

- [ ] **Step 1: Add function**

```typescript
async function cropTo916(page: Page): Promise<void> {
  // TASK_0_3_CROP_TOOL_SELECTOR / ASPECT_9_16 / CROP_APPLY — from selectors.md
  await page.locator('TASK_0_3_CROP_TOOL_SELECTOR').click();
  await page.locator('TASK_0_3_ASPECT_9_16_SELECTOR').click();
  await page.locator('TASK_0_3_CROP_APPLY_SELECTOR').click();
  // Wait for crop UI to close
  await page
    .locator('TASK_0_3_ASPECT_9_16_SELECTOR')
    .waitFor({ state: 'hidden', timeout: EDITOR_TIMEOUT_MS });
}
```

- [ ] **Step 2: Replace selectors**

- [ ] **Step 3: Verify tsc clean + commit**

```bash
npx tsc --noEmit
git add src/lib/overlay.ts
git commit -m "feat(overlay): add cropTo916"
```

### Task 3.3: Add `addTextOverlay`

**Files:**
- Modify: `src/lib/overlay.ts`

- [ ] **Step 1: Add function**

```typescript
async function addTextOverlay(page: Page, text: string): Promise<void> {
  // TASK_0_3_TEXT_TOOL_SELECTOR, TASK_0_3_TEXT_INPUT_SELECTOR — from selectors.md
  await page.locator('TASK_0_3_TEXT_TOOL_SELECTOR').click();
  const input = page.locator('TASK_0_3_TEXT_INPUT_SELECTOR');
  await input.waitFor({ state: 'visible', timeout: EDITOR_TIMEOUT_MS });
  await input.click();

  // Prefer execCommand insertText (single event). Fall back to char-by-char type.
  const inserted = await page.evaluate((t: string) => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return false;
    if (typeof (el as HTMLInputElement).value === 'string') {
      (el as HTMLInputElement).value = t;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }
    // contenteditable
    return document.execCommand('insertText', false, t);
  }, text);

  if (!inserted) {
    await page.keyboard.type(text, { delay: 15 });
  }
}
```

- [ ] **Step 2: Replace selectors + verify + commit**

```bash
npx tsc --noEmit
git add src/lib/overlay.ts
git commit -m "feat(overlay): add addTextOverlay"
```

### Task 3.4: Add `extendOverlayToVideoEnd` with strategy ladder

**Files:**
- Modify: `src/lib/overlay.ts`

- [ ] **Step 1: Add function**

```typescript
async function extendOverlayToVideoEnd(
  page: Page,
  videoDurationSec: number,
): Promise<void> {
  // Strategy 1: numeric duration input (from selectors.md, if discovered)
  const durationInputSel = 'TASK_0_3_DURATION_INPUT_SELECTOR'; // or empty if not found
  if (durationInputSel && durationInputSel !== 'TASK_0_3_DURATION_INPUT_SELECTOR') {
    const di = page.locator(durationInputSel);
    if (await di.count() > 0) {
      await di.fill(String(videoDurationSec));
      await page.keyboard.press('Enter');
      await verifySpan(page, videoDurationSec);
      return;
    }
  }

  // Strategy 2: drag the handle
  const handleSel = 'TASK_0_3_TIMELINE_HANDLE_SELECTOR';
  const timelineSel = 'TASK_0_3_TIMELINE_ROOT_SELECTOR';
  const handle = page.locator(handleSel).first();
  const timeline = page.locator(timelineSel).first();
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
    await page.mouse.move(targetX, startY, { steps: 20 });
    await page.mouse.up();
    await verifySpan(page, videoDurationSec);
    return;
  }

  // Strategy 3: "fit to video" affordance (from selectors.md, if discovered)
  const fitSel = 'TASK_0_3_FIT_TO_VIDEO_SELECTOR';
  if (fitSel && fitSel !== 'TASK_0_3_FIT_TO_VIDEO_SELECTOR') {
    const fit = page.locator(fitSel);
    if (await fit.count() > 0) {
      await fit.click();
      await verifySpan(page, videoDurationSec);
      return;
    }
  }

  throw new OverlayApplicationFailed('all 3 strategies for extending overlay failed');
}

async function verifySpan(page: Page, videoDurationSec: number): Promise<void> {
  // Re-read the selected text clip's rendered span. Selector from selectors.md.
  const actualSec = await page.evaluate((sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return 0;
    // Convention: data attribute OR computed width / px-per-sec
    const dur = el.getAttribute('data-duration');
    if (dur) return parseFloat(dur);
    return 0;
  }, 'TASK_0_3_SELECTED_TEXT_CLIP_SELECTOR');

  const frac = spanFraction(actualSec, videoDurationSec);
  if (frac < 0.9) {
    throw new OverlayApplicationFailed(
      `overlay span ${actualSec.toFixed(2)}s is only ${(frac * 100).toFixed(0)}% of video`,
    );
  }
}
```

- [ ] **Step 2: Replace selectors + verify + commit**

```bash
npx tsc --noEmit
git add src/lib/overlay.ts
git commit -m "feat(overlay): add extendOverlayToVideoEnd strategy ladder"
```

### Task 3.5: Add `saveEditor` and wire up `applyCropAndOverlay`

**Files:**
- Modify: `src/lib/overlay.ts`

- [ ] **Step 1: Add `saveEditor` + main function**

```typescript
async function saveEditor(page: Page): Promise<void> {
  await page.locator('TASK_0_3_SAVE_BUTTON_SELECTOR').click();
  await page
    .locator('TASK_0_3_EDITOR_MODAL_ROOT_SELECTOR')
    .waitFor({ state: 'hidden', timeout: EDITOR_TIMEOUT_MS });
}

export async function applyCropAndOverlay(
  page: Page,
  opts: { overlayText: string; videoDurationSec: number; needsCrop: boolean },
): Promise<void> {
  await openEditor(page);

  if (opts.needsCrop) {
    try {
      await cropTo916(page);
    } catch (err) {
      // Tolerable: log and continue without crop
      console.warn('[overlay] cropTo916 failed, continuing without crop:', err);
    }
  }

  await addTextOverlay(page, opts.overlayText);
  await extendOverlayToVideoEnd(page, opts.videoDurationSec);
  await saveEditor(page);
}
```

- [ ] **Step 2: Replace selectors + verify + commit**

```bash
npx tsc --noEmit
git add src/lib/overlay.ts
git commit -m "feat(overlay): implement applyCropAndOverlay"
```

---

## Phase 4 — `post.ts` integration

### Task 4.1: Wire `generateBRoll` + `applyCropAndOverlay` into `post.ts`

**Files:**
- Modify: [src/post.ts](src/post.ts)

- [ ] **Step 1: Read current post.ts**

```
Read → src/post.ts
```

- [ ] **Step 2: Replace generate + sanitize section**

Find the block that calls `generateVideo(page, topic, settings, outDir)` + `sanitizeVideo(...)`. Replace with:

```typescript
import { generateBRoll, OverlayGenerationFailed } from './lib/bRoll.js';
import { applyCropAndOverlay } from './lib/overlay.js';
import { is916 } from './lib/bRollParse.js';

// ... inside postOnce() ...

const b = await generateBRoll(page, settings, downloadsDir);
// NOTE: no sanitize — B-roll is stream-copied authentic footage
console.log(`[bRoll] ${b.slug} · ${b.clipDurationSec}s · ${b.aspectRatio}`);

await openUploadPage(page);
await sleep(rand(800, 2000));
await attachVideo(page, b.videoPath);
await sleep(rand(800, 2000));

await applyCropAndOverlay(page, {
  overlayText: b.overlayText,
  videoDurationSec: b.clipDurationSec,
  needsCrop: !is916(b.aspectRatio),
});
await sleep(rand(800, 2000));

await setCaption(page, b.caption);
await sleep(rand(500, 1500));
await setRandomLocationChip(page);
await sleep(rand(500, 1500));
await pickRandomFavoriteSound(page);
await sleep(rand(1000, 2500));

await clickPost(page);
await waitForPostSuccess(page);
```

Also remove the old `topic` loading from `topics.txt` if it's no longer used (B-roll picks random clips; a topic/angle is optional). If `config/topics.txt` is still referenced, change the call to pass `settings` only — not topic.

- [ ] **Step 3: Handle `OverlayGenerationFailed` in main loop**

In the catch block around `postOnce`, add:

```typescript
if (err instanceof OverlayGenerationFailed) {
  logRun({ status: 'failure', reason: 'overlay_generation_failed', ... });
  // Do not retry this slot; launchd will fire the next one
  process.exit(0);
}
```

- [ ] **Step 4: Verify tsc clean**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run tests**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/post.ts
git commit -m "feat(post): switch to B-roll + native overlay pipeline"
```

---

## Phase 5 — End-to-end verification

Verification happens in the user's terminal because headed browsers fail to launch from the Claude bash subprocess.

### Task 5.1: Dry-run

- [ ] **Step 1: Ask user to run**

```bash
cd "/Users/MarshallHuff/tiktok schedule" && npm run post -- --dry-run 2>&1 | tee /tmp/broll-dryrun.log
```

- [ ] **Step 2: Read the log**

```
Read → /tmp/broll-dryrun.log
```

Expected line patterns:
- `[bRoll] <slug> · <N.N>s · <WxH>`
- No ffmpeg invocation
- Caption + overlay files written to `downloads/`
- Stops before `clickPost` due to `--dry-run`

- [ ] **Step 3: If failures, fix them before Task 5.2**

### Task 5.2: Single real post

- [ ] **Step 1: Ask user to run**

```bash
cd "/Users/MarshallHuff/tiktok schedule" && npm run post 2>&1 | tee /tmp/broll-live.log
```

- [ ] **Step 2: Read the log + `logs/runs.jsonl` tail**

```
Read → /tmp/broll-live.log
Bash → tail -1 logs/runs.jsonl | python3 -m json.tool
```

- [ ] **Step 3: Ask user to verify on tiktok.com**

Check in this order:
1. Posts tab at https://www.tiktok.com/@rentroll.us
2. Drafts tab at https://www.tiktok.com/tiktokstudio/content/drafts
3. Under Review area if present

Record where the post landed in the final checklist comment.

- [ ] **Step 4: If the post appears publicly (or in Drafts but visually correct), the plan is PROVEN**

Mark this plan as done. Phantom-success debugging continues in a separate follow-up spec.

- [ ] **Step 5: If the post vanished**

That's the phantom-success bug from the prior session and is out of scope for this plan. File a separate follow-up task with:
- Full log contents
- Network request dump from the final 30 seconds of the run
- Screenshot of the Drafts / Scheduled tabs

Do NOT attempt fixes inside this plan.

### Task 5.3: Run test suite end-to-end

- [ ] **Step 1: Run the full test suite**

```bash
cd "/Users/MarshallHuff/tiktok schedule" && npm test
```

Expected: all tests pass. This should include:
- The 17 pre-existing tests
- 9 new `bRollParse` tests from Task 1.3
- 6 new `overlayMath` tests from Task 1.4

- [ ] **Step 2: Commit any final cleanups**

If any residual changes exist (formatting, unused-import removal), commit them.

---

## Self-Review

- **Spec coverage:** Every spec section maps to a task.
  - Flow → Task 4.1 (post.ts integration)
  - Sanitize contraindication → documented; post.ts no longer calls sanitizeVideo
  - bRoll.ts → Tasks 2.1-2.4
  - overlay.ts → Tasks 3.1-3.5
  - Types/config → Tasks 1.1-1.2
  - Tests → Tasks 1.3-1.4
  - Humanization → all preserved by Task 4.1 keeping existing call sites
  - Phase 0 selector discovery → Tasks 0.1-0.3

- **Placeholder scan:** The `TASK_0_2_*` and `TASK_0_3_*` strings are intentional — they mark selector insertion points that cannot be filled in without live exploration. Every such task has an explicit "replace placeholders with selectors.md findings" step. These are the only allowed placeholders.

- **Type consistency:** `BRollResult` shape identical between Task 1.1 (type def), Task 2.4 (return value), and Task 4.1 (consumer). `applyCropAndOverlay` args identical across Task 3.1 stub, Task 3.5 implementation, and Task 4.1 caller.
