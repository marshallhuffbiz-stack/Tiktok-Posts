# TikTok Schedule

Auto-posts AI-generated videos to a single TikTok account on a schedule, from this Mac.

See [`docs/superpowers/specs/2026-04-16-tiktok-schedule-design.md`](docs/superpowers/specs/2026-04-16-tiktok-schedule-design.md) for the design.

## Setup

```bash
# 1. Install deps
npm install
npx playwright install chromium

# 2. Edit your topic master list
$EDITOR config/topics.txt

# 3. (Optional) tweak settings
$EDITOR config/settings.json

# 4. ONE-TIME TikTok login (handles the captcha manually)
npm run login

# 5. In your normal browser/app: curate ~10–20 sounds in TikTok Favorites.
#    The script picks from your Favorites tab on every post.

# 6. Smoke test
npm run post -- --dry-run    # full flow, no real post

# 7. Real first post
npm run post

# 8. Install schedule
npm run schedule
```

## Operating

```bash
npm run logs                 # tail runs.jsonl
npm run logs:errors          # show only failed runs
npm run pause                # stop the schedule
npm run resume               # re-install (alias for `npm run schedule`)
launchctl print gui/$UID/com.user.tiktokpost  # next fire time, last exit
```

## Sensitive data

- **`browser-data/` contains TikTok session cookies.** Do not sync to iCloud/Dropbox; do not commit; do not include in shared backups. The `.gitignore` excludes it.
- `config/topics.txt` and `logs/` are also gitignored.

## Failure modes & recovery

| Error | Recovery |
|---|---|
| `tiktok-session-expired` | Run `npm run login` then `npm run resume`. |
| `tiktok-account-flagged` | Investigate; schedule auto-paused. Resume only after deciding what to change. |
| `roll-slides-timeout` / `roll-slides-no-video` | Site may be down; check rent-roll-slides.vercel.app manually. |
| Other | Read `tail logs/runs.jsonl \| jq` for `errorMsg`. |

Hard failures (`session-expired`, `account-flagged`) auto-pause the schedule via `launchctl bootout`. All other failures just skip the slot.
