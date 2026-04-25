# Windows handoff — read this first

You're a fresh Claude Code session on Marshall's Windows desktop. The project moved from his Mac. Read the entire doc once, then propose next steps.

## Mission

Port this TikTok automation system (currently macOS-only, running on Marshall's Mac) to native Windows so the Mac is free during the day. The system posts videos to **@rentroll.us** on TikTok via Patchright + real Chrome, with TTS voiceover and AI-generated overlay text from a curated local template library.

## What this project does (one paragraph)

It pulls a portrait stock-video clip from Pexels (via the rent-roll-slides.vercel.app API), generates 5 lines of overlay text + a caption + hashtags from a local template library (`src/lib/localHook.ts`), runs macOS `say` to add a TTS voice-over with `ffmpeg -c:v copy` (preserving the Pexels h264 bitstream byte-for-byte), then drives a real Chrome window via Patchright through TikTok Studio: upload → enter editor → click Text tool → paste overlay text → drag the timeline handle to span the full video → save → fill caption (with hashtag mention entities) → pick a sound from the user's Favorites → click Post (or Save Draft, depending on `tiktok.saveAsDraft` setting). All of that takes ~2 minutes per post.

## Critical project context (DON'T re-derive any of this)

### Empirical findings (the most important thing)

- **81 prior posts got 0 views each** with the OLD formula: API templates + silent video + `#fyp` hashtag + dry math listicles + back-to-back cadence
- **First post with the NEW formula got 312 views**, second got 200, third got 0, fourth (just before handoff) is being scheduled
- **The four variables that changed (in order of likely impact)**:
  1. **TTS voiceover added** (silent → voiced) — `voiceover.ts` uses `say` + `ffmpeg`
  2. **Local hook templates** instead of API hooks (`preferLocalHooks: true`)
  3. **Hashtag pool drops `#fyp`/`#foryou`/`#viral`** (over-used, deprioritized)
  4. **Story-driven templates** (MISTAKE, SCREEN, POV, CONTRA, REVEAL, COMEBACK) outperform dry BRRRR-math listicles

These are documented in `docs/superpowers/specs/2026-04-22-shadowban-recovery-plan.md` and the `rent-roll-tiktok` skill. **Do NOT propose reverting any of these.**

### Account state

- **@rentroll.us is in active shadowban recovery.** 81 posts × 0 views earned it that status. The 312 + 200 view posts indicate the algorithm is testing recovery.
- **Don't wipe the browser-data on Windows assuming a fresh start fixes it** — the account-level shadow follows the account, not the device. A new Windows device fingerprint MIGHT help recovery (different device looks like the user is just using a second computer), but might also trigger TikTok's "new device" challenge requiring 2FA.
- Mac currently has a launchd schedule firing 4×/hour 7am-midnight (= 68 posts/day). **This must be disabled before the Windows version starts**, otherwise both machines will post simultaneously and that's a guaranteed re-shadow.

## Repo layout

```
Tiktok-Posts/                          ← root (this repo)
├── src/
│   ├── post.ts                        ← main orchestrator
│   ├── warmup.ts                      ← FYP browse automation (no posting)
│   ├── captureEditor.ts               ← debug helper: dumps TikTok editor DOM
│   ├── inspect.ts                     ← debug helper: opens browser headed
│   ├── login.ts                       ← one-time TikTok login flow
│   ├── schedule.ts                    ← legacy launchd plist generator (Mac)
│   └── lib/
│       ├── browser.ts                 ← Patchright launcher
│       ├── tiktok.ts                  ← TikTok Studio interactions
│       ├── bRoll.ts                   ← rent-roll-slides API client + clip download
│       ├── localHook.ts               ← LOCAL TEMPLATE LIBRARY (the winning content)
│       ├── voiceover.ts               ← MACOS-SPECIFIC: uses `say`. PORT TARGET.
│       ├── humanMouse.ts              ← curved mouse paths
│       ├── pexelsVariant.ts           ← rewrite UHD URLs to HD variants
│       ├── contentVariety.ts          ← hashtag pool, caption opener rewriter
│       ├── brollVariety.ts            ← topic + audience rotation
│       ├── overlay.ts                 ← TikTok native editor automation
│       ├── overlayMath.ts             ← span / drag math
│       ├── bRollParse.ts              ← aspect ratio / duration parsing
│       ├── log.ts                     ← runs.jsonl writer
│       ├── notify.ts                  ← MACOS-SPECIFIC: `osascript`. PORT TARGET.
│       ├── lockfile.ts                ← single-runner lock
│       └── sounds.ts                  ← TikTok sound picker
├── test/                              ← node:test unit tests (97 passing)
├── config/
│   ├── settings.json                  ← all the runtime knobs
│   └── tiktok-editor-selectors.json   ← captured DOM selectors (TikTok-version-specific)
├── scripts/
│   ├── install-post-schedule.sh       ← MACOS launchd installer. PORT TARGET (→ .ps1)
│   ├── install-warmup-schedule.sh     ← MACOS launchd installer. PORT TARGET (→ .ps1)
│   └── install-warmup-schedule.sh remove
├── docs/
│   ├── WINDOWS-HANDOFF.md             ← THIS FILE
│   └── superpowers/
│       ├── plans/                     ← historical implementation plans
│       └── specs/
│           ├── 2026-04-21-broll-native-overlay-design.md
│           ├── 2026-04-21-editor-selector-runbook.md
│           ├── 2026-04-22-shadowban-recovery-plan.md      ← READ THIS
│           └── 2026-04-22-overnight-changes.md
├── package.json
├── tsconfig.json
└── .gitignore                         ← excludes browser-data, downloads, logs
```

## What needs porting (the actual work)

### 1. `src/lib/voiceover.ts` (HIGH priority — biggest impact)

Currently runs:
```bash
say -v Samantha -r 175 -o file.aiff "text"
ffmpeg -y -i video.mp4 -i file.aiff -c:v copy -c:a aac -b:a 96k ...
```

Windows replacements ranked best to worst:

1. **`edge-tts`** (Python pip package, free, uses Microsoft Edge's neural voices — much better quality than macOS `say` or PowerShell):
   ```bash
   pip install edge-tts
   edge-tts --voice "en-US-AriaNeural" --rate "+10%" --text "..." --write-media file.mp3
   ```
   Voices: `en-US-AriaNeural`, `en-US-GuyNeural`, `en-US-JennyNeural`, `en-US-DavisNeural` etc. Rotate for variety like we currently rotate Samantha/Alex/Karen/Daniel/Ava.

2. **PowerShell `System.Speech.Synthesis`** (built into Windows, no install):
   ```powershell
   Add-Type -AssemblyName System.Speech
   $s = New-Object System.Speech.Synthesis.SpeechSynthesizer
   $s.SetOutputToWaveFile("file.wav")
   $s.Speak("text")
   $s.Dispose()
   ```
   Voices are old (David, Zira) — sounds robotic compared to edge-tts.

**Recommendation: edge-tts.** Quality matters for a sleeping algorithm.

The ffmpeg part is unchanged — works the same on Windows once ffmpeg.exe is on PATH.

### 2. `src/lib/notify.ts`

Calls macOS `osascript` for desktop notifications. On Windows, use PowerShell `New-BurntToastNotification` (requires `Install-Module BurntToast`) OR just write to a log file (simpler, the notifications aren't load-bearing).

### 3. Schedule installer (`scripts/install-post-schedule.sh`)

Currently writes a launchd plist. On Windows, need a `.ps1` script that:
- Generates a Task Scheduler XML with 68 triggers (4/hour × 17 hours, 7am-11:45pm)
- Registers it via `Register-ScheduledTask`
- Action: runs `npm.cmd run post -- --no-jitter` from the project directory
- Same kill-stray-Chrome cleanup as the macOS version (use PowerShell `Stop-Process` or `taskkill`)

Same need for the warmup installer.

### 4. Path conventions

Most paths in the code use `node:path` correctly so they're cross-platform. Spot-check anything hardcoded — `/tmp/...` paths in shell scripts won't work on Windows (use `$env:TEMP` in PowerShell or `process.env.TEMP` in Node).

### 5. Browser data dir

Currently the Mac symlinks `browser-data` (in worktree) → `/Users/MarshallHuff/tiktok schedule/browser-data` (main checkout). On Windows it's a fresh login — just let `openBrowser()` create `./browser-data/` in the cwd on first run. The user logs in interactively once.

## Step-by-step setup checklist for the Windows machine

1. **Install prerequisites** (~10 min)
   - Node.js 20+: https://nodejs.org/
   - Git for Windows: https://git-scm.com/
   - ffmpeg: easiest is `winget install ffmpeg` (or download from https://ffmpeg.org/) — verify with `ffmpeg -version`
   - Python 3.11+: https://python.org/ (needed for edge-tts)
   - `pip install edge-tts` — test with `edge-tts --voice "en-US-AriaNeural" --text "hello world" --write-media test.mp3`

2. **Clone the repo**
   ```powershell
   cd $HOME
   git clone https://github.com/marshallhuffbiz-stack/Tiktok-Posts.git
   cd Tiktok-Posts
   git checkout claude/gallant-poitras
   npm ci
   ```

3. **Disable the Mac launchd schedule** so both machines don't post simultaneously
   - Tell Marshall, or have him SSH/screenshare and run on Mac:
     ```bash
     launchctl bootout gui/$UID/com.user.tiktokpost
     ```

4. **First TikTok login on the Windows Chrome profile**
   - Run `npm run inspect` (after porting it, or just navigate to the upload page manually)
   - Log into @rentroll.us — TikTok will likely send an email/SMS code (new device challenge)
   - Marshall completes the login, then close

5. **Port `voiceover.ts` to use `edge-tts`** (or PowerShell TTS)

6. **Port the schedule installer** to PowerShell

7. **Test a single dry-run**
   ```powershell
   npm run post -- --no-jitter --dry-run
   ```
   Verify: video downloads, voiceover applies (audio track present), upload succeeds, edit flow works, save-draft fires.

8. **Install the schedule** via the new `install-post-schedule.ps1`

## Settings to verify before first post on Windows

In `config/settings.json` these MUST be the current values (winning formula):

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

## Things the previous Claude session learned the hard way

- **Don't re-encode the video.** `-c:v copy` only — the Pexels h264 stream's authenticity is part of why TikTok accepts it. Re-encoding adds Lavc/x264 fingerprints.
- **Don't use `#fyp`, `#foryou`, `#foryoupage`, `#viral`** — deprioritized for small accounts.
- **Don't pick random TikTok location chips** — `locationMode: "skip"` is correct.
- **Don't underestimate disk space** — Pexels clips eat ~10-100MB each at 4K. `retention.downloadsKeepDays: 1` and the prune step in `post.ts` should handle it.
- **Always kill stray Chrome processes** before each `npm run post` (the launchd installer already does this — port that to PowerShell).
- **NEVER wipe `browser-data/`** on a working machine — that's the TikTok session.

## Open questions when you start

Ask Marshall when he's at the Windows machine:
1. "Are you running native Windows or WSL2?" (We picked native Windows. Confirm.)
2. "Any specific edge-tts voice preference, or rotate among 4-5?" (Default plan: rotate Aria, Guy, Jenny, Davis, Sara.)
3. "Do you want to start the Windows schedule TONIGHT or wait until you've watched 2-3 manual posts succeed?" (Recommended: 2-3 manual successful posts first to confirm the port works.)
4. "Should I disable the Mac launchd schedule from here via SSH, or are you going to do that yourself?" (Cleaner if user does it on the Mac directly.)

## Sources for the empirical findings

- `docs/superpowers/specs/2026-04-22-shadowban-recovery-plan.md` — the full diagnosis + recovery plan
- `logs/runs.jsonl` (gitignored, only on Mac) — timestamped record of every run, with template_id, slug, source URL, voiceover state
- The packaged skill `rent-roll-tiktok.skill` (already installed in Marshall's Claude Code on Mac)
