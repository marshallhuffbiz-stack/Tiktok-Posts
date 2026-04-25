# Intel Mac handoff — read this first

You're a fresh Claude Code session on Marshall's older Intel Mac (the dedicated posting machine). The project is moving here from his M-series Mac so he can use the M-series for day-job work. Read the entire doc, then propose the next concrete step before doing anything.

## Mission

Get this TikTok automation running on the Intel Mac, confirm parity with the M-series version (a single `npm run post -- --no-jitter --dry-run` succeeds), then install the launchd schedule. The whole port is essentially zero code changes — Mac-to-Mac means everything works as-is.

## What this project does (one paragraph)

It pulls a portrait stock-video clip from Pexels (via the rent-roll-slides.vercel.app API), generates 5 lines of overlay text + a caption + hashtags from a local template library (`src/lib/localHook.ts`), runs macOS `say` to add a TTS voice-over with `ffmpeg -c:v copy` (preserving the Pexels h264 bitstream byte-for-byte), then drives a real Chrome window via Patchright through TikTok Studio: upload → enter editor → click Text tool → paste overlay text → drag the timeline handle to span the full video → save → fill caption (with hashtag mention entities) → pick a sound from the user's Favorites → click Post (or Save Draft, depending on `tiktok.saveAsDraft` setting). All of that takes ~2 minutes per post on the M-series; expect 4-5 minutes on Intel.

## Critical project context (DON'T re-derive)

### The empirical findings (the most important thing)

- **81 prior posts on @rentroll.us got 0 views each** with the OLD formula: API templates + silent video + `#fyp` hashtag + dry math listicles + back-to-back cadence
- **First post with the NEW formula got 312 views**, second got 200; pattern is real
- **Schedule fired 5 successful posts on the M-series this morning** (08:15-09:15 local) before being disabled — view-count data on those is incoming
- **The four winning variables, in order of likely impact**:
  1. **TTS voiceover added** (silent → voiced) via `voiceover.ts`
  2. **Local hook templates** instead of API hooks (`preferLocalHooks: true`)
  3. **Hashtag pool drops `#fyp`/`#foryou`/`#viral`** (over-used, deprioritized)
  4. **Story-driven templates** (MISTAKE, SCREEN, POV, CONTRA, REVEAL, COMEBACK) outperform dry BRRRR-math listicles

These are documented in `docs/superpowers/specs/2026-04-22-shadowban-recovery-plan.md` and the `rent-roll-tiktok` skill. **Do NOT propose reverting any of these.**

### Account state

- **@rentroll.us is in active shadowban recovery.** 81 posts × 0 views earned that status. The 312 + 200 view posts indicate the algorithm is testing recovery.
- **A different device fingerprint may help** the recovery — Intel Mac vs M-series is a meaningful Chrome/WebGL fingerprint shift on the same residential IP. Treat that as a free experiment.
- **The M-series launchd schedule must be confirmed-disabled** before this Intel Mac starts firing. Otherwise both machines post simultaneously = guaranteed re-shadow.

## Setup checklist

### 1. Install dependencies (~10 min)

```bash
# Homebrew (skip if already installed)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node, ffmpeg, git
brew install node ffmpeg git

# Verify
node --version       # v20+ ideally
ffmpeg -version | head -1
git --version
```

### 2. Clone the repo

```bash
cd ~
git clone https://github.com/marshallhuffbiz-stack/Tiktok-Posts.git
cd Tiktok-Posts
npm ci
```

### 3. First TikTok login

```bash
npm run login
```

This opens a real Chrome window via Patchright. Marshall logs into @rentroll.us manually. **TikTok will likely send a verification code to email/SMS** because this is a new device fingerprint. Have him paste the code. Once logged in, close the window — Patchright preserves the session in `./browser-data/`.

### 4. Smoke test

```bash
npm run post -- --no-jitter --dry-run
```

