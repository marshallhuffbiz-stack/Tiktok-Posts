# TikTok Schedule Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the TikTok auto-posting system per the design spec at [`docs/superpowers/specs/2026-04-16-tiktok-schedule-design.md`](../specs/2026-04-16-tiktok-schedule-design.md).

**Architecture:** Node + Playwright + macOS launchd. One Node script per scheduled time (`dist/post.js`) drives a persistent browser context through roll-slides → TikTok upload, end-to-end. No daemon. Login is manual one-time.

**Tech Stack:** TypeScript (strict, ESM), Node 20, Playwright 1.59, `node:test` (built-in test runner), macOS launchd.

---

## Working Notes

- Project root: `/Users/MarshallHuff/tiktok schedule/` (note the space — quote in shell commands).
- `package.json` and `node_modules/playwright` already exist from brainstorming.
- A working prototype lives at [`scripts/grab-test-video.mjs`](../../../scripts/grab-test-video.mjs); Task 9 ports it to TypeScript.
- A test MP4 + caption already exists in `downloads/` from brainstorming; useful for TikTok-only iteration.
- All tasks use `node --test` (built-in to Node 20+) — no test framework dep.
- Commits are frequent; messages use Conventional Commits style.

---

## File Structure

```
src/
  post.ts                      # Orchestrator entry point
  login.ts                     # One-time TikTok login (headed)
  schedule.ts                  # Generates + installs launchd plist
  lib/
    types.ts                   # Shared types: Settings, RunEntry, etc.
    browser.ts                 # Persistent Playwright context helper
    topics.ts                  # Reads topics.txt, picks random topic
    log.ts                     # JSONL append + tail recent runs
    notify.ts                  # macOS notification via osascript
    lockfile.ts                # PID-based concurrency guard
    rollSlides.ts              # Drives rent-roll-slides.vercel.app
    sounds.ts                  # Sounds editor automation (Favorites + fallback)
    tiktok.ts                  # Drives tiktok.com upload (popups, file, caption, location, post)
    plist.ts                   # Pure plist string generation (split out for testability)
test/
  topics.test.ts
  log.test.ts
  notify.test.ts
  lockfile.test.ts
  plist.test.ts
config/
  topics.txt
  settings.json
README.md
.gitignore
tsconfig.json
package.json                   # MODIFY existing (add scripts, deps, type:module)
```

---

## Task 1: Git init, TypeScript config, project scaffold

**Files:**
- Create: `.gitignore`
- Create: `tsconfig.json`
- Modify: `package.json`
- Create: `src/lib/.gitkeep`, `test/.gitkeep`, `config/.gitkeep`, `logs/.gitkeep`

