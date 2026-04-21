# Phase 0 Selector Discovery

Captured live via Playwright MCP (rent-roll-slides) and Claude-in-Chrome (TikTok Studio). Every selector below is load-bearing for Phase 2/3 code.

## rent-roll-slides B-roll mode — JSON API (preferred over DOM parsing)

**Discovery:** the app exposes a clean JSON API. Skip DOM parsing entirely and call the API directly from Node.

**Endpoint:** `POST https://rent-roll-slides.vercel.app/api/broll`

**Request body (JSON):**

```json
{
  "minDurationSec": 8,
  "maxDurationSec": 13,
  "audience": "both" | "landlord" | "investor",
  "controversyLevel": 1 | 2 | 3 | 4 | 5,
  "topic": "optional topic string",
  "useTrends": true,
  "generateHook": true,
  "cropTo916": false,
  "recentHooks": []
}
```

**Response body (verified live):**

```json
{
  "success": true,
  "mp4DataUrl": "data:video/mp4;base64,...",
  "sourceUrl": "https://videos.pexels.com/video-files/8479730/8479730-hd_1080_1920_25fps.mp4",
  "sourceCategory": "garden",       // this is the "slug" — e.g. "apartment", "buildings", "garden"
  "durationSec": 8.419557291363354, // already a float in seconds — no parsing needed
  "sizeBytes": 7126148,
  "streamCopied": true,
  "processing": "stream-copy trim · 1080×1920 h264/aac @ 0fps · crop in-app at post time",
  "hook": null | <TBD — server always returns null today, see "Known issue" below>,
  "trend": null | <TBD — server always returns null today, see "Known issue" below>
}
```

- **Video delivery:** `mp4DataUrl` is a complete `data:video/mp4;base64,...` URL in the response body. Decode and write to disk in Node — no download event needed.
- **Aspect ratio:** parse from `processing` string (`"1080×1920"` substring matches the `parseAspectRatio` helper from Task 1.3).
- **Duration:** `durationSec` is already numeric — no parsing helper needed. Task 1.3 `parseDurationSec` now unused for the API path; still useful as a defensive parser against the `processing` string.

**Known issue — server returns null hook:**

As of this discovery run (2026-04-21 ~17:40 EDT), 7+ consecutive API calls across different audiences (both / landlord / investor), controversy levels (1-5), useTrends on/off, and with/without topic hint all returned `"hook": null, "trend": null` despite `"success": true`. Appears to be a rent-roll-slides server-side bug (AI call silently failing, server still returns success). User reported "it just works for me" but empirically we cannot trigger a non-null hook right now. **This is the critical blocker.**

**Exact shape of `hook` and `trend` when non-null is still unknown.** The Phase 2 code must be written defensively:
- Treat `hook === null` or `hook === ''` as an empty overlay (retry or abort)
- Pattern-match whatever shape it turns out to be (`hook: string` OR `hook: { text: string, ... }`) once we see one

## TikTok Studio video editor

- Edit entry-point selector on upload page: _TBD — Task 0.3_
- Editor modal root selector: _TBD — Task 0.3_
- Crop tool selector: _TBD — Task 0.3_
- Crop 9:16 option selector + Apply: _TBD — Task 0.3_
- Whether crop re-encodes (verified via network tab): _TBD — Task 0.3_
- Text tool selector: _TBD — Task 0.3_
- Text input element type (contenteditable / textarea / input) + selector: _TBD — Task 0.3_
- Timeline root selector: _TBD — Task 0.3_
- Selected-text-clip selector (for verifySpan): _TBD — Task 0.3_
- Timeline drag handle selector(s): _TBD — Task 0.3_
- Timeline width (measured via `getBoundingClientRect().width`): _TBD — Task 0.3_
- Numeric duration input (if exists; simplifies extendOverlayToVideoEnd strategy 1): _TBD — Task 0.3_
- "Fit to video" affordance (if exists; strategy 3 fallback): _TBD — Task 0.3_
- Save / Done button selector: _TBD — Task 0.3_

## DOM selectors (fallback only — prefer the API)

If the API is ever unavailable, these selectors let us scrape the result card:

- Result card heading: `h2` with text "1 B-roll clip" (or "N B-roll clip")
- Each clip card: `div.rounded-xl.border`
- Header line: `div.text-xs.text-neutral-400` → format: `"apartment · 9.5s"` + inline stream-copy badge
- Meta line: `div.mt-1.text-\\[10px\\]` → format: `"stream-copy trim · 1080×1920 h264/no-audio @ 0fps · crop in-app at post time"`
- Save button: `button.bg-emerald-600` with text "⬇ Save"
- Empty-overlay warning: any text matching `/No overlay generated — model returned empty/i`
- Overlay copy/paste box: **NOT FOUND in DOM when overlay is empty.** Location when hook is non-null is still TBD — could not verify without a successful generation.
- Caption copy/paste box: same — TBD until we catch a successful response.

Video element: `<video>` with a `data:video/mp4;base64,...` `src` attribute (no blob URL, no download event — the video is embedded inline).