Expected output (look for these lines):
```
[bRoll] inputs: topic="..." audience=... controversy=...
[bRoll] using local template generator (preferLocalHooks=true)
[voiceover] added (voice=...) → ...voiced.mp4
[overlay] AddTextPanel opened
[overlay] text style: basic
[overlay] text clip is X.Xs, video is Y.Ys — dragging right handle
[overlay] span verified: Y.Ys (100% of video)
[location] skipping location field (locationMode=skip)
```

If anything in the overlay flow throws, see `docs/superpowers/specs/2026-04-21-editor-selector-runbook.md` — TikTok DOM selectors live in `config/tiktok-editor-selectors.json` and may need re-capture via `npm run capture-editor`.

### 5. CONFIRM the M-series Mac's launchd schedule is OFF

Have Marshall run on his M-series:
```bash
launchctl list | grep tiktokpost && echo "STILL ON — needs bootout" || echo "OFF — safe to start Intel"
```

If still on, run:
```bash
launchctl bootout gui/$UID/com.user.tiktokpost
```

### 6. Single live test post

```bash
npm run post -- --no-jitter
```

This will actually publish to @rentroll.us. Expected duration: 3-5 min on Intel. Wait for `status: success` in `tail -1 logs/runs.jsonl`.

Then have Marshall check `https://www.tiktok.com/tiktokstudio/content` — the new post should appear in the Posts tab. Watch view count over 30 min.

### 7. If the live test landed cleanly, install the schedule

```bash
./scripts/install-post-schedule.sh
```

This installs a launchd job with 68 fire times (every 15 min between 7am and 11:45pm). Logs go to `logs/post-launchd.log`.

### 8. System sleep

System Settings → Battery (or Energy Saver on older macOS) → "Prevent automatic sleeping when display is off" should be **on**. The display can sleep, the machine cannot. launchd does not wake a sleeping Mac.

## Repo layout

```
Tiktok-Posts/
├── src/
│   ├── post.ts                        ← main orchestrator
│   ├── warmup.ts                      ← FYP browse automation (no posting)
│   ├── captureEditor.ts               ← debug helper: dumps TikTok editor DOM
│   ├── inspect.ts                     ← debug helper: opens browser headed
│   ├── login.ts                       ← one-time TikTok login flow
│   └── lib/
│       ├── browser.ts                 ← Patchright launcher
│       ├── tiktok.ts                  ← TikTok Studio interactions
│       ├── bRoll.ts                   ← rent-roll-slides API client + clip download
│       ├── localHook.ts               ← LOCAL TEMPLATE LIBRARY (the winning content)
│       ├── voiceover.ts               ← macOS `say` + ffmpeg mux
│       ├── humanMouse.ts              ← curved mouse paths
│       ├── pexelsVariant.ts           ← rewrite UHD URLs to HD variants
│       ├── contentVariety.ts          ← hashtag pool, caption opener rewriter
│       ├── brollVariety.ts            ← topic + audience rotation
│       ├── overlay.ts                 ← TikTok native editor automation
│       ├── overlayMath.ts             ← span / drag math
│       ├── bRollParse.ts              ← aspect ratio / duration parsing
│       ├── log.ts                     ← runs.jsonl writer
│       └── ... (notify, lockfile, sounds, schedule)
├── test/                              ← node:test unit tests (97 passing)
├── config/
│   ├── settings.json                  ← all the runtime knobs
│   └── tiktok-editor-selectors.json   ← captured DOM selectors
├── scripts/
│   ├── install-post-schedule.sh       ← 68 slots/day launchd installer
│   └── install-warmup-schedule.sh     ← warmup launchd installer
├── docs/
│   ├── INTEL-MAC-HANDOFF.md           ← THIS FILE
│   └── superpowers/specs/             ← background docs (read shadowban-recovery-plan if confused)
└── package.json, tsconfig.json, .gitignore
```

## Settings to verify before any live run

`config/settings.json` MUST have these values (the winning formula):