- [ ] **Step 1.1: Initialize git repo**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
git init -b main
```

Expected: `Initialized empty Git repository in /Users/MarshallHuff/tiktok schedule/.git/`

- [ ] **Step 1.2: Create `.gitignore`**

```
# .gitignore
node_modules/
dist/
browser-data/
downloads/
logs/*
!logs/.gitkeep
config/topics.txt
.post.lock
.playwright-mcp/
.DS_Store
*.log
*.jpeg
*.jpg
*.png
```

- [ ] **Step 1.3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": false,
    "noUncheckedIndexedAccess": true,
    "declaration": false,
    "sourceMap": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 1.4: Modify `package.json` — set `type: module`, add scripts, add devDeps**

The current `package.json` from `npm init -y` should be edited to look like this:

```json
{
  "name": "tiktok-schedule",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "node --import tsx --test test/*.test.ts",
    "post": "tsc && node dist/post.js",
    "login": "tsc && node dist/login.js",
    "schedule": "tsc && node dist/schedule.js",
    "logs": "tail -f logs/runs.jsonl | jq -c .",
    "logs:errors": "grep -E '\"status\":\"fail\"' logs/runs.jsonl | jq",
    "pause": "launchctl bootout gui/$UID/com.user.tiktokpost",
    "resume": "npm run schedule"
  },
  "dependencies": {
    "playwright": "^1.59.1"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 1.5: Install new devDeps**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
npm install --save-dev typescript @types/node tsx
```

Expected: installs without errors; `tsc --version` should print `Version 5.x.x`.

- [ ] **Step 1.6: Create empty dirs with `.gitkeep` so git tracks them**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
mkdir -p src/lib test config logs
touch src/lib/.gitkeep test/.gitkeep config/.gitkeep logs/.gitkeep
```

- [ ] **Step 1.7: Verify TypeScript compiles a hello file**

Create `src/_smoke.ts`:

```typescript
console.log('hello, tiktok schedule');
```

Run: `npx tsc && node dist/_smoke.js`
Expected: prints `hello, tiktok schedule`. Then delete the smoke file:

```bash
rm src/_smoke.ts dist/_smoke.js dist/_smoke.js.map
```

- [ ] **Step 1.8: Commit**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
git add .gitignore tsconfig.json package.json package-lock.json src/ test/ config/ logs/ scripts/ docs/
git commit -m "chore: scaffold TypeScript project + git init

Per implementation plan Task 1. Includes .gitignore, tsconfig, type:module,
build/test/post/login/schedule npm scripts, and the design spec already
written during brainstorming."
```

---

## Task 2: `src/lib/types.ts` — shared types

**Files:**
- Create: `src/lib/types.ts`

- [ ] **Step 2.1: Write the types module**

```typescript
// src/lib/types.ts

export interface Settings {
  schedule: string[]; // ["HH:MM", ...]
  rollSlides: {
    carousels: number;
    slidesEach: number;
    secPerSlide: number;
    outputMode: 'Video' | 'Images';
    styleMode: 'No BG' | 'Solid BG' | 'Semi BG' | 'Outline';
    textColor: string; // CSS color name or hex
    outlineColor: string;
    preset: string | null;
    font: string;
    size: string; // e.g. "52px"
    align: 'Left' | 'Center' | 'Right';
  };
  tiktok: {
    uploadUrl: string;
    clickFirstLocationChip: boolean;
    aiGeneratedDisclosure: boolean;
    firstRunContentChecks: 'Cancel' | 'Turn on';
  };
  antiRepeat: {
    soundLastN: number;
  };
  retention: {
    downloadsKeepDays: number;
  };
}

export type RunStatus =
  | 'success'
  | 'dry-run-success'
  | 'fail';

export type ErrorType =
  | 'roll-slides-timeout'
  | 'roll-slides-no-video'
  | 'tiktok-session-expired'
  | 'tiktok-upload-stuck'
  | 'tiktok-post-failed'
  | 'tiktok-account-flagged'
  | 'unknown-error';

export interface RunEntry {
  ts: string;                 // ISO 8601
  topic?: string;
  slug?: string;
  captionFirst80?: string;
  soundName?: string;
  soundFallback?: boolean;    // true if we used the "first For You" fallback
  location?: string;
  status: RunStatus;
  durationMs: number;
  errorType?: ErrorType;
  errorMsg?: string;
}

export interface RollSlidesResult {
  videoPath: string;
  captionPath: string;
  caption: string;
  hashtags: string;
  slug: string;
  carouselTitle: string;
}

export interface TikTokResult {
  status: 'success' | 'dry-run-success';
  postedUrl?: string;
  soundName?: string;
  soundFallback: boolean;
  location?: string;
}
```

- [ ] **Step 2.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit`
Expected: no output (no errors).

- [ ] **Step 2.3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): shared types for Settings, RunEntry, results"
```

---

## Task 3: `src/lib/topics.ts` with tests

**Files:**
- Create: `src/lib/topics.ts`
- Create: `test/topics.test.ts`

- [ ] **Step 3.1: Write the failing test**

Create `test/topics.test.ts`:

```typescript
// test/topics.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pickRandomTopic, readTopics } from '../src/lib/topics.ts';

function tmpFile(content: string): string {
  const p = path.join(os.tmpdir(), `topics-${Date.now()}-${Math.random()}.txt`);
  fs.writeFileSync(p, content);
  return p;
}

test('readTopics ignores blank lines and # comments', () => {
  const p = tmpFile([
    '# header comment',
    'topic one',
    '',
    '   ',
    '# another comment',
    'topic two',
    'topic three',
  ].join('\n'));
  const topics = readTopics(p);
  assert.deepEqual(topics, ['topic one', 'topic two', 'topic three']);
  fs.unlinkSync(p);
});

test('pickRandomTopic uses injected rng deterministically', () => {
  const p = tmpFile('a\nb\nc\nd\n');
  // rng=0 → first index, rng=0.99 → last index
  const first = pickRandomTopic(p, () => 0);
  const last = pickRandomTopic(p, () => 0.99);
  assert.equal(first, 'a');
  assert.equal(last, 'd');
  fs.unlinkSync(p);
});

test('pickRandomTopic throws on empty file', () => {
  const p = tmpFile('# comment only\n\n');
  assert.throws(() => pickRandomTopic(p), /no topics/i);
  fs.unlinkSync(p);
});
```

- [ ] **Step 3.2: Run the test to verify it fails**

Test imports `.ts` directly using tsx. Add a Node `--import tsx/esm` flag for now; we'll formalize the test command shortly.

Run:
```bash
cd "/Users/MarshallHuff/tiktok schedule"
node --import tsx --test test/topics.test.ts
```
Expected: FAIL — `Cannot find module '../src/lib/topics.ts'` (or similar).

- [ ] **Step 3.3: Write the implementation**

Create `src/lib/topics.ts`:

```typescript
// src/lib/topics.ts
import fs from 'node:fs';

export function readTopics(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

export function pickRandomTopic(
  filePath: string,
  rng: () => number = Math.random,
): string {
  const topics = readTopics(filePath);
  if (topics.length === 0) {
    throw new Error(`no topics in ${filePath}`);
  }
  const idx = Math.min(Math.floor(rng() * topics.length), topics.length - 1);
  return topics[idx]!;
}
```

- [ ] **Step 3.4: Run the test to verify it passes**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && node --import tsx --test test/topics.test.ts`
Expected: 3 passing tests.

- [ ] **Step 3.5: Update the `test` npm script to use tsx import**

In `package.json`, replace the `test` script with:

```json
"test": "node --import tsx --test test/*.test.ts"
```

Then verify:
```bash
cd "/Users/MarshallHuff/tiktok schedule" && npm test
```
Expected: 3 passing tests.

- [ ] **Step 3.6: Commit**

```bash
git add src/lib/topics.ts test/topics.test.ts package.json
git commit -m "feat(topics): readTopics + pickRandomTopic with deterministic rng

Tests cover comment/blank handling, deterministic rng injection,
and empty-file error case."
```

---

## Task 4: `src/lib/log.ts` with tests

**Files:**
- Create: `src/lib/log.ts`
- Create: `test/log.test.ts`

- [ ] **Step 4.1: Write the failing test**

```typescript
// test/log.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { appendRun, readRecentRuns } from '../src/lib/log.ts';
import type { RunEntry } from '../src/lib/types.ts';

function tmp(): string {
  return path.join(os.tmpdir(), `runs-${Date.now()}-${Math.random()}.jsonl`);
}

test('appendRun writes one JSON line per call', async () => {
  const p = tmp();
  await appendRun(p, { ts: '2026-04-16T12:00:00Z', status: 'success', durationMs: 1000 });
  await appendRun(p, { ts: '2026-04-16T13:00:00Z', status: 'fail', durationMs: 500, errorType: 'unknown-error' });
  const content = fs.readFileSync(p, 'utf8');
  const lines = content.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]!).status, 'success');
  assert.equal(JSON.parse(lines[1]!).status, 'fail');
  fs.unlinkSync(p);
});

test('readRecentRuns returns the last N entries in order', async () => {
  const p = tmp();
  for (let i = 0; i < 5; i++) {
    await appendRun(p, { ts: `2026-04-16T0${i}:00:00Z`, status: 'success', durationMs: i });
  }
  const recent = await readRecentRuns(p, 3);
  assert.equal(recent.length, 3);
  assert.deepEqual(
    recent.map(r => r.durationMs),
    [2, 3, 4],
  );
  fs.unlinkSync(p);
});

test('readRecentRuns returns [] when file does not exist', async () => {
  const recent = await readRecentRuns('/tmp/does-not-exist-xxx.jsonl', 5);
  assert.deepEqual(recent, []);
});

test('appendRun creates the file (and parent dir) if missing', async () => {
  const p = path.join(os.tmpdir(), `nested-${Date.now()}/runs.jsonl`);
  await appendRun(p, { ts: 'x', status: 'success', durationMs: 0 } as RunEntry);
  assert.ok(fs.existsSync(p));
  fs.rmSync(path.dirname(p), { recursive: true });
});
```

- [ ] **Step 4.2: Run the test to verify it fails**

Run: `npm test`
Expected: 4 failing tests in log.test.ts (module not found).

- [ ] **Step 4.3: Write the implementation**

```typescript
// src/lib/log.ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RunEntry } from './types.js';

export async function appendRun(filePath: string, entry: RunEntry): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

export async function readRecentRuns(filePath: string, n: number): Promise<RunEntry[]> {
  if (!fs.existsSync(filePath)) return [];
  const raw = await fsp.readFile(filePath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const tail = lines.slice(-n);
  return tail.map(l => JSON.parse(l) as RunEntry);
}
```

- [ ] **Step 4.4: Run the test to verify it passes**

Run: `npm test`
Expected: all log tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/lib/log.ts test/log.test.ts
git commit -m "feat(log): JSONL appendRun + readRecentRuns"
```

---

## Task 5: `src/lib/notify.ts` with tests

**Files:**
- Create: `src/lib/notify.ts`
- Create: `test/notify.test.ts`

The function calls `osascript` via `child_process.spawn`. We test the command construction by injecting a fake spawner.

- [ ] **Step 5.1: Write the failing test**

```typescript
// test/notify.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _internals, notify } from '../src/lib/notify.ts';

test('notify invokes osascript with display notification command', async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  _internals.spawn = (cmd, args) => {
    calls.push({ cmd, args });
    return {
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') setImmediate(() => cb(0));
      },
    } as never;
  };
  await notify('Test Title', 'Test body', 'Basso');
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.cmd, 'osascript');
  const script = calls[0]!.args[1]!;
  assert.match(script, /display notification "Test body"/);
  assert.match(script, /with title "Test Title"/);
  assert.match(script, /sound name "Basso"/);
});

test('notify escapes double quotes in body and title', async () => {
  const calls: { cmd: string; args: string[] }[] = [];
  _internals.spawn = (cmd, args) => {
    calls.push({ cmd, args });
    return {
      on: (event: string, cb: (code: number) => void) => {
        if (event === 'close') setImmediate(() => cb(0));
      },
    } as never;
  };
  await notify('Title with "quote"', 'Body with "quote" too');
  const script = calls[0]!.args[1]!;
  assert.match(script, /Title with \\"quote\\"/);
  assert.match(script, /Body with \\"quote\\" too/);
});
```

- [ ] **Step 5.2: Run the test to verify it fails**

Run: `npm test`
Expected: notify tests fail (module not found).

- [ ] **Step 5.3: Write the implementation**

```typescript
// src/lib/notify.ts
import { spawn } from 'node:child_process';

// Exposed for test injection.
export const _internals = { spawn };

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function notify(title: string, body: string, sound?: string): Promise<void> {
  const parts = [
    `display notification "${escape(body)}" with title "${escape(title)}"`,
  ];
  if (sound) parts.push(`sound name "${escape(sound)}"`);
  const script = parts.join(' ');
  return new Promise((resolve, reject) => {
    const child = _internals.spawn('osascript', ['-e', script]);
    child.on('close', (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(`osascript exited ${code}`));
    });
  });
}
```

- [ ] **Step 5.4: Run the test to verify it passes**

Run: `npm test`
Expected: notify tests pass.

- [ ] **Step 5.5: Manually verify a real notification fires**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
node --import tsx -e "import('./src/lib/notify.ts').then(m => m.notify('TikTok Schedule', 'Test notification — you should see this once', 'Basso'))"
```

Expected: a macOS notification banner appears in the top-right of your screen with the test title and body. (You may need to allow notifications for `Terminal` / `node` in System Settings → Notifications the first time.)

- [ ] **Step 5.6: Commit**

```bash
git add src/lib/notify.ts test/notify.test.ts
git commit -m "feat(notify): macOS notification via osascript with quote escaping"
```

---

## Task 6: `src/lib/lockfile.ts` with tests

**Files:**
- Create: `src/lib/lockfile.ts`
- Create: `test/lockfile.test.ts`

PID-based, per spec §3 (overrides the "10 min" magic number).

- [ ] **Step 6.1: Write the failing test**

```typescript
// test/lockfile.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { acquireLock, isPidAlive } from '../src/lib/lockfile.ts';

function tmp(): string {
  return path.join(os.tmpdir(), `lock-${Date.now()}-${Math.random()}.lock`);
}

test('isPidAlive returns true for current process', () => {
  assert.equal(isPidAlive(process.pid), true);
});

test('isPidAlive returns false for a definitely-dead PID', () => {
  // PID 999999999 is essentially guaranteed to not exist
  assert.equal(isPidAlive(999999999), false);
});

test('acquireLock writes our PID and returns a release function', async () => {
  const p = tmp();
  const lock = await acquireLock(p);
  const content = fs.readFileSync(p, 'utf8').trim();
  assert.equal(parseInt(content, 10), process.pid);
  await lock.release();
  assert.equal(fs.existsSync(p), false);
});

test('acquireLock throws when a lock from a live PID exists', async () => {
  const p = tmp();
  const lock = await acquireLock(p);
  await assert.rejects(acquireLock(p), /already in flight/i);
  await lock.release();
});

test('acquireLock takes over a lock with a dead PID', async () => {
  const p = tmp();
  fs.writeFileSync(p, '999999999\n', 'utf8'); // dead PID
  const lock = await acquireLock(p);
  const content = fs.readFileSync(p, 'utf8').trim();
  assert.equal(parseInt(content, 10), process.pid);
  await lock.release();
});

test('acquireLock takes over a corrupt lockfile', async () => {
  const p = tmp();
  fs.writeFileSync(p, 'not-a-pid\n', 'utf8');
  const lock = await acquireLock(p);
  await lock.release();
});
```

- [ ] **Step 6.2: Run the test to verify it fails**

Run: `npm test`
Expected: lockfile tests fail (module not found).

- [ ] **Step 6.3: Write the implementation**

```typescript
// src/lib/lockfile.ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';

export function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 doesn't actually send a signal; it just checks whether the process exists.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but we can't signal — still alive.
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

export interface Lock {
  release(): Promise<void>;
}

export async function acquireLock(filePath: string): Promise<Lock> {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    const existingPid = parseInt(existing, 10);
    if (Number.isFinite(existingPid) && isPidAlive(existingPid)) {
      throw new Error(`another post in flight (pid ${existingPid}); lock at ${filePath}`);
    }
    // Stale lock — fall through and overwrite.
  }
  await fsp.writeFile(filePath, `${process.pid}\n`, 'utf8');
  return {
    async release() {
      try {
        await fsp.unlink(filePath);
      } catch {
        // Already removed — fine.
      }
    },
  };
}
```

- [ ] **Step 6.4: Run the test to verify it passes**

Run: `npm test`
Expected: all lockfile tests pass.

- [ ] **Step 6.5: Commit**

```bash
git add src/lib/lockfile.ts test/lockfile.test.ts
git commit -m "feat(lockfile): PID-based lock with stale-lock takeover

Per spec §3 — replaces magic-number staleness check with
isPidAlive() check via signal 0."
```

---

## Task 7: `src/lib/browser.ts`

**Files:**
- Create: `src/lib/browser.ts`

Thin wrapper around Playwright's `chromium.launchPersistentContext` so other modules don't need to know the data dir path or stealth flags.

- [ ] **Step 7.1: Write the implementation**

```typescript
// src/lib/browser.ts
import { chromium, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';

export interface OpenBrowserOptions {
  /** Absolute path to the persistent data dir. Default: ./browser-data/ */
  dataDir?: string;
  /** Show the browser window. Default: false (headless). */
  headed?: boolean;
}

