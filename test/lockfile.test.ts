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
