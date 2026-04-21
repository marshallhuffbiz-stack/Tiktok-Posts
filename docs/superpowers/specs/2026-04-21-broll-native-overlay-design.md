# B-roll + Native TikTok Overlay — Design Spec

**Status:** Draft — awaiting user review
**Date:** 2026-04-21
**Supersedes (partially):** `2026-04-16-tiktok-schedule-design.md` — specifically the video-generation and caption/overlay sections.

---

## Motivation

The existing pipeline generates AI slideshow videos with baked-in text overlays via `rent-roll-slides.vercel.app`, sanitizes them through a two-pass ffmpeg pipeline, and uploads to TikTok Studio. Two problems drove this redesign:

1. **Authenticity penalty on re-encoded video.** TikTok's container-forensics signal fingerprints MP4 brand ordering, `moov` position, and encoder tags. Our sanitize pipeline makes synthetic slides *look* iPhone-shot, but applied to an authentic source it replaces real camera metadata with synthetic substitutes.
2. **Template sameness.** Every slide has the same visual structure; perceptual-hash dedup is a known TikTok signal.

The fix is to switch video source to **`rent-roll-slides`'s new "🎥 B-roll clip" mode** — stream-copied Mixkit stock clips with no re-encoding — and put the text content on TikTok's **native video editor** instead of baking it into the image. Caption and overlay are delivered as two separate copy/paste blocks from the generator.

## Non-goals

- The "phantom success" bug (URL changes to `/tiktokstudio/content` but posts never appear on the account) is **not** addressed by this spec. It will be logged and debugged in a follow-up.
- Mobile automation is out of scope.
- Dynamically matching sound to clip content is out of scope; LRU favorites remain.
- Refactoring or removing the old slideshow code path is out of scope. It stays functional but unused by the default entry point.

## End-to-end flow

A `npm run post` run executes:

1. **Generate B-roll** — drive `rent-roll-slides` in "🎥 B-roll clip" mode with configured settings; get video + overlay text + caption text.
2. **Persist outputs** — write raw video (no re-encode), `overlay.txt`, `caption.txt` to `downloads/`.
3. **Skip sanitize.** See "Sanitize is contraindicated" below.
4. **Open TikTok Studio upload page.**
5. **Attach video.**
6. **Apply crop + overlay (new step).** Enter TikTok's native editor, crop to 9:16 if needed, add one text overlay spanning the full clip duration, save editor.
7. **Set caption** (existing Draft.js + hashtag mention-entity commit flow, unchanged).
8. **Pick location chip** (existing, random + "Advance" filter).
9. **Pick sound** (existing, LRU favorites). Load-bearing because clips have no audio.
10. **Click Post and detect success** (existing URL-change detection; phantom-success bug noted, not fixed here).

## Sanitize is contraindicated

The two-pass ffmpeg pipeline in `src/lib/sanitizeVideo.ts` exists to humanize AI-synthesized slideshow MP4s. Applied to a stream-copied Mixkit clip, it **removes** authentic camera metadata and replaces it with synthetic substitutes that can still be fingerprinted. B-roll clips must reach TikTok byte-identical to what the generator produced. There is no alternate ffmpeg flag set that improves this; the right answer is to skip the step entirely.

## Components

### `src/lib/bRoll.ts` (new; replaces `rollSlides.ts` as the default generator)

```ts
export async function generateBRoll(
  page: Page,
  settings: Settings,
  outDir: string,
): Promise<BRollResult>;

export type BRollResult = {
  videoPath: string;
  overlayPath: string;
  overlayText: string;
  captionPath: string;
  caption: string;         // full body + hashtags as will be pasted into TikTok
  hashtags: string;        // tags only, for the hashtag-entity loop in setCaption
  slug: string;            // e.g. "buildings", used in output filenames
  clipDurationSec: number; // parsed from "buildings · 9.7s"
  aspectRatio: string;     // "3840x2160" — used to decide if crop-to-9:16 is needed
};
```

Internal structure:

- `driveForm(page, settings)` — set category, count=1, min/max sec, leave "Crop to 9:16" off, enable Generate Text, set audience/controversy/pullTrending.
- `clickGenerateAndWait(page)` — click Generate, wait for either the result card or an error state.
- `extractOutputs(page)` — parse slug + duration + aspect ratio from the result card; extract overlay and caption from their two copy/paste blocks; download video via blob URL or download-intercept (TBD in Phase 0).
- `retryOnEmptyOverlay(fn, maxAttempts = 3)` — the overlay generator returns empty intermittently; retry by clicking Generate again without reloading the page. Throws `OverlayGenerationFailed` after final attempt.

`rollSlides.ts` and its helpers are left in place but no longer imported by `post.ts`.

### `src/lib/overlay.ts` (new)

```ts
export async function applyCropAndOverlay(
  page: Page,
  opts: {
    overlayText: string;
    videoDurationSec: number;
    needsCrop: boolean;
  },
): Promise<void>;
```

Responsibilities in order:

1. **`openEditor(page)`** — click the Edit entry on the attached video preview; wait for editor modal root.
2. **`cropTo916(page)`** — if `needsCrop`, click Crop tool → select 9:16 → apply. Skipped if clip is already 9:16.
3. **`addTextOverlay(page, text)`** — click Text tool → focus text input → insert `text` (prefer `execCommand('insertText')`; fallback `keyboard.type` with delay). Accept TikTok default white styling.
4. **`extendOverlayToVideoEnd(page, videoDurationSec)`** — extend the overlay's timeline span to the full clip. Strategy order:
    1. If the editor exposes a numeric duration input for the selected text clip, set it to `videoDurationSec` directly.
    2. Else find the timeline drag handle, compute target x from `(videoDurationSec / totalSec) * timelineWidth`, perform a mouse `down → move → up` drag with `steps: 20`.
    3. Else click a "fit to video" / "extend to end" affordance if present.
    After any strategy succeeds, verify by reading the rendered span back from the DOM; abort if span < 0.9 × `videoDurationSec`.