export interface OpenBrowserResult {
  context: BrowserContext;
  page: Page;
  /** Closes the context. Idempotent. */
  close(): Promise<void>;
}

export async function openBrowser(opts: OpenBrowserOptions = {}): Promise<OpenBrowserResult> {
  const dataDir = opts.dataDir ?? path.resolve('browser-data');
  const context = await chromium.launchPersistentContext(dataDir, {
    headless: !opts.headed,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled'],
    // 60s default action timeout; specific waits override
    timezoneId: 'America/New_York',
  });
  context.setDefaultTimeout(60_000);
  const page = context.pages()[0] ?? await context.newPage();
  let closed = false;
  return {
    context,
    page,
    async close() {
      if (closed) return;
      closed = true;
      await context.close();
    },
  };
}
```

- [ ] **Step 7.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7.3: Smoke test it opens and closes**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
node --import tsx -e "import('./src/lib/browser.ts').then(async m => { const b = await m.openBrowser(); await b.page.goto('about:blank'); console.log('OK', b.page.url()); await b.close(); })"
```

Expected: prints `OK about:blank` and exits cleanly. A `browser-data/` directory now exists.

- [ ] **Step 7.4: Commit**

```bash
git add src/lib/browser.ts
git commit -m "feat(browser): persistent Playwright context helper

Sets desktop UA, automation-control flag off, 1280x800 viewport,
60s default action timeout. Headless by default; headed for login."
```

---

## Task 8: `src/login.ts` — one-time TikTok login (headed)

**Files:**
- Create: `src/login.ts`

The user runs this once, manually solves the captcha, presses Enter when done. Cookies persist into `browser-data/`.

- [ ] **Step 8.1: Write the implementation**

```typescript
// src/login.ts
import readline from 'node:readline';
import { openBrowser } from './lib/browser.js';

async function main() {
  console.log('Opening a HEADED Chromium window for TikTok login.');
  console.log('Steps:');
  console.log('  1. Log in to TikTok in the browser window that opens.');
  console.log('  2. Solve the captcha (the wheel-slider puzzle) if prompted.');
  console.log('  3. Verify you land on a TikTok page where you are logged in');
  console.log('     (e.g. tiktok.com/foryou shows your avatar in the top-right).');
  console.log('  4. Come back here and press Enter to save the session and exit.\n');

  const browser = await openBrowser({ headed: true });
  await browser.page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded' });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>(resolve => rl.question('Press Enter when logged in: ', () => { rl.close(); resolve(); }));

  // Verify by checking for the upload page (will redirect to login if not authenticated).
  await browser.page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded' });
  if (browser.page.url().includes('/login')) {
    console.error('\n❌ Still not authenticated — the upload page redirected to /login.');
    console.error('   Cookies were not saved. Re-run `npm run login` and complete login first.');
    await browser.close();
    process.exit(1);
  }

  console.log('\n✅ Logged in. Session cookies saved to ./browser-data/');
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 8.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc`
Expected: no errors. `dist/login.js` now exists.

- [ ] **Step 8.3: Manually run it for the real one-time login**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
npm run login
```

Expected:
- A Chromium window opens at `tiktok.com/login`.
- You log in (QR code or username/password).
- You solve the captcha if prompted.
- You verify you're on a TikTok page where you can see your avatar.
- You press Enter in the terminal.
- The script verifies access to `/tiktokstudio/upload` and exits with `✅ Logged in.`

If the verification fails, the script prints an error and exits 1.

- [ ] **Step 8.4: Commit**

```bash
git add src/login.ts
git commit -m "feat(login): one-time TikTok login via headed Chromium

User completes login + captcha manually; script saves session cookies
to ./browser-data/ and verifies access to upload page before exit."
```

---

## Task 9: `src/lib/rollSlides.ts` — port from prototype

**Files:**
- Create: `src/lib/rollSlides.ts`
- Reference: `scripts/grab-test-video.mjs` (existing prototype)

The prototype script is already proven to work end-to-end. This task ports it to TypeScript with a clean function signature, parameterized over a Settings object and an existing `Page`.

- [ ] **Step 9.1: Write the implementation**

```typescript
// src/lib/rollSlides.ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import type { Settings, RollSlidesResult } from './types.js';