```json
{
  "tiktok": {
    "saveAsDraft": false,
    "locationMode": "skip"
  },
  "bRoll": {
    "preferLocalHooks": true,
    "voiceover": { "enabled": true, "rate": 175 }
  },
  "cadence": {
    "skipProbability": 0,
    "allowedHours": [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
  }
}
```

If any of those are different, ask Marshall before changing — he may have intentionally tuned them.

## Things the previous Claude session learned the hard way

- **Don't re-encode the video.** `-c:v copy` only — the Pexels h264 stream's authenticity is part of why TikTok accepts it. Re-encoding adds Lavc/x264 fingerprints that get flagged.
- **Don't use `#fyp`, `#foryou`, `#foryoupage`, `#viral`** — deprioritized for small accounts.
- **Don't pick random TikTok location chips** — `locationMode: "skip"` is correct. Random nationwide locations look bot-like.
- **Don't underestimate disk space.** Pexels clips eat 10-100MB each at 4K. `retention.downloadsKeepDays: 1` and the prune step in `post.ts` should handle it. Periodically: `du -sh downloads/` to check.
- **Always kill stray Chrome processes** before each run. The launchd installer's command does this; if you run `npm run post` by hand and get a profile-lock error, run `pkill -f "Chrome.*browser-data"` and retry.
- **NEVER wipe `browser-data/`** on a working machine — that's the TikTok session.

## When something goes wrong

Read `logs/runs.jsonl` — last line = most recent run. Key fields: `status`, `errorType`, `errorMsg`, `templateId`, `slug`, `sourceUrl`, `soundName`.

Common failures and fixes:

- **`rent-roll-slides returned empty hook 15 time(s)`** — `/api/broll` AI is broken. Check `bRoll.preferLocalHooks` is true; that bypasses the API hook and uses the local template generator.
- **`no 9:16 clip after N attempts`** — bad-luck portrait streak. Bump `bRoll.overlayRetries` higher or loosen `is916` tolerance in `bRollParse.ts` (currently 8%).
- **`ENOSPC: no space left on device`** — Pexels clips piled up. `du -sh downloads/`; prune: `ls -t downloads/*.mp4 | tail -n +20 | xargs rm -f`
- **`locator.click: Timeout` on text or editor entry** — TikTok DOM selector drift. `npm run capture-editor`, then update `config/tiktok-editor-selectors.json`.
- **`[post] watchOwnPost failed`** — non-fatal; the post itself succeeded. Safe to ignore.
- **Live posts showing 0 views for hours after recovery had been working** — the per-post view yield falls fast under volume. Pause the schedule, drop to 2-3/hour, resume.

## Open questions to ask Marshall on first contact

1. "Is the M-series launchd schedule confirmed off?" (Don't start the Intel one until he says yes.)
2. "Do you want the Intel Mac to run the same 68 posts/day schedule as the M-series, or scale down?" (He set 4/hour but the breakthrough came at slower cadence — recommend confirming.)
3. "Should I move the existing `browser-data/` from the M-series, or let the Intel create a fresh one?" (Recommend FRESH on Intel — the device fingerprint shift may help the shadow recovery.)
4. "Want me to disable the warmup launchd schedule on the M-series too?" (If installed, it should also move here for the same reason — to consolidate everything on the dedicated machine.)

## The rent-roll-tiktok skill

Marshall has a skill installed in his Claude Code at:

`~/Library/Application Support/Claude/local-agent-mode-sessions/skills-plugin/<id>/skills/rent-roll-tiktok/SKILL.md`

If you have skill-loading available in this session, that skill is the canonical "operator runbook" for this codebase. Triggers on phrases about posting to TikTok / running the loop / @rentroll.us. If you're seeing this handoff but the skill isn't loaded, it's because Marshall hasn't installed it yet on the Intel Mac — he can copy `rent-roll-tiktok.skill` from the M-series to install.
