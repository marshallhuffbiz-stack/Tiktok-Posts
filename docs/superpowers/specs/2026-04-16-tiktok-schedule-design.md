# TikTok Schedule — Design Spec

**Date:** 2026-04-16
**Status:** Approved for implementation
**Owner:** Marshall Huff
**Niche:** Real estate / rental property (the "RentRoll" TikTok account)

## 1. Goal

Automate posting AI-generated short videos to a single TikTok account, on a schedule, from an always-on Mac. Each post:

1. Generates a 1080×1920 vertical video via the user's existing tool, [rent-roll-slides.vercel.app](https://rent-roll-slides.vercel.app/).
2. Uploads it to TikTok Studio with a caption (provided by the generator), a location tag, and a curated sound from the user's TikTok Favorites.
3. Logs success or failure and notifies the user via macOS notification on failure.

We deliberately avoid TikTok's official posting API — it is hard to obtain and known to suppress reach for content posted through it. A logged-in browser session driving the standard TikTok Studio upload UI behaves like a normal creator and is not subject to that suppression.

**Initial cadence:** 10 posts per day at fixed off-minute times. Designed to ramp higher (target 50–100/day) once we observe the account's response to automation.

## 2. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  macOS launchd (system scheduler)                           │
│  ~/Library/LaunchAgents/com.user.tiktokpost.plist           │
│  10 StartCalendarInterval entries → fires post.js per slot  │
└────────────────────────────┬────────────────────────────────┘
                             │ invokes
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  dist/post.js  (Node + Playwright; one shot, then exits)    │
│   1. pick random topic from config/topics.txt               │
│   2. open rent-roll-slides.vercel.app via Playwright        │
│   3. configure form, click Generate                         │
│   4. wait for video.src; decode base64; write MP4 to disk   │
│   5. scrape caption + hashtags from DOM                     │
│   6. open tiktok.com/tiktokstudio/upload (same context)     │
│   7. attach MP4 via hidden input[type=file]                 │
│   8. clear filename auto-prefill, type real caption         │
│   9. click first chip in location suggestion row            │
│  10. open Sounds editor → Favorites → least-recently-used   │
│  11. click Post; verify success state                       │
│  12. append to runs.jsonl; notify on failure                │
└────────────────────────────┬────────────────────────────────┘
                             │ uses
                             ▼
┌─────────────────────────────────────────────────────────────┐
│  Single Playwright persistent browser context               │
│  ./browser-data/   ← stores TikTok login cookies            │
│  Logged in once manually via `npm run login`                │
└─────────────────────────────────────────────────────────────┘
```

### Key choices

- **launchd, not cron or a daemon.** macOS-native; survives reboots and sleep/wake; queues missed runs; no long-lived process.
- **One script per fire, no daemon.** Each scheduled run is `node dist/post.js`, which exits when done. Fresh state every run, no memory leaks.
- **Single Playwright persistent context for both sites.** Both rent-roll-slides and TikTok run in the same browser session — saves a browser launch per post.
- **No login automation, ever.** TikTok login uses a captcha (a circular wheel-slider puzzle). The script never tries to solve it. Login is a one-time manual step (`npm run login`) into the persistent browser data dir; cookies carry every subsequent run.
- **Routines are not used.** Anthropic's new Claude Code Routines feature is cloud-hosted and cannot reach a logged-in browser session on the user's Mac. Volume cap (15/day on Max plan) also incompatible with the long-term 50–100/day target.

### Architecture options considered and rejected

- **Pure script + macOS launchd** ← chosen. Cheap, fast, deterministic.
- **Claude scheduled tasks (every post is a Claude session).** Self-healing but ~$1–3 per post → $50–300/day at target volume. Not cost-effective.
- **Hybrid: script posts, Claude monitors.** Reasonable v2 enhancement; deferred.

## 3. Components & File Layout

```
tiktok schedule/
├── package.json              # node deps: playwright, dotenv (already initialized)
├── tsconfig.json             # TypeScript strict
├── README.md                 # setup, run, troubleshoot
│
├── src/
│   ├── post.ts               # entry — runs ONE post end-to-end
│   ├── login.ts              # entry — opens headed browser for manual TikTok login
│   ├── schedule.ts           # entry — generates/installs the launchd plist
│   │
│   ├── lib/
│   │   ├── browser.ts        # opens persistent Playwright context, returns Page
│   │   ├── rollSlides.ts     # drives rent-roll-slides.vercel.app
│   │   ├── tiktok.ts         # drives tiktok.com/tiktokstudio/upload
│   │   ├── topics.ts         # reads topics.txt, picks random topic
│   │   ├── sounds.ts         # reads Favorites tab, picks least-recently-used
│   │   ├── notify.ts         # macOS notification via osascript
│   │   ├── lockfile.ts       # prevent overlapping runs (.post.lock)
│   │   └── log.ts            # appends to runs.jsonl
│
├── scripts/
│   └── grab-test-video.mjs   # standalone helper (already exists; prototype of rollSlides.ts)
│
├── config/
│   ├── topics.txt            # one topic per line; user maintains
│   ├── settings.json         # cadence + style + anti-repeat config
│   └── (generated) com.user.tiktokpost.plist
│
├── browser-data/             # Playwright persistent context (gitignored, sensitive)
├── downloads/                # MP4s + caption.txt files (gitignored, 7-day retention)
└── logs/
    ├── runs.jsonl            # one line per attempted post
    ├── launchd.out.log       # launchd stdout
    └── launchd.err.log       # launchd stderr