const URL = 'https://rent-roll-slides.vercel.app/';

interface ColorMap { [name: string]: string; }
const COLORS: ColorMap = {
  white: 'rgb(255, 255, 255)',
  black: 'rgb(0, 0, 0)',
  // Add more here as needed for other styling profiles.
};

async function clickColorButton(page: Page, sectionLabel: 'Text Color' | 'Outline Color' | 'BG Color', cssColor: string) {
  // Color buttons have no accessible labels — match by computed background.
  const matched = await page.evaluate(
    ({ label, target }) => {
      const labels = Array.from(document.querySelectorAll('div, span'))
        .filter(el => (el.textContent || '').trim() === label);
      if (labels.length === 0) throw new Error(`label not found: ${label}`);
      const labelEl = labels[0]!;
      const container = labelEl.parentElement?.querySelector('div + div, .flex')!;
      const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
      for (let i = 0; i < buttons.length; i++) {
        const bg = getComputedStyle(buttons[i]!).backgroundColor;
        if (bg === target) {
          buttons[i]!.click();
          return i;
        }
      }
      throw new Error(`no button with bg ${target} under ${label}`);
    },
    { label: sectionLabel, target: cssColor },
  );
  return matched;
}

export async function generateVideo(
  page: Page,
  topic: string,
  settings: Settings,
  outDir: string,
): Promise<RollSlidesResult> {
  await fsp.mkdir(outDir, { recursive: true });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Form: carousels = 1
  await page.locator('select').first().selectOption(String(settings.rollSlides.carousels));
  // Output mode
  await page.getByRole('button', { name: settings.rollSlides.outputMode === 'Video' ? '🎬 Video' : '📷 Images' }).click();
  // Style mode
  await page.getByRole('button', { name: settings.rollSlides.styleMode, exact: true }).click();
  // Text color
  const textColorRgb = COLORS[settings.rollSlides.textColor];
  if (!textColorRgb) throw new Error(`unsupported textColor: ${settings.rollSlides.textColor}`);
  await clickColorButton(page, 'Text Color', textColorRgb);
  // Outline / BG color: label depends on style mode
  const outlineLabel = settings.rollSlides.styleMode === 'Outline' ? 'Outline Color' : 'BG Color';
  const outlineColorRgb = COLORS[settings.rollSlides.outlineColor];
  if (!outlineColorRgb) throw new Error(`unsupported outlineColor: ${settings.rollSlides.outlineColor}`);
  await clickColorButton(page, outlineLabel, outlineColorRgb);

  // Topic
  await page.getByRole('textbox').fill(topic);

  // Generate
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  // Wait for video element with populated data URL (more reliable than waiting for "Done!" text)
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video') as HTMLVideoElement | null;
      return !!(v && v.src && v.src.startsWith('data:video/mp4;base64,'));
    },
    null,
    { timeout: 180_000 },
  );

  // Extract video src and write to disk INSIDE Node (large string, can't ferry through return)
  // We use page.evaluate to fetch the data URL, then decode in Node.
  const dataUrl = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).src);
  if (!dataUrl.startsWith('data:video/mp4;base64,')) {
    throw new Error(`unexpected video src prefix: ${dataUrl.slice(0, 40)}`);
  }
  const buf = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  // Slug from "5 slides · slug-text"
  const slug = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('p'));
    const slugLine = ps.map(p => p.textContent || '').find(t => /\d+ slides ·/.test(t)) || '';
    const m = slugLine.match(/·\s*([a-z0-9-]+)/);
    return m ? m[1] : 'video';
  });

  // Caption + hashtags from the "Caption:" block
  const captionData = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('p'));
    const idx = ps.findIndex(p => (p.textContent || '').trim() === 'Caption:');
    if (idx < 0) return null;
    return {
      body: (ps[idx + 1]?.textContent || '').trim(),
      tags: (ps[idx + 2]?.textContent || '').trim(),
    };
  });
  if (!captionData) throw new Error('caption block not found on page');

  // Carousel title (h3 above the slug)
  const carouselTitle = await page.evaluate(() => {
    const h3 = document.querySelector('h3');
    return h3?.textContent?.trim() ?? '';
  });

  const ts = Date.now();
  const filename = `${ts}-${slug}.mp4`;
  const videoPath = path.join(outDir, filename);
  fs.writeFileSync(videoPath, buf);

  const captionFull = `${captionData.body}\n\n${captionData.tags}`;
  const captionPath = videoPath.replace(/\.mp4$/, '.caption.txt');
  fs.writeFileSync(captionPath, captionFull);

  return {
    videoPath,
    captionPath,
    caption: captionFull,
    hashtags: captionData.tags,
    slug: slug || 'video',
    carouselTitle,
  };
}
```

- [ ] **Step 9.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 9.3: Commit**

```bash
git add src/lib/rollSlides.ts
git commit -m "feat(rollSlides): port prototype to TS, parameterize on Settings

Selectors verified during brainstorming walkthrough. Color picking uses
computed RGB lookup since color buttons have no accessible labels.
Outline mode renames BG Color → Outline Color (handled)."
```

---

## Task 10: Standalone roll-slides verification

**Files:** none new — runs `lib/rollSlides.ts` against the real site.

- [ ] **Step 10.1: Create a temporary verification script**

Create `scripts/verify-rollslides.mjs`:

```javascript
// scripts/verify-rollslides.mjs
import { openBrowser } from '../src/lib/browser.ts';
import { generateVideo } from '../src/lib/rollSlides.ts';

const settings = {
  rollSlides: {
    carousels: 1,
    slidesEach: 5,
    secPerSlide: 4,
    outputMode: 'Video',
    styleMode: 'Outline',
    textColor: 'white',
    outlineColor: 'black',
    preset: null,
    font: 'Classic',
    size: '52px',
    align: 'Center',
  },
};

