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
