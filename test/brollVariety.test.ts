import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickTopic, pickAudienceControversy, TOPIC_POOL } from '../src/lib/brollVariety.js';

function mkRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

test('pickTopic returns something from the pool', () => {
  const t = pickTopic([], mkRng(1));
  assert.ok(TOPIC_POOL.includes(t));
});

test('pickTopic avoids recently-used topics', () => {
  const recent = TOPIC_POOL.slice(0, TOPIC_POOL.length - 1);
  const t = pickTopic(recent, mkRng(1));
  // Only one unused topic left; we should pick it
  assert.equal(t, TOPIC_POOL[TOPIC_POOL.length - 1]);
});

test('pickTopic falls back to pool when all topics are recently used', () => {
  const t = pickTopic(TOPIC_POOL.slice(), mkRng(1));
  assert.ok(TOPIC_POOL.includes(t));
});

test('pickTopic is deterministic given an rng and recent set', () => {
  const a = pickTopic([], mkRng(42));
  const b = pickTopic([], mkRng(42));
  assert.equal(a, b);
});

test('pickAudienceControversy returns valid values', () => {
  const { audience, controversy } = pickAudienceControversy([], [], mkRng(1));
  assert.ok(['both', 'landlord', 'investor'].includes(audience));
  assert.ok([1, 2, 3, 4, 5].includes(controversy));
});

test('pickAudienceControversy can avoid most recent audience', () => {
  // rng starts with 0.1 < 0.5 → trigger "avoid last" branch.
  // Pick index 0 from remaining 2 options.
  const rng = (() => {
    const seq = [0.1, 0.0, 0.1, 0.0]; let i = 0; return () => seq[i++] ?? 0;
  })();
  const { audience } = pickAudienceControversy(['both'], [], rng);
  assert.notEqual(audience, 'both');
});

test('pickAudienceControversy produces varied output across seeds', () => {
  const results: string[] = [];
  for (let seed = 1; seed < 20; seed++) {
    const r = pickAudienceControversy([], [], mkRng(seed));
    results.push(`${r.audience}-${r.controversy}`);
  }
  const unique = new Set(results);
  assert.ok(unique.size >= 3, `expected variety across seeds, got ${[...unique].join(', ')}`);
});