```

### Module responsibilities

Each `lib/*.ts` has one external surface and can be tested independently with a mock `Page`:

- **`browser.ts`** — opens persistent context at `./browser-data/`, returns a `Page`. Knows nothing about either site.
- **`rollSlides.ts`** — given a `Page` and a topic, drives the form, returns `{ videoPath, caption, slug }`. Knows nothing about TikTok.
- **`tiktok.ts`** — given a `Page`, video path, and caption, uploads and posts. Returns `{ status, postedUrl?, error? }`. Knows nothing about roll slides.
- **`topics.ts`** — reads `config/topics.txt`, ignores blanks and `#` comments, picks one at random.
- **`sounds.ts`** — given a `Page` already on the upload form, opens the Sounds editor, picks the least-recently-used Favorite (filtered against last N from `runs.jsonl`), saves, and returns the chosen sound name. Falls back to top-of-For-You on any failure.
- **`notify.ts`** — wraps `osascript -e 'display notification ...'`.
- **`lockfile.ts`** — atomic create-if-not-exists at `./.post.lock` containing the running process's PID. On startup, if a lock exists, check whether that PID is still alive (`process.kill(pid, 0)` semantics); abort if alive, take over the lock if dead. Always remove on graceful exit.
- **`log.ts`** — appends a single JSON object per run to `logs/runs.jsonl`.
- **`post.ts`** — orchestrates: lockfile → topic → rollSlides → tiktok → log → notify-on-failure → cleanup → unlock.
- **`login.ts`** — opens a HEADED Chromium pointing at tiktok.com/login; waits for stdin; closes context. The user does the captcha manually.
- **`schedule.ts`** — reads `settings.json`, writes the plist, runs `launchctl bootstrap gui/$UID`. Re-running unloads the old plist first.

## 4. Runtime Sequence (One Post)

```
launchd fires `node dist/post.js` at scheduled time
│
├─ pre-flight
│  ├─ acquire ./.post.lock  (else abort: "another post in flight")
│  ├─ load config/settings.json
│  ├─ load config/topics.txt
│  ├─ load logs/runs.jsonl tail (last 20 lines for sound anti-repeat)
│  └─ ensure browser-data/ exists (else abort + notify "run npm run login")
│
├─ open persistent Playwright Chromium (headless, single Page reused)
│
├─ ROLL SLIDES PHASE  (~35–45s typical)
│  ├─ goto rent-roll-slides.vercel.app
│  ├─ pick random topic from topics.txt
│  ├─ select Carousels=1, Slides each=N, Output=Video, Sec/slide=K
│  ├─ Style Mode=Outline, Text Color=white, Outline Color=black
│  ├─ fill topic into textbox
│  ├─ wait for Generate button enabled, click
│  ├─ wait for `<video>.src` to be a `data:video/mp4;base64,...` URL
│  ├─ decode base64 → write downloads/<timestamp>-<slug>.mp4
│  ├─ scrape caption (2nd <p> in caption block) + hashtags (3rd <p>)
│  └─ write sibling .caption.txt for debugging
│
├─ TIKTOK PHASE  (~60–90s typical)
│  ├─ goto tiktok.com/tiktokstudio/upload
│  ├─ if URL contains '/login' → throw `tiktok-session-expired`
│  ├─ dismiss first-run popups via try-with-timeout:
│  │    - "New editing features" → click "Got it"
│  │    - "Turn on automatic content checks?" → click "Cancel"
│  ├─ setInputFiles on input[type=file][accept="video/*"]
│  ├─ wait for "Uploaded" indicator (text or green checkmark)
│  ├─ description editor (.public-DraftEditor-content):
│  │    click → Cmd+A → Delete → keyboard.insertText(caption) → Escape
│  ├─ location: click first chip in suggestion row
│  ├─ sounds: lib/sounds.ts handles editor open/pick/save
│  ├─ click Post button
│  └─ wait for success indicator (URL change OR success toast text)
│
├─ logging
│  └─ append to logs/runs.jsonl:
│     { ts, topic, slug, captionFirst80, soundName, soundFallback,
│       location, status, durationMs, errorType?, errorMsg? }
│
├─ on failure
│  ├─ notify via osascript with title + body
│  └─ if hard-failure (session-expired, account-flagged):
│       launchctl bootout gui/$UID/com.user.tiktokpost
│
└─ cleanup
   ├─ close browser context
   ├─ prune downloads/ files older than 7 days
   ├─ release ./.post.lock
   └─ exit 0 (success) or exit 1 (failure)
```

### Sound flow detail (most fragile piece)

```
PRIMARY (from Favorites):
  click "Sounds" button (right toolbar)
  wait for editor view (title becomes "My Multimedia Project")
  click "Favorites" tab
  scrape visible sound names + thumbnails
  filter out names appearing in last N runs from runs.jsonl
  if any candidates remain:
    click "+" on the least-recently-used candidate
    click "Save" (top right)
    wait for return to upload form
    record { soundName, soundFallback: false }
    return success

FALLBACK (top of For You):
  if Favorites tab missing/empty/all recently used/click failed:
  ensure Sounds editor is open
  click "For You" tab (or do nothing — it's the default)
  click "+" on the first sound in the list
  click "Save"
  wait for return to upload form
  record { soundName: <first-sound>, soundFallback: true }
  return success

NEVER use Original Sound. Every post has a sound.
```

## 5. Configuration

### `config/settings.json` (initial values)

```json
{
  "schedule": [
    "08:17", "09:42", "11:08", "12:34", "14:11",
    "15:47", "17:23", "18:58", "20:14", "21:51"
  ],
  "rollSlides": {
    "carousels": 1,
    "slidesEach": 5,
    "secPerSlide": 4,
    "outputMode": "Video",
    "styleMode": "Outline",
    "textColor": "white",
    "outlineColor": "black",
    "preset": null,
    "_presetComment": "When preset is null, individual style fields below are applied. When set (e.g. 'Classic Black'), it overrides the individual fields.",
    "font": "Classic",
    "size": "52px",
    "align": "Center"
  },
  "tiktok": {
    "uploadUrl": "https://www.tiktok.com/tiktokstudio/upload",
    "clickFirstLocationChip": true,
    "aiGeneratedDisclosure": false,
    "firstRunContentChecks": "Cancel"
  },
  "antiRepeat": {
    "soundLastN": 8
  },
  "retention": {
    "downloadsKeepDays": 7
  }
}
```

### `config/topics.txt` (user-maintained)

```
# One topic per line. Blank lines and lines starting with # are ignored.
# Aim for 50+ to keep variety high.
Biggest landlord screening mistakes
5 red flags in tenant applications
Why you should never skip a rent roll review
...
```

### `logs/runs.jsonl` (one line per run)

```json
{"ts":"2026-04-16T13:34:08-05:00","topic":"5 red flags in tenant applications","slug":"this-tenant-app-looks-fine-until-one-lin-bzsg","captionFirst80":"Tenant apps can look great on paper and still wreck your month. Save this be","soundName":"Two Time","soundFallback":false,"location":"Yung Ho Cafe","status":"success","durationMs":94521}
{"ts":"2026-04-16T15:47:02-05:00","status":"fail","errorType":"tiktok-session-expired","errorMsg":"redirected to /login","durationMs":3210}
```

## 6. Scheduling (launchd)

### `~/Library/LaunchAgents/com.user.tiktokpost.plist` (generated)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.user.tiktokpost</string>
  <key>ProgramArguments</key><array>
    <string>/Users/MarshallHuff/.local/bin/node</string>
    <string>/Users/MarshallHuff/tiktok schedule/dist/post.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/MarshallHuff/tiktok schedule</string>
  <key>StartCalendarInterval</key><array>
    <dict><key>Hour</key><integer>8</integer><key>Minute</key><integer>17</integer></dict>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>42</integer></dict>
    <dict><key>Hour</key><integer>11</integer><key>Minute</key><integer>8</integer></dict>
    <dict><key>Hour</key><integer>12</integer><key>Minute</key><integer>34</integer></dict>
    <dict><key>Hour</key><integer>14</integer><key>Minute</key><integer>11</integer></dict>
    <dict><key>Hour</key><integer>15</integer><key>Minute</key><integer>47</integer></dict>
    <dict><key>Hour</key><integer>17</integer><key>Minute</key><integer>23</integer></dict>
    <dict><key>Hour</key><integer>18</integer><key>Minute</key><integer>58</integer></dict>
    <dict><key>Hour</key><integer>20</integer><key>Minute</key><integer>14</integer></dict>
    <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>51</integer></dict>
  </array>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>/Users/MarshallHuff/tiktok schedule/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>/Users/MarshallHuff/tiktok schedule/logs/launchd.err.log</string>
</dict></plist>
```

### Operator commands

```bash
npm run schedule                                 # regenerate + reload from settings.json
launchctl list | grep tiktokpost                 # is it loaded?
launchctl print gui/$UID/com.user.tiktokpost     # next fire time, last exit
npm run pause                                    # launchctl bootout (stop all runs)
npm run resume                                   # re-install (alias for npm run schedule)
```

## 7. Failure Handling & Notifications

### Failure taxonomy

| Type | Trigger | Severity | Action |
|---|---|---|---|
| `roll-slides-timeout` | Generate runs >180s without "Done!" | soft | Skip; notify |
| `roll-slides-no-video` | "Done!" appears but `<video>.src` empty | soft | Skip; notify |
| `tiktok-session-expired` | Upload page redirects to `/login` | **hard** | Skip; notify; auto-pause schedule |
| `tiktok-upload-stuck` | "Uploaded" never appears within 90s | soft | Skip; notify |
| `tiktok-post-failed` | Post click → no success state in 60s | soft | Skip; notify |
| `tiktok-account-flagged` | Specific error toast text matched | **hard** | Skip; notify; auto-pause schedule |
| `unknown-error` | Any uncaught exception | soft | Skip; notify with first stack line |

### Severities

- **Soft** — log + notify; next scheduled run still fires.
- **Hard** — log + notify + `launchctl bootout gui/$UID/com.user.tiktokpost`. Continuing to fail every slot is worse than stopping until the user fixes it.

### No automatic retries

If a single post fails, wait for the next scheduled time. Reasoning:

- Retries during anti-spam scrutiny look worse than a missed slot.
- Most failures are systemic (session expired, UI changed) and would fail again immediately.
- Missing one of 10 daily posts is a 10% miss, not catastrophic.

### Notification mechanism

```bash
osascript -e 'display notification "<body>" with title "TikTok Schedule" sound name "Basso"'
```

Native macOS, no extra deps. `Basso` is the system error tone (silent on success).

## 8. Setup & Onboarding

```bash
# 1. Install (already partially done)
cd "/Users/MarshallHuff/tiktok schedule"
npm install
npx playwright install chromium

# 2. Edit topic master list
$EDITOR config/topics.txt

# 3. Tweak settings if needed (defaults are sensible)
$EDITOR config/settings.json

# 4. ONE-TIME TikTok login (handles the captcha manually)
npm run login

# 5. Curate TikTok sound favorites in your normal browser/app
# Tap any sound → tap bookmark icon. Aim for 10–20.

# 6. Smoke test
npm run post -- --dry-run    # see "--dry-run flag" below
npm run post                  # full flow including real post

# 7. Install schedule
npm run schedule
```

### `package.json` scripts

```json
{
  "scripts": {
    "build": "tsc",
    "post": "npm run build && node dist/post.js",
    "login": "npm run build && node dist/login.js",
    "schedule": "npm run build && node dist/schedule.js",
    "logs": "tail -f logs/runs.jsonl | jq -c .",
    "logs:errors": "grep -E '\"status\":\"fail\"' logs/runs.jsonl | jq",
    "pause": "launchctl bootout gui/$UID/com.user.tiktokpost",
    "resume": "npm run schedule"
  }
}
```

### `.gitignore`

```
node_modules/
dist/
browser-data/
downloads/
logs/
config/topics.txt
.post.lock
*.log
```

### `--dry-run` flag

`post.ts` accepts an optional `--dry-run` flag. When present:
- Roll slides phase runs normally (real video generated and saved to disk).
- TikTok phase runs through file upload, caption typing, location chip click, and sound selection.
- **Instead of clicking Post**, the script clicks Discard, confirms in the dialog, and exits.
- The run is logged with `status: "dry-run-success"` (or the matching failure type) so dry runs are distinguishable in the log.

Useful for end-to-end testing without polluting the account, and as the smoke test in step 6 of setup.

### Sensitive-data warnings (in README)

- **`browser-data/` contains TikTok session cookies.** Do not sync to iCloud/Dropbox; do not commit; do not include in shared backups.
- **First post after `npm run login` will see the two one-time TikTok modals** ("New editing features", "Turn on automatic content checks?"). The script handles them; subsequent posts will not see them.

## 9. Implementation Risks

| Risk | Mitigation |
|---|---|
| **Post-click success indicator not verified during brainstorming** | First implementation task is to do one real test post and observe what changes when Post is clicked (URL, toast, redirect, modal). Lock the success-detection logic from observation, not assumption. |
| Roll slides UI changes break selectors | Use accessible names (`getByRole('button', { name: 'Generate' })`); color-button selectors use computed RGB lookup |
| TikTok UI changes break selectors | Same pattern in `lib/tiktok.ts`. Draft.js editor falls back from `.public-DraftEditor-content` to `[role="combobox"][contenteditable="true"]` |
| Sounds editor flow is the most complex single piece | Best-effort with explicit fallback to top of For You; isolated module with its own debug script |
| TikTok detects automation via Playwright fingerprint | Launch with `--disable-blink-features=AutomationControlled` and a real user agent. If detection escalates, add `playwright-extra` + stealth plugin. |
| Race condition: two posts overlap | `lib/lockfile.ts` writes `.post.lock`; second invocation aborts if lock <10 min old |
| Disk fill from kept MP4s | 7-day pruner runs at end of each post. Cap ~100MB at current cadence. |
| Mac asleep at fire time | launchd queues missed runs and fires once on wake — acceptable behavior |
| Session cookies expire silently | `tiktok-session-expired` hard-failure auto-pauses schedule — by design |
| **High-volume risk (50–100 posts/day target)** | Out of scope for v1. Start at 10/day. The architecture supports adding times to `settings.json` and re-running `npm run schedule` — but we'll observe TikTok's reaction before scaling. |

### First-implementation spike

The **Sounds editor flow** is the riskiest single piece (full-screen editor, multi-tab, click `+`, click Save, return to upload form). The implementation plan should sequence it as a standalone module with a manual sub-script to iterate on without triggering full posts.

## 10. Out of Scope (YAGNI)

- Web dashboard, GUI, or menu bar app
- Multi-account support (single TikTok account per `browser-data/`; fork to add another)
- Topic generation by Claude (master list only)
- Per-post style randomization (one fixed style)
- Slack / email / Discord notifications (osascript only)
- Cloud deployment (Mac-only by design)
- Claude Code Routines integration (wrong fit — covered in §2)
- Analytics on which posts perform best (TikTok Studio shows that)
- Weekly health summary (deferred to v2)
- Daily Claude oversight pass (deferred to v2)

## 11. Verified During Brainstorming

The following findings come from a live walkthrough of both sites via Playwright on 2026-04-16. Any selector below has been observed in the DOM; any timing has been measured.

### Roll slides ([rent-roll-slides.vercel.app](https://rent-roll-slides.vercel.app/))

- Topic input: `getByRole('textbox')` with placeholder containing "Biggest landlord"
- Carousels combobox: first `<select>`; set value `"1"`
- Output toggle: `getByRole('button', { name: '🎬 Video' })`
- Style Mode Outline: `getByRole('button', { name: 'Outline', exact: true })`
- Color buttons have no labels; identify by computed `backgroundColor` (white = `rgb(255, 255, 255)`, black = `rgb(0, 0, 0)`)
- Choosing Outline mode renames "BG Color" → "Outline Color"
- Generate button: `getByRole('button', { name: 'Generate' })`; disabled until topic non-empty
- "Generating..." text on button while in flight
- Done state: progress text contains "Done!" AND `<video>` element appears with `src` populated
- Video data: `<video>.src` is `data:video/mp4;base64,...`; decode and write to disk
- Video properties: 1080×1920, `slidesEach * secPerSlide` seconds, ~1.2–1.4MB per 20s
- Caption block: `<div>` containing three `<p>`s — label "Caption:", body, hashtags (class `text-emerald-400`)
- Slug: regex `/·\s*([a-z0-9-]+)/` against text matching `\d+ slides ·`
- Total time observed: ~35s for 5 slides × 4s

### TikTok ([tiktok.com/tiktokstudio/upload](https://www.tiktok.com/tiktokstudio/upload))

- Auth gate: unauthenticated requests redirect to `/login?redirect_url=...`
- Login captcha: circular wheel-slider puzzle; **never automate**
- File input: hidden `<input type="file" accept="video/*">`; use `setInputFiles()`
- One-time popups (first run only): "New editing features" → "Got it"; "Turn on automatic content checks?" → "Cancel"
- Description editor: Draft.js (`.public-DraftEditor-content`, `contenteditable=true`, `aria-autocomplete="list"`)
- Description prefilled with filename — must clear via `Cmd+A` → `Delete` before typing real caption
- Hashtag autocomplete dropdown appears as you type; dismiss with `Escape`
- Hashtag tokens stay as plain text; TikTok parses them at post time (no special syntax needed)
- Caption character cap: 4000 (well above what we use)
- Location: `[role="combobox"]` with `Search locations` placeholder + chip suggestions in a row
- Settings (default): When-to-post=Now, Who-can-watch=Everyone, High-quality=on (forced)
- Settings ("Show more"): Allow Comment / Reuse of content (default on); Disclose post content (off); AI-generated content (off)
- Sounds button: in the right preview toolbar
- Sounds editor: full-screen view with title "My Multimedia Project"; tabs For You / Favorites / Unlimited / Recent; click `+` then `Save`
- Discard: `Discard` button → confirmation dialog with "Continue editing" / red `Discard`
- Action buttons: Post, Save draft, Discard at bottom of form
