# TikTok Studio Editor — Selector Discovery Runbook

One-time, ~10-minute DevTools session. Produces `config/tiktok-editor-selectors.json`, which is all `overlay.ts` needs to drive the native editor.

## Prerequisites

- The project's Patchright Chrome profile (`./browser-data/`) is already logged into TikTok.
- Any 10-20s .mp4 on disk to use as a test upload.
- Chrome DevTools comfort — you'll use the Elements panel + Console.

## Step 1 — Open the upload page in the real browser

```bash
cd "/Users/MarshallHuff/tiktok schedule"
npm run inspect   # opens Patchright headed at /tiktokstudio/upload
```

(If Patchright refuses to launch, open `https://www.tiktok.com/tiktokstudio/upload` manually in your normal Chrome — the session is the same for DevTools purposes.)

## Step 2 — Attach the test video, open DevTools

Drag-and-drop the test mp4 onto the upload page. Once the preview renders, open DevTools (⌥⌘I).

## Step 3 — Capture each selector

For each field below, use the Inspect tool (⌥⌘C) to click the element, then right-click its node in the Elements panel → `Copy` → `Copy selector`. Prefer a **short, stable** selector — if the auto-generated one has long `div[data-react-id="..."]` chains, try a more resilient alternative like `[data-e2e="..."]`, `button[aria-label="..."]`, or `.named-class` matches.

Paste each selector into a new file `config/tiktok-editor-selectors.json` as you go:

```json
{
  "editorEntryButton": "<selector>",
  "editorModalRoot": "<selector>",
  "cropTool": "<selector>",
  "cropAspect916": "<selector>",
  "cropApply": "<selector>",
  "textTool": "<selector>",
  "textInput": "<selector>",
  "selectedTextClip": "<selector>",
  "timelineRoot": "<selector>",
  "timelineHandle": "<selector>",
  "editorSaveButton": "<selector>"
}
```

### 3.1 `editorEntryButton`

The button or clickable affordance that opens the editor from the upload page. Often appears on hover over the attached video preview, or as a pencil / "Edit video" button.

### 3.2 `editorModalRoot`

Once the editor opens, find its outermost container (often a `div[role="dialog"]` or a modal root with its own class). This is used to wait for editor open/close.

### 3.3 `cropTool`

Inside the editor, the Crop tool in the left or top toolbar.

### 3.4 `cropAspect916`

After clicking Crop, the "9:16" aspect ratio option.

### 3.5 `cropApply`

The Apply / Confirm button that commits the 9:16 crop.

### 3.6 `textTool`

The Text tool in the editor toolbar.

### 3.7 `textInput`

After clicking Text, the input element that receives the overlay text. Could be:
- `<textarea>`
- `<input type="text">`
- A `[contenteditable="true"]` div

Record the exact selector and note the element type in a comment near the JSON.

### 3.8 `selectedTextClip`

The rendered text clip on the timeline (the visual pill/rectangle representing the text you just added). This is what `overlay.ts` reads to verify the clip's span.

**Critical:** Look for a `data-duration` attribute on this element. If it exists, record it — `overlay.ts` prefers that for span verification. If not, note the width-based fallback works off `timelineRoot` having a `data-total-sec` attribute. If NEITHER exists, ping back — we'll update `readOverlaySpanSec` in `overlay.ts` to use whatever TikTok actually exposes.

### 3.9 `timelineRoot`

The outermost timeline container.

### 3.10 `timelineHandle`

The drag handle on the selected text clip's right edge (usually a small vertical bar).

### 3.11 `editorSaveButton`

The Save / Done button that closes the editor and returns to the upload page.

## Step 4 — Optional: discover nice-to-haves

Also record (under `durationInput` and `fitToVideoButton`) if you find either of these — they make Strategy 1 or 3 in `extendOverlayToVideoEnd` work:

- **`durationInput`** — a numeric input on the selected text clip that lets you type a duration in seconds directly. If TikTok's text-properties panel shows a "Duration: X.X s" field, that's it.
- **`fitToVideoButton`** — any "Fit to video" / "Extend to end" / "Set to clip length" button.

If neither exists, leave them out of the JSON — `overlay.ts` falls through to the handle-drag strategy.

## Step 5 — Verify

Run the Phase 1 tests to confirm the JSON loads cleanly:

```bash
TIKTOK_EDITOR_SELECTORS_PATH="$(pwd)/config/tiktok-editor-selectors.json" \
  node -e "import('./dist/lib/overlay.js').then(m => console.log(m.loadSelectors()))"
```

(Or just `npm test` — `loadSelectors` has unit tests that confirm structure.)

## Step 6 — Commit

```bash
git add config/tiktok-editor-selectors.json
git commit -m "feat(config): capture TikTok editor selectors"
```

Do NOT commit the example file changes.

## Step 7 — First live post

With selectors in place, run:

```bash
npm run post -- --dry-run
```

If overlay.ts throws on any selector, the error message will identify which one. Patch the JSON and retry.
