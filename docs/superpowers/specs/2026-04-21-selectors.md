# Phase 0 Selector Discovery

Captured live via Playwright MCP (rent-roll-slides) and Claude-in-Chrome (TikTok Studio). Every selector below is load-bearing for Phase 2/3 code.

## rent-roll-slides B-roll mode

- Overlay copy/paste box selector: _TBD — Task 0.2_
- Caption copy/paste box selector: _TBD — Task 0.2_
- Video delivery mechanism (download event / blob URL / data URI): _TBD — Task 0.2_
- Save button selector: _TBD — Task 0.2_
- Result card header (slug + duration line) selector: _TBD — Task 0.2_
- Result card meta line (WxH, codec) selector: _TBD — Task 0.2_
- Observed empty-overlay rate: 2/2 in initial exploration. Retry loop mandatory.

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