const browser = await openBrowser();
try {
  console.log('Generating video for "5 red flags in tenant applications"...');
  const result = await generateVideo(browser.page, '5 red flags in tenant applications', settings, 'downloads');
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
```

- [ ] **Step 10.2: Run it**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
node --import tsx scripts/verify-rollslides.mjs
```

Expected: ~35–60s of execution; final output is a JSON object with `videoPath`, `captionPath`, `caption`, `hashtags`, `slug`, `carouselTitle`. The MP4 exists at `videoPath` and is ~1.0–1.5MB. The `.caption.txt` exists at `captionPath`.

- [ ] **Step 10.3: Inspect the output**

```bash
ls -la downloads/
cat downloads/*.caption.txt | tail -20
```

Expected: an MP4 + a caption file with body + hashtags.

- [ ] **Step 10.4: Delete the verification script (it's served its purpose)**

```bash
rm scripts/verify-rollslides.mjs
```

- [ ] **Step 10.5: Commit**

```bash
git add downloads/.gitkeep 2>/dev/null || true
git commit --allow-empty -m "test(rollSlides): verified end-to-end against live site

Generated a real video + caption against rent-roll-slides.vercel.app
in ~45s. Output written to downloads/. No code change."
```

---

## Task 11: SPIKE — observe TikTok Post-click success indicator

**Files:** none — investigation only. Output is a note in this plan that locks in the success-detection logic for Task 15.

The brainstorming walkthrough discarded before Post; we never observed what happens after a successful Post. Per spec §9, this is the first risk to retire.

- [ ] **Step 11.1: Pick a "throwaway" video for the test**

Use the latest MP4 in `downloads/` from Task 10. Confirm caption file exists:

```bash
ls -la downloads/*.mp4 downloads/*.caption.txt
```

- [ ] **Step 11.2: Manual upload via TikTok Studio in your normal browser**

In your normal Chrome (not via this script):
1. Go to `https://www.tiktok.com/tiktokstudio/upload`
2. Drag in the test MP4
3. Type a caption (use the body from `.caption.txt`)
4. Click the first location chip (whatever is suggested for you)
5. Click Sounds → Favorites → pick any sound → Save (or skip if you have no Favorites set up yet)
6. Click **Post**
7. **Observe and write down what happens:**
   - Does the URL change? To what?
   - Is there a success toast / modal? What does it say?
   - Does the page redirect after a delay?
   - How long until you can tell the post succeeded?

- [ ] **Step 11.3: Open Chrome DevTools BEFORE clicking Post (Network tab) for the next post and note the API call(s)**

- Look for a request to a URL like `/api/v1/web/aweme/post/` or similar
- Note the response status (200 expected)
- Note any response body field that signals success (e.g. `aweme_id`, `status_code: 0`)

- [ ] **Step 11.4: Document the findings inline in this plan**

Edit this file (`docs/superpowers/plans/2026-04-16-tiktok-schedule-implementation.md`) and replace the placeholder block below with your actual observations:

```
SPIKE FINDINGS (Task 11):
  Post-click URL change:        <write what URL it changes to, or "no change">
  Post-click toast text:        <write the exact toast text, or "no toast">
  Post-click redirect delay:    <write seconds, or "no redirect">
  Network success signal:       <write the URL pattern + response field>
  Recommended success detector: <pick ONE: url-change | toast-text | network-response>
```

The chosen detector becomes the canonical success check in Task 15.

- [ ] **Step 11.5: Commit the spike findings**

```bash
git add docs/superpowers/plans/2026-04-16-tiktok-schedule-implementation.md
git commit -m "docs(plan): record TikTok Post-click success spike findings"
```

---

## Task 12: `src/lib/tiktok.ts` — popup dismissal + file attach + caption

**Files:**
- Create: `src/lib/tiktok.ts`

This is the start of the TikTok module. We build it incrementally over Tasks 12–16.

- [ ] **Step 12.1: Write the initial module skeleton**

```typescript
// src/lib/tiktok.ts
import type { Page } from 'playwright';
import type { Settings, TikTokResult } from './types.js';

export class SessionExpiredError extends Error {
  constructor() { super('TikTok session expired'); this.name = 'SessionExpiredError'; }
}

const UPLOAD_URL = 'https://www.tiktok.com/tiktokstudio/upload';

/**
 * Navigates to the upload page. Throws SessionExpiredError if redirected to /login.
 * Dismisses any first-run popups ("New editing features", "Turn on automatic content checks").
 */
export async function openUploadPage(page: Page, settings: Settings): Promise<void> {
  await page.goto(UPLOAD_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (page.url().includes('/login')) throw new SessionExpiredError();

  // Dismiss the two known first-run popups, with very short timeouts because they may not appear.
  await tryClickButton(page, 'Got it', 3_000);
  if (settings.tiktok.firstRunContentChecks === 'Cancel') {
    await tryClickButton(page, 'Cancel', 3_000);
  } else {
    await tryClickButton(page, 'Turn on', 3_000);
  }
}

async function tryClickButton(page: Page, name: string, timeoutMs: number): Promise<boolean> {
  try {
    await page.getByRole('button', { name }).first().click({ timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Uploads the MP4 via the hidden file input and waits for "Uploaded" indicator.
 */
export async function attachVideo(page: Page, mp4Path: string): Promise<void> {
  const input = page.locator('input[type="file"][accept="video/*"]').first();
  await input.setInputFiles(mp4Path);
  // The "Uploaded（XMB）" text appears once the upload completes.
  await page.getByText(/Uploaded\s*[（(]/).waitFor({ timeout: 90_000 });
}

/**
 * Replaces the auto-prefilled (filename) caption with the real caption.
 * The Description editor is Draft.js; we cannot fill() — must select-all + delete + insertText.
 */
export async function setCaption(page: Page, caption: string): Promise<void> {
  const editor = page.locator('.public-DraftEditor-content').first();
  await editor.click();
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Delete');
  await page.keyboard.insertText(caption);
  await page.keyboard.press('Escape'); // dismiss hashtag autocomplete
}
```

- [ ] **Step 12.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 12.3: Commit**

```bash
git add src/lib/tiktok.ts
git commit -m "feat(tiktok): openUploadPage + attachVideo + setCaption

Handles first-run popup dismissal and Draft.js editor replacement.
Throws SessionExpiredError on /login redirect."
```

---

## Task 13: `src/lib/tiktok.ts` — location picker

**Files:**
- Modify: `src/lib/tiktok.ts`

- [ ] **Step 13.1: Add `setFirstLocationChip` to the module**

Append to `src/lib/tiktok.ts`:

```typescript
/**
 * Clicks the first chip in the row of suggested locations under "Search locations".
 * Returns the location name, or null if no chips were available.
 */
export async function setFirstLocationChip(page: Page): Promise<string | null> {
  // Locate the "Location" label, then the suggestion list directly below it.
  // Chips are <li><div>Name</div></li> — the last item ("Advance") is a "see more" link, skip it.
  const result = await page.evaluate(() => {
    const labels = Array.from(document.querySelectorAll('div, span'))
      .filter(el => (el.textContent || '').trim() === 'Location' && el.children.length === 0);
    if (labels.length === 0) return { clicked: false, reason: 'no Location label' };
    const labelParent = labels[0]!.parentElement?.parentElement;
    if (!labelParent) return { clicked: false, reason: 'no parent' };
    const list = labelParent.querySelector('ul, [role="list"]') as HTMLElement | null;
    if (!list) return { clicked: false, reason: 'no chip list' };
    const items = Array.from(list.querySelectorAll('li')) as HTMLLIElement[];
    // Filter out the "Advance" / "See more" entry by checking text length / known label.
    const usable = items.filter(li => {
      const t = (li.textContent || '').trim();
      return t.length > 0 && t.toLowerCase() !== 'advance';
    });
    if (usable.length === 0) return { clicked: false, reason: 'no usable chips' };
    const first = usable[0]!;
    const text = (first.textContent || '').trim();
    (first as HTMLElement).click();
    return { clicked: true, name: text };
  });
  if (!result.clicked) return null;
  return result.name ?? null;
}
```

- [ ] **Step 13.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 13.3: Commit**

```bash
git add src/lib/tiktok.ts
git commit -m "feat(tiktok): setFirstLocationChip — click first suggested chip

Skips the 'Advance' link at the end of the list."
```

---

## Task 14: `src/lib/sounds.ts` — Favorites + fallback (HIGHEST RISK)

**Files:**
- Create: `src/lib/sounds.ts`

Per spec §11, this is the most fragile single piece. We build it isolated with explicit fallback.

- [ ] **Step 14.1: Write the implementation**

```typescript
// src/lib/sounds.ts
import type { Page } from 'playwright';
import type { RunEntry } from './types.js';

export interface SoundPickResult {
  soundName: string;
  fallback: boolean;
}

/**
 * Opens the Sounds editor, picks the least-recently-used sound from Favorites
 * (filtering against `recentRuns`), saves, and returns. On any failure, falls back
 * to the first sound in the For You tab (the editor's default tab).
 */
export async function pickSound(
  page: Page,
  recentRuns: RunEntry[],
  antiRepeatN: number,
): Promise<SoundPickResult> {
  // Open the Sounds editor.
  await page.getByRole('button', { name: 'Sounds' }).click();
  // The editor view is identifiable by the title becoming "My Multimedia Project".
  await page.getByText('My Multimedia Project').waitFor({ timeout: 30_000 });

  const recentSoundNames = new Set(
    recentRuns
      .slice(-antiRepeatN)
      .map(r => r.soundName)
      .filter((n): n is string => Boolean(n)),
  );

  try {
    const picked = await pickFromFavorites(page, recentSoundNames);
    if (picked) {
      await saveSoundEditor(page);
      return { soundName: picked, fallback: false };
    }
    // No usable favorite — fall through to fallback.
  } catch {
    // Selector miss, click failed, etc. — fall through.
  }

  const fallback = await pickFirstForYou(page);
  await saveSoundEditor(page);
  return { soundName: fallback, fallback: true };
}

async function pickFromFavorites(page: Page, recentNames: Set<string>): Promise<string | null> {
  // Click the Favorites tab.
  await page.getByText('Favorites', { exact: true }).click();
  await page.waitForTimeout(800); // let list render

  // Read the visible sound items. Each item shows: thumbnail + name + duration · artist + "+" button.
  const candidates = await page.evaluate(() => {
    // Look for "+" buttons in the sounds panel; each one is associated with a sound row.
    const plusButtons = Array.from(document.querySelectorAll('button'))
      .filter(b => (b.textContent || '').trim() === '+' || (b.textContent || '').trim() === '＋');
    return plusButtons.map((btn, idx) => {
      // Walk up to the row container, then read the strong/heading-ish text inside it.
      const row = btn.closest('div[class*="item"], li, .sound-item, div[class*="row"]') ?? btn.parentElement;
      const titleEl = row?.querySelector('strong, h4, h5, [class*="title"], [class*="name"]');
      const name = titleEl?.textContent?.trim() || (row?.textContent || '').trim().split('\n')[0] || `unknown-${idx}`;
      return { name: name.slice(0, 80) };
    });
  });

  if (candidates.length === 0) return null;

  // Pick least-recently-used: first candidate not in the recent set, else the first overall.
  const usable = candidates.find(c => !recentNames.has(c.name)) ?? candidates[0]!;

  // Click the "+" for the chosen item, by its index in the list of plus buttons.
  const idx = candidates.indexOf(usable);
  await page.evaluate((targetIdx) => {
    const plusButtons = Array.from(document.querySelectorAll('button'))
      .filter(b => (b.textContent || '').trim() === '+' || (b.textContent || '').trim() === '＋');
    plusButtons[targetIdx]?.click();
  }, idx);

  await page.waitForTimeout(500);
  return usable.name;
}

async function pickFirstForYou(page: Page): Promise<string> {
  // Switch to For You (default tab — clicking is harmless if already there).
  await page.getByText('For You', { exact: true }).click();
  await page.waitForTimeout(800);
  const result = await page.evaluate(() => {
    const plusButtons = Array.from(document.querySelectorAll('button'))
      .filter(b => (b.textContent || '').trim() === '+' || (b.textContent || '').trim() === '＋');
    if (plusButtons.length === 0) throw new Error('no sounds in For You');
    const btn = plusButtons[0]!;
    const row = btn.closest('div[class*="item"], li, .sound-item, div[class*="row"]') ?? btn.parentElement;
    const titleEl = row?.querySelector('strong, h4, h5, [class*="title"], [class*="name"]');
    const name = titleEl?.textContent?.trim() || (row?.textContent || '').trim().split('\n')[0] || 'unknown';
    btn.click();
    return name.slice(0, 80);
  });
  await page.waitForTimeout(500);
  return result;
}

async function saveSoundEditor(page: Page): Promise<void> {
  // Click the top-right Save button. Use a locator scoped to the editor toolbar.
  await page.getByRole('button', { name: 'Save' }).click();
  // After save, the editor closes and we return to the upload form. The "Description" label reappears.
  await page.getByText('Description', { exact: true }).waitFor({ timeout: 30_000 });
}
```

- [ ] **Step 14.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 14.3: Commit**

```bash
git add src/lib/sounds.ts
git commit -m "feat(sounds): Favorites tab + LRU + fallback to first For You

Highest-risk module per spec §11. Fallback path runs unconditionally
on any failure during the Favorites flow."
```

- [ ] **Step 14.4: Spike-test it standalone (no real post)**

Create `scripts/verify-sounds.mjs`:

```javascript
import { openBrowser } from '../src/lib/browser.ts';
import { openUploadPage, attachVideo } from '../src/lib/tiktok.ts';
import { pickSound } from '../src/lib/sounds.ts';
import fs from 'node:fs';

const settings = {
  tiktok: { uploadUrl: 'https://www.tiktok.com/tiktokstudio/upload', firstRunContentChecks: 'Cancel' },
};
const mp4 = fs.readdirSync('downloads').find(f => f.endsWith('.mp4'));
if (!mp4) { console.error('No MP4 in downloads/'); process.exit(1); }

const browser = await openBrowser();
try {
  await openUploadPage(browser.page, settings);
  await attachVideo(browser.page, `downloads/${mp4}`);
  const result = await pickSound(browser.page, [], 8);
  console.log('SOUND PICKED:', result);
  await new Promise(r => setTimeout(r, 5000)); // visual hold
} finally {
  await browser.close();
}
```

Run:
```bash
cd "/Users/MarshallHuff/tiktok schedule"
node --import tsx scripts/verify-sounds.mjs
```

Expected: a sound is picked from Favorites (or fallback), and the script prints `SOUND PICKED: { soundName: '...', fallback: false }` (or true). After 5s the browser closes.

- [ ] **Step 14.5: Iterate on selectors if the spike fails**

If `pickSound` fails:
- Re-read the editor DOM with a temporary snapshot in the spike script
- Adjust the selectors in `src/lib/sounds.ts` accordingly
- Re-run until it succeeds for both Favorites (with at least one favorite present) and an empty-Favorites fallback case

- [ ] **Step 14.6: Delete the spike script and commit**

```bash
rm scripts/verify-sounds.mjs
git add src/lib/sounds.ts
git commit --allow-empty -m "test(sounds): verified Favorites pick + fallback against live TikTok"
```

---

## Task 15: `src/lib/tiktok.ts` — Post click + success detection

**Files:**
- Modify: `src/lib/tiktok.ts`

Use the success-detection mechanism locked in by Task 11's spike.

- [ ] **Step 15.1: Add `clickPost` and `waitForPostSuccess` to the module**

Append to `src/lib/tiktok.ts`. **Choose the body of `waitForPostSuccess` based on Task 11's spike findings.** The template below shows three possible implementations — keep the one matching the spike's "Recommended success detector":

```typescript
export class PostFailedError extends Error {
  constructor(reason: string) { super(`post failed: ${reason}`); this.name = 'PostFailedError'; }
}

export async function clickPost(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Post$/ }).click();
}

/**
 * Waits for evidence that the post succeeded. Throws PostFailedError on timeout.
 * The detector body is determined by Task 11's spike findings.
 */
export async function waitForPostSuccess(page: Page): Promise<void> {
  // OPTION A — URL change (uncomment if spike chose url-change):
  // await page.waitForURL(url => !url.toString().includes('/upload'), { timeout: 60_000 });

  // OPTION B — toast text (uncomment + adjust text if spike chose toast-text):
  // await page.getByText(/posted|published|success/i).waitFor({ timeout: 60_000 });

  // OPTION C — network response (uncomment + adjust pattern if spike chose network-response):
  // const resp = await page.waitForResponse(r => r.url().includes('<api-pattern-from-spike>'), { timeout: 60_000 });
  // const body = await resp.json();
  // if (body.status_code !== 0) throw new PostFailedError(`status_code=${body.status_code}`);

  throw new Error('waitForPostSuccess: pick option A/B/C from Task 11 spike findings and remove this throw');
}
```

After picking the option, the throw line is removed.

- [ ] **Step 15.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 15.3: Commit**

```bash
git add src/lib/tiktok.ts
git commit -m "feat(tiktok): clickPost + waitForPostSuccess

Success detector mechanism chosen from Task 11 spike findings."
```

---

## Task 16: `src/lib/tiktok.ts` — discard helper for `--dry-run`

**Files:**
- Modify: `src/lib/tiktok.ts`

- [ ] **Step 16.1: Add `discardUpload` to the module**

Append to `src/lib/tiktok.ts`:

```typescript
/**
 * Clicks Discard, then confirms in the dialog. Used for --dry-run smoke tests.
 */
export async function discardUpload(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^Discard$/ }).first().click();
  // Dialog appears; click the destructive Discard inside it.
  await page.locator('div[role="dialog"]').getByRole('button', { name: /^Discard$/ }).click();
  await page.waitForTimeout(1500);
}
```

- [ ] **Step 16.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 16.3: Commit**

```bash
git add src/lib/tiktok.ts
git commit -m "feat(tiktok): discardUpload helper for dry-run path"
```

---

## Task 17: `src/post.ts` — orchestrator

**Files:**
- Create: `src/post.ts`

This is the entry point launchd will fire.

- [ ] **Step 17.1: Write the implementation**

```typescript
// src/post.ts
import fs from 'node:fs';
import path from 'node:path';
import { openBrowser } from './lib/browser.js';
import { pickRandomTopic } from './lib/topics.js';
import { generateVideo } from './lib/rollSlides.js';
import {
  openUploadPage,
  attachVideo,
  setCaption,
  setFirstLocationChip,
  clickPost,
  waitForPostSuccess,
  discardUpload,
  SessionExpiredError,
  PostFailedError,
} from './lib/tiktok.js';
import { pickSound } from './lib/sounds.js';
import { appendRun, readRecentRuns } from './lib/log.js';
import { notify } from './lib/notify.js';
import { acquireLock } from './lib/lockfile.js';
import { spawnSync } from 'node:child_process';
import type { Settings, RunEntry, ErrorType } from './lib/types.js';

const ROOT = process.cwd();
const SETTINGS_PATH = path.join(ROOT, 'config', 'settings.json');
const TOPICS_PATH = path.join(ROOT, 'config', 'topics.txt');
const LOG_PATH = path.join(ROOT, 'logs', 'runs.jsonl');
const LOCK_PATH = path.join(ROOT, '.post.lock');
const DOWNLOADS_DIR = path.join(ROOT, 'downloads');
const BROWSER_DATA = path.join(ROOT, 'browser-data');

function classify(err: unknown): ErrorType {
  if (err instanceof SessionExpiredError) return 'tiktok-session-expired';
  if (err instanceof PostFailedError) return 'tiktok-post-failed';
  const msg = (err as Error)?.message ?? '';
  if (/no topics/i.test(msg)) return 'unknown-error';
  if (/Generate.*timeout|waitForFunction.*timeout/i.test(msg)) return 'roll-slides-timeout';
  if (/unexpected video src/i.test(msg)) return 'roll-slides-no-video';
  if (/Uploaded.*timeout/i.test(msg)) return 'tiktok-upload-stuck';
  if (/violat|community guidelines|rate limit/i.test(msg)) return 'tiktok-account-flagged';
  return 'unknown-error';
}

function isHardFailure(t: ErrorType): boolean {
  return t === 'tiktok-session-expired' || t === 'tiktok-account-flagged';
}

function pauseSchedule(): void {
  const uid = process.getuid?.() ?? 0;
  spawnSync('launchctl', ['bootout', `gui/${uid}/com.user.tiktokpost`]);
}

function pruneOldDownloads(maxAgeDays: number): void {
  if (!fs.existsSync(DOWNLOADS_DIR)) return;
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  for (const f of fs.readdirSync(DOWNLOADS_DIR)) {
    const p = path.join(DOWNLOADS_DIR, f);
    try {
      const stat = fs.statSync(p);
      if (stat.mtimeMs < cutoff) fs.unlinkSync(p);
    } catch { /* ignore */ }
  }
}

async function main() {
  const startTs = Date.now();
  const isDryRun = process.argv.includes('--dry-run');

  // Pre-flight
  if (!fs.existsSync(BROWSER_DATA)) {
    await notify('TikTok Schedule', 'browser-data/ missing — run `npm run login`', 'Basso');
    process.exit(1);
  }
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Settings;
  const lock = await acquireLock(LOCK_PATH).catch(async err => {
    console.error(err.message);
    process.exit(1);
  }) as { release(): Promise<void> };

  let entry: RunEntry = { ts: new Date().toISOString(), status: 'fail', durationMs: 0 };
  const browser = await openBrowser();

  try {
    const topic = pickRandomTopic(TOPICS_PATH);
    entry.topic = topic;

    // Roll slides
    const rs = await generateVideo(browser.page, topic, settings, DOWNLOADS_DIR);
    entry.slug = rs.slug;
    entry.captionFirst80 = rs.caption.slice(0, 80);

    // TikTok
    await openUploadPage(browser.page, settings);
    await attachVideo(browser.page, rs.videoPath);
    await setCaption(browser.page, rs.caption);

    if (settings.tiktok.clickFirstLocationChip) {
      const loc = await setFirstLocationChip(browser.page);
      if (loc) entry.location = loc;
    }

    const recent = await readRecentRuns(LOG_PATH, 50);
    const sound = await pickSound(browser.page, recent, settings.antiRepeat.soundLastN);
    entry.soundName = sound.soundName;
    entry.soundFallback = sound.fallback;

    if (isDryRun) {
      await discardUpload(browser.page);
      entry.status = 'dry-run-success';
    } else {
      await clickPost(browser.page);
      await waitForPostSuccess(browser.page);
      entry.status = 'success';
    }
  } catch (err) {
    const errorType = classify(err);
    entry.status = 'fail';
    entry.errorType = errorType;
    entry.errorMsg = (err as Error).message?.slice(0, 200);
    await notify('TikTok Schedule', `${errorType}: ${entry.errorMsg ?? ''}`.slice(0, 200), 'Basso');
    if (isHardFailure(errorType)) {
      await notify('TikTok Schedule', 'Schedule auto-paused. Fix and run `npm run resume`.', 'Basso');
      pauseSchedule();
    }
  } finally {
    entry.durationMs = Date.now() - startTs;
    try { await appendRun(LOG_PATH, entry); } catch { /* ignore log errors */ }
    await browser.close();
    pruneOldDownloads(settings.retention.downloadsKeepDays);
    await lock.release();
  }

  process.exit(entry.status === 'fail' ? 1 : 0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 17.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 17.3: Commit**

```bash
git add src/post.ts
git commit -m "feat(post): orchestrator entry point with --dry-run support

Pre-flight checks (browser-data, lock); roll slides → TikTok → log.
Failure taxonomy → notify + auto-pause on hard failures."
```

---

## Task 18: Real `--dry-run` smoke test

- [ ] **Step 18.1: Ensure `config/settings.json` exists with defaults**

Create `config/settings.json`:

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
  "antiRepeat": { "soundLastN": 8 },
  "retention": { "downloadsKeepDays": 7 }
}
```

- [ ] **Step 18.2: Ensure `config/topics.txt` has at least 3 topics**

Create `config/topics.txt`:

```
# Real estate / rental property topics. Add more as you go — aim for 50+.
Biggest landlord screening mistakes
5 red flags in tenant applications
Why you should never skip a rent roll review
```

- [ ] **Step 18.3: Run the dry run**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
npm run post -- --dry-run
```

Expected:
- `tsc` builds (no errors).
- Console output is silent except for any errors.
- Total time: ~90–120s.
- A new MP4 appears in `downloads/`.
- A new line appears in `logs/runs.jsonl` with `"status":"dry-run-success"`.
- No new TikTok post appears in your account.

- [ ] **Step 18.4: Inspect the log**

```bash
tail -1 logs/runs.jsonl | jq
```

Expected: a JSON object with `status: "dry-run-success"`, a `soundName`, `location`, and a `durationMs` in the 90000–120000 range.

- [ ] **Step 18.5: Iterate on any failures**

If the dry run fails:
- Read the `errorType` and `errorMsg` from the log entry.
- Fix the relevant module (`tiktok.ts`, `sounds.ts`, etc.).
- Re-run until `dry-run-success`.

- [ ] **Step 18.6: Commit any selector fixes from iteration**

```bash
git add src/lib/
git commit -m "fix(tiktok|sounds): selector adjustments from dry-run iteration" 2>/dev/null || echo "Nothing to commit"
```

---

## Task 19: Real first post smoke test

⚠️ This task posts a REAL video to your TikTok account. It will be visible publicly. Skip or roll back if you don't want a post.

- [ ] **Step 19.1: Run a real post**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
npm run post
```

Expected:
- Total time: ~90–120s.
- A new MP4 in `downloads/`.
- A new line in `logs/runs.jsonl` with `"status":"success"`.
- A new post visible on your TikTok profile within 1–2 minutes.

- [ ] **Step 19.2: Verify in TikTok Studio**

Open `https://www.tiktok.com/tiktokstudio/content` in your normal browser. The new post should appear in the feed.

- [ ] **Step 19.3: Commit a celebratory empty marker**

```bash
git commit --allow-empty -m "chore: first end-to-end success — real post via npm run post"
```

---

## Task 20: `src/lib/plist.ts` + tests

**Files:**
- Create: `src/lib/plist.ts`
- Create: `test/plist.test.ts`

Pure plist string generator, easy to test.

- [ ] **Step 20.1: Write the failing test**

```typescript
// test/plist.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generatePlist } from '../src/lib/plist.ts';

test('generatePlist produces valid xml with expected entries', () => {
  const xml = generatePlist({
    label: 'com.user.tiktokpost',
    nodePath: '/usr/local/bin/node',
    scriptPath: '/Users/me/proj/dist/post.js',
    workingDir: '/Users/me/proj',
    times: ['08:17', '14:11'],
    stdoutPath: '/Users/me/proj/logs/launchd.out.log',
    stderrPath: '/Users/me/proj/logs/launchd.err.log',
  });
  assert.match(xml, /<\?xml version="1\.0"/);
  assert.match(xml, /<key>Label<\/key><string>com\.user\.tiktokpost<\/string>/);
  assert.match(xml, /<string>\/usr\/local\/bin\/node<\/string>/);
  assert.match(xml, /<key>Hour<\/key><integer>8<\/integer><key>Minute<\/key><integer>17<\/integer>/);
  assert.match(xml, /<key>Hour<\/key><integer>14<\/integer><key>Minute<\/key><integer>11<\/integer>/);
  assert.match(xml, /<key>RunAtLoad<\/key><false\/>/);
});

test('generatePlist throws on bad time format', () => {
  assert.throws(() => generatePlist({
    label: 'x', nodePath: '/n', scriptPath: '/s', workingDir: '/w',
    times: ['not-a-time'], stdoutPath: '/o', stderrPath: '/e',
  }), /invalid time/i);
});
```

- [ ] **Step 20.2: Run the test to verify it fails**

Run: `npm test`
Expected: plist tests fail (module not found).

- [ ] **Step 20.3: Write the implementation**

```typescript
// src/lib/plist.ts

export interface PlistInput {
  label: string;
  nodePath: string;
  scriptPath: string;
  workingDir: string;
  times: string[]; // "HH:MM"
  stdoutPath: string;
  stderrPath: string;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function parseTime(t: string): { h: number; m: number } {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) throw new Error(`invalid time format: ${t}`);
  const h = parseInt(m[1]!, 10);
  const min = parseInt(m[2]!, 10);
  if (h < 0 || h > 23 || min < 0 || min > 59) throw new Error(`invalid time: ${t}`);
  return { h, m: min };
}

export function generatePlist(input: PlistInput): string {
  const calendarEntries = input.times.map(t => {
    const { h, m } = parseTime(t);
    return `    <dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${escapeXml(input.label)}</string>
  <key>ProgramArguments</key><array>
    <string>${escapeXml(input.nodePath)}</string>
    <string>${escapeXml(input.scriptPath)}</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(input.workingDir)}</string>
  <key>StartCalendarInterval</key><array>
${calendarEntries}
  </array>
  <key>RunAtLoad</key><false/>
  <key>StandardOutPath</key><string>${escapeXml(input.stdoutPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(input.stderrPath)}</string>
</dict></plist>
`;
}
```

- [ ] **Step 20.4: Run the test to verify it passes**

Run: `npm test`
Expected: plist tests pass; all earlier tests still pass.

- [ ] **Step 20.5: Commit**

```bash
git add src/lib/plist.ts test/plist.test.ts
git commit -m "feat(plist): pure launchd plist string generator with tests"
```

---

## Task 21: `src/schedule.ts` — install / reload via launchctl

**Files:**
- Create: `src/schedule.ts`

- [ ] **Step 21.1: Write the implementation**

```typescript
// src/schedule.ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { generatePlist } from './lib/plist.js';
import type { Settings } from './lib/types.js';

const LABEL = 'com.user.tiktokpost';
const ROOT = process.cwd();
const SETTINGS_PATH = path.join(ROOT, 'config', 'settings.json');
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

async function main() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Settings;
  const nodePath = process.execPath;
  const scriptPath = path.join(ROOT, 'dist', 'post.js');
  const stdoutPath = path.join(ROOT, 'logs', 'launchd.out.log');
  const stderrPath = path.join(ROOT, 'logs', 'launchd.err.log');

  const xml = generatePlist({
    label: LABEL,
    nodePath,
    scriptPath,
    workingDir: ROOT,
    times: settings.schedule,
    stdoutPath,
    stderrPath,
  });

  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, xml, 'utf8');
  console.log(`Wrote plist to ${PLIST_PATH}`);

  const uid = process.getuid?.() ?? 0;

  // Bootout the existing service if present (ignore failure — may not exist yet).
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });

  // Bootstrap the new plist.
  const bootstrap = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST_PATH], { encoding: 'utf8' });
  if (bootstrap.status !== 0) {
    console.error('launchctl bootstrap failed:', bootstrap.stderr);
    process.exit(1);
  }

  console.log(`Loaded ${LABEL}. Schedule (local time):`);
  for (const t of settings.schedule) console.log(`  ${t}`);
  console.log(`\nCheck status with:  launchctl print gui/${uid}/${LABEL}`);
  console.log(`Pause with:         npm run pause`);
  console.log(`Tail logs with:     npm run logs`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 21.2: Verify it compiles**

Run: `cd "/Users/MarshallHuff/tiktok schedule" && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 21.3: Commit**

```bash
git add src/schedule.ts
git commit -m "feat(schedule): generate + install launchd plist via launchctl

Boots out the existing service first (silent fail OK) then bootstraps
the new plist. Prints next-step commands."
```

---

## Task 22: README

**Files:**
- Create: `README.md`

- [ ] **Step 22.1: Write the README**

```markdown
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
| Other | Read `tail logs/runs.jsonl | jq` for `errorMsg`. |

Hard failures (`session-expired`, `account-flagged`) auto-pause the schedule via `launchctl bootout`. All other failures just skip the slot.
```

- [ ] **Step 22.2: Commit**

```bash
git add README.md
git commit -m "docs: README with setup, operating, and recovery sections"
```

---

## Task 23: Self-review and final commit

- [ ] **Step 23.1: Run the test suite**

```bash
cd "/Users/MarshallHuff/tiktok schedule"
npm test
```

Expected: all unit tests pass (topics, log, notify, lockfile, plist).

- [ ] **Step 23.2: Run a final dry run end-to-end**

```bash
npm run post -- --dry-run
tail -1 logs/runs.jsonl | jq
```

Expected: `dry-run-success`.

- [ ] **Step 23.3: Verify the schedule is installed and loaded**

If you ran `npm run schedule` already in Task 21, run:
```bash
launchctl print gui/$UID/com.user.tiktokpost | head -30
```
Expected: prints the loaded plist with `state = waiting` or similar; `next fire time` shows the next scheduled slot.

If you didn't run schedule yet, do it now:
```bash
npm run schedule
```

- [ ] **Step 23.4: Final commit**

```bash
git add -A
git commit -m "chore: end-to-end verified — schedule installed" --allow-empty
```

---

## Self-Review Checklist (run after writing all tasks)

After authoring this plan, verify against the spec:

| Spec section | Implemented in |
|---|---|
| §1 Goal | Tasks 9, 12–17 |
| §2 Architecture (launchd, persistent context, no daemon) | Tasks 7, 17, 21 |
| §3 Components & file layout | Tasks 1, 2, 3, 4, 5, 6, 7, 9, 12, 14 |
| §4 Runtime sequence | Task 17 (post.ts orchestrator) |
| §4 Sound flow (Favorites + fallback) | Task 14 |
| §5 Configuration (settings.json shape) | Task 18.1 |
| §6 Scheduling (launchd plist) | Tasks 20, 21 |
| §7 Failure taxonomy + auto-pause | Task 17 (`classify`, `isHardFailure`, `pauseSchedule`) |
| §8 Setup commands | Task 22 (README) |
| §9 Risks — Post-success indicator | Task 11 (spike) → Task 15 |
| §9 Risks — sound editor isolation spike | Task 14.4 |
| §11 Verified findings | All selectors in Tasks 9, 12–16 trace back to spec §11 |

No placeholders / TBDs found in tasks — Task 11 has a documented spike-output template.

Type consistency: `RunEntry`, `Settings`, `RollSlidesResult`, `TikTokResult`, `SoundPickResult` defined in Task 2 and used consistently in Tasks 4, 9, 14, 17.
