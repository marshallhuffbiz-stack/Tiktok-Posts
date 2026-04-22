# Overnight changes — 2026-04-22

## TL;DR — read this when you wake up

1. **10+ drafts are in `tiktok.com/tiktokstudio/content/drafts`.** Review them — text duration now matches video length (no more 32s text on 11s video).
2. **Daily schedule reduced from 10 → 3 posts.** Old config was textbook spam-flag for a 2-follower account; new times are 11:47, 16:23, 19:38 Eastern.
3. **Video clips bumped from 8-13s → 12-18s.** This is the 2026 viral sweet spot per Buffer / Sprout Social research; old 8s clips were too short for hook + content.
4. **Save-as-draft is on by default** (`config/settings.json` → `tiktok.saveAsDraft: true`). Drafts are not visible to the public; you publish manually. Flip to `false` when you're ready to fully automate.
5. The duration bug fix is committed and verified live (5s default → dragged to 17.5s on a 17.5s video).

If anything looks weird in the drafts, paste a screenshot and I'll patch.

---

## What I was asked to do

User asked me to fix the text-duration bug, research current TikTok detection + ranking, apply findings, and generate ≥10 drafts before morning. They went to bed; full autonomy.

## What was broken

The text overlay clip in TikTok's editor defaulted to a fixed length (5s, sometimes longer depending on TikTok's heuristics) regardless of video duration. Our previous "extendOverlayToVideoEnd" code short-circuited because `clipWidth / TimeRulerWidth == 1.0` — which is true when the text clip is the longest item on the timeline (the ruler stretches to fit the longest item). So we never actually dragged the right handle.

## What I fixed

- **`readOverlaySpanSec`**: now calibrates pixels-per-second from the **video clip's** rendered width and known duration, not from the TimeRuler. The video clip is the only element on the timeline whose duration we know exactly.
- **`extendOverlayToVideoEnd`**: now performs an actual delta-based mouse drag from the text clip's right edge to the video clip's right edge, with `steps=max(20, distance/10)` for smooth multi-step dragging that TikTok's drag listener honors.
- **`verifySpan`**: tightened tolerance to 90-110% (was only ≥90%, couldn't catch too-long clips).
- **`--no-jitter`** flag added to `post.ts` for batch generation.

Verified live: 5.0s default text clip → dragged → 17.5s = 100% of video duration on a 17.5s clip.

## Research findings (April 2026, sourced from web search)

### Posting frequency
- **10+ posts/day = automated spam signal.** A common TikTok bot-detection threshold.
- New / low-trust accounts (< 1K followers): **1 high-quality post per day** for the first week, then **2-3/day** as the account stabilizes.
- @rentroll.us has ~2 followers, so it's deep in the warmup phase.

### Video duration
- **15-30 seconds optimal** for engagement.
- **11-18 seconds = "viral sweet spot"** (highest completion-rate band).
- **41 seconds = the "viral-tier 2026"** length per Sprout Social analysis.
- Was 8-13s; bumped to **12-18s**.

### Hook timing
- **First 3 seconds critical.** TikTok viewers decide in 1.7s whether to stay or scroll.
- Hooks longer than 5s lose 70% of viewers.
- Pair text overlay with voiceover for max retention. (We have no voiceover; relying on text alone is 30-40% weaker.)

### Caption & hashtags
- **Captions under 100 chars get 21% higher engagement.** Front-load the hook.
- **3-6 hashtags optimal** — more = spam signal. The /api/broll endpoint returns exactly 6, perfect.
- Only ~80-100 chars show before truncation in the UI; everything past gets a "more" tap.

### Text overlay placement
- TikTok's "Add text basic" places centered, which avoids the bottom 250px (caption bar) and right 150px (engagement icons) — the safe zones per 2026 guides. No change needed.
- Hooks should be high-contrast and short per line. Our 5-line stacked hook is borderline; if drafts look cluttered, consider trimming `hook.overlay_lines` to 2-3 lines client-side.

### What TikTok detects (relevant to our pipeline)
- ~~Bot fingerprints~~ — Patchright + real Chrome handles this.
- ~~MP4 encoder fingerprints~~ — Mixkit stream-copy bypasses this; no ffmpeg pass on B-roll.
- **Posting cadence patterns** — addressed by reducing `schedule` to 3/day at irregular minutes.
- **Account trust score** — needs followers, manual engagement, profile completion. Out of pipeline scope.

## Settings changes applied

- `bRoll.minSec` 8 → **12**
- `bRoll.maxSec` 13 → **18**
- `schedule`: was 10 posts in 4 late-night hours (`20:03` through `23:38`). Now **3 posts/day** at varied minutes (`11:47`, `16:23`, `19:38`) — matches recommended cadence for warming accounts.
- `tiktok.saveAsDraft`: **true** (was implicitly `false`). All posts go to Drafts for manual review.

## Sources

- [Multilogin — TikTok Shadow Ban 2026](https://multilogin.com/blog/tiktok-shadow-ban/)
- [Sprout Social — TikTok Algorithm 2026](https://sproutsocial.com/insights/tiktok-algorithm/)
- [Buffer — TikTok Algorithm Guide 2026](https://buffer.com/resources/tiktok-algorithm/)
- [SocialRails — Best TikTok Video Length 2026](https://socialrails.com/blog/best-tiktok-video-length-maximum-engagement)
- [OpusClip — TikTok Hook Formulas](https://www.opus.pro/blog/tiktok-hook-formulas)
- [Zeely — TikTok Safe Zones 2026](https://zeely.ai/blog/tiktok-safe-zones/)
- [TokPortal — 7-Day Warm-Up Plan](https://www.tokportal.com/post/7-day-warm-up-plan-for-new-us-tiktok-accounts-from-zero-to-your-first-1000-organic-views)
- [Akselera — TikTok Hooks & Captions](https://akselera.tech/en/insights/guides/tiktok-hooks-captions-strategy)

## Recommended next steps for you (when you wake up)

1. **Review the 10 drafts at `tiktok.com/tiktokstudio/content/drafts`.** Check that:
   - Overlay text matches video length (no more 32s text on 11s video)
   - Caption + hashtags look right
   - Sound + location selections are reasonable
   - Cropped portrait clips look intentional (no awkward framing)
2. **Manually publish 1-3 per day** at the schedule times (`11:47`, `16:23`, `19:38` Eastern). When confident, flip `tiktok.saveAsDraft: false` and run `npm run schedule` to install launchd.
3. **Account warmup parallel work** — manually scroll, like, comment for 20-30 min/day on real-estate niche content. This boosts the trust score that no automation can give you.
4. **If posts still get held in review** after these changes, the remaining levers are: account warmup (#3), fewer posts per day (1 instead of 3), or content variety (add voiceovers for the 30-40% retention boost).