5. **`saveEditor(page)`** — click Save / Done; wait for editor to close and upload preview to refresh.

Each helper has a 15s default timeout. Failure in crop is tolerable (log warning, proceed). Failure in overlay or duration extension aborts the run — do not post a video with a 3-second overlay on a 10-second clip.

### `src/post.ts` changes

Replace the current generate + sanitize + upload sequence with:

```ts
const b = await generateBRoll(page, settings, downloadsDir);

await openUploadPage(page);
await sleep(rand(800, 2000));
await attachVideo(page, b.videoPath);
await sleep(rand(800, 2000));

const needsCrop = !is916(b.aspectRatio);
await applyCropAndOverlay(page, {
  overlayText: b.overlayText,
  videoDurationSec: b.clipDurationSec,
  needsCrop,
});
await sleep(rand(800, 2000));

await setCaption(page, b.caption);
await sleep(rand(500, 1500));
await setRandomLocationChip(page);
await sleep(rand(500, 1500));
await pickRandomFavoriteSound(page);   // existing
await sleep(rand(1000, 2500));

await clickPost(page);
await waitForPostSuccess(page);
```

Failure modes that log and skip the slot (no Post click):

- `OverlayGenerationFailed` from `generateBRoll`
- Any throw from `applyCropAndOverlay` outside the crop-step-only failure
- Existing failure modes (caption, location, sound) unchanged

### `src/lib/types.ts` additions

```ts
export type BRollResult = { /* see above */ };

export type Settings = {
  bRoll: {
    category: string;           // default "Any (random)"
    minSec: number;             // 8
    maxSec: number;             // 13
    cropServerSide: boolean;    // false — we crop in TikTok
    generateText: boolean;      // true
    audience: 'Both landlord + investor' | 'Landlord' | 'Investor / wholesaler';
    controversy: 1 | 2 | 3 | 4 | 5;
    pullTrending: boolean;      // true
    overlayRetries: number;     // 3
  };
  // rollSlides config left in place, no longer read in default path
  // sanitize config left in place, no longer read in default path
  // rest unchanged
};
```

### `config/settings.json` additions

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

## Testing

- `test/bRoll.test.ts` — parsing helpers only: duration ("buildings · 9.7s"), aspect ratio ("3840×2160"), slug extraction, copy/paste block parsing.
- `test/overlay.test.ts` — pure math: `computeHandleTargetX(durationSec, totalSec, timelineWidthPx)`, span-fraction verifier, `is916(aspectRatio)`.
- Existing 17 tests keep passing. Tests covering dead slide-color helpers are not deleted in this spec; a follow-up can drop them with the unused code.
- No live TikTok integration tests, consistent with current project.

## Humanization inventory (everything preserved)

| Humanization | Module | B-roll change |
|---|---|---|
| Schedule jitter 0-10 min | `post.ts` | unchanged |
| Humanized inter-step sleeps | `post.ts` | extra sleep bracket added around `applyCropAndOverlay` |
| Random location chip + "Advance" filter | `tiktok.ts` | unchanged |
| Hashtag mention-entity commit | `tiktok.ts` | unchanged |
| LRU favorite sound (Cain / Hold On / Stylin' / Low Tide) | `sounds.ts` | unchanged |
| Patchright + real Chrome (`channel: 'chrome'`) | `browser.ts` | unchanged |
| Off-screen headed window (`--window-position=10000,10000`) | `browser.ts` | unchanged |
| `timezoneId: 'America/New_York'` | `browser.ts` | unchanged |
| Dialog auto-accept + popup dismissal | `tiktok.ts` | unchanged |
| Persistent `./browser-data/` profile | `browser.ts` | unchanged |
| Two-pass ffmpeg sanitize | `sanitizeVideo.ts` | **NOT called** in B-roll path |

## Phase 0 — selector / mechanism discovery (before any implementation code)

These need to be captured live via the Chrome MCP on the user's logged-in session. Findings will be appended to this spec.

1. **B-roll page outputs.** After a non-empty overlay generation, record:
    - Selector for the overlay copy/paste box
    - Selector for the caption copy/paste box
    - How the video leaves the page (download event? blob URL? data URI?) and the selector for the Save button
    - The progress-area strings we parse for slug / duration / aspect ratio — confirm format is stable
2. **TikTok Studio editor.** After a real video uploads, record:
    - The Edit entry-point selector (button or video-preview click target)
    - Crop tool selector, 9:16 aspect option, Apply button
    - Text tool selector, text input element (contenteditable? textarea?), default-white confirmation
    - Timeline root element, selected-text-clip element, duration handle(s), timeline width in px
    - Save / Done selector that returns control to the upload page
    - Any numeric duration input on the selected text clip (simplifies step 4a above)

## Risks

- **Editor DOM is undocumented and may change.** The overlay module is the most fragile code in the project. Failure verification (re-reading the span) is essential; silent partial application is the worst case.
- **Overlay generation flakiness.** Observed 2/2 empty responses in exploration. 3-retry loop mitigates but does not eliminate.
- **Clip duration drift.** The clip's rendered duration may differ from the parsed `9.7s` by frame-level fractions. Verifier uses 0.9× tolerance to absorb this.
- **Crop step may remove the authenticity benefit.** If TikTok's crop re-encodes, we lose the whole stream-copy advantage. Phase 0 should inspect whether crop is a metadata-only transform or a re-encode.
- **Phantom-success bug persists.** Posts may continue to "succeed" into the void. Explicitly out of scope for this spec.
