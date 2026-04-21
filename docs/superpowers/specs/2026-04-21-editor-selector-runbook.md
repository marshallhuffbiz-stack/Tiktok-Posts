# TikTok Studio Editor — Selector Discovery Runbook

One `npm run capture-editor` command. About 5 minutes of your time, most of it watching a browser do the work.

## What the script does

`src/captureEditor.ts` opens Patchright with your project's logged-in `./browser-data/` profile (same path `npm run post` uses — so `setInputFiles` works and TikTok sees a legitimate session), generates a B-roll clip via `/api/broll`, attaches it through the hidden file input, waits for upload, tries to auto-click into the editor, then dumps:

- `/tmp/tiktok-editor/interactive-elements.json` — every visible button/input on the page with its best-guess selector and accessible name
- `/tmp/tiktok-editor/editor-modal-candidates.html` — outer HTML of anything looking like an editor modal
- `/tmp/tiktok-editor/page.html` — full page HTML for a fallback grep
- `/tmp/tiktok-editor/screenshot-*.png` — screenshots at each phase
- `/tmp/tiktok-editor/console.jsonl` — console messages

If it can't find an Edit button automatically, it pauses and lets you click into the editor manually, then presses Enter to continue the dump.

## Run it

From the worktree or main checkout:

```bash
cd "/Users/MarshallHuff/tiktok schedule"   # or the worktree dir
npm run capture-editor
```

The browser will:
1. Open the upload page
2. Attach a freshly-generated B-roll clip (takes ~15s to generate + ~30s to upload)
3. Take a screenshot
4. Try to auto-click into the editor
5. Take another screenshot
6. Wait at a prompt `Press Enter to dump editor DOM:`

At step 6 — if the editor is ALREADY open, just press Enter. If not, click the Edit affordance on the video preview manually, wait for the editor to open, then press Enter.

Script then dumps the artifacts and closes the browser.

## What to do with the artifacts

Paste to Claude (the most important first):

1. **`/tmp/tiktok-editor/interactive-elements.json`** — this alone is usually enough to write the selectors
2. **`/tmp/tiktok-editor/editor-modal-candidates.html`** — only if (1) is ambiguous
3. **`/tmp/tiktok-editor/screenshot-4-editor-open.png`** — only if the editor DOM structure is unclear

Claude will write `config/tiktok-editor-selectors.json` from those artifacts.

## What if `npm run capture-editor` fails before the editor opens?

Possible failure modes and fixes:

- **`OverlayGenerationFailed`** — `/api/broll` returned null hook. Re-run; the generator is flaky.
- **Upload never completes** — TikTok's "Uploaded (...)" text didn't appear in 90s. Paste the terminal output to Claude.
- **Can't find Edit button** — the script pauses at the "Press Enter" prompt. Just click Edit manually in the browser, then press Enter.

Either way the dump still runs — whatever state the page is in when you press Enter is what gets captured.

## After selectors land

```bash
npm run post -- --dry-run
```

First live attempt. `overlay.ts` throws named errors for each missing/wrong selector; paste those back and we patch iteratively.

Then when dry-run is clean:

```bash
npm run post
```

Real post. Check Posts / Drafts at tiktok.com/@rentroll.us.
