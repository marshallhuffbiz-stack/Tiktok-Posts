import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateLocalHook, pickTemplate } from '../src/lib/localHook.js';

function mkRng(seed: number): () => number {
  let s = seed;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

test('generateLocalHook produces non-empty overlay_lines', () => {
  const h = generateLocalHook('BRRRR math', 'investor', 3, [], mkRng(1));
  assert.ok(h.overlay_lines.length >= 4);
  for (const line of h.overlay_lines) assert.ok(line && line.trim().length > 0);
});

test('generateLocalHook fills a closer_line', () => {
  const h = generateLocalHook('BRRRR', 'investor', 3, [], mkRng(2));
  assert.ok(h.closer_line && h.closer_line.length > 5);
});

test('generateLocalHook fills caption + hashtags', () => {
  const h = generateLocalHook('something', 'both', 3, [], mkRng(3));
  assert.ok(h.caption.length > 30);
  assert.ok(h.hashtags.length >= 3);
  for (const t of h.hashtags) assert.ok(t.startsWith('#'));
});

test('generateLocalHook embeds Rent Roll brand in closer most templates', () => {
  // Run many seeds, count how many closers reference Rent Roll
  let withBrand = 0;
  for (let s = 1; s < 50; s++) {
    const h = generateLocalHook('topic', 'both', 3, [], mkRng(s));
    if (/rent roll/i.test(h.closer_line)) withBrand++;
  }
  assert.ok(withBrand >= 30, `expected most closers to mention Rent Roll, got ${withBrand}/50`);
});

test('pickTemplate avoids recently-used template ids', () => {
  // Build set of all template ids by sampling many seeds
  const ids = new Set<string>();
  for (let s = 1; s < 30; s++) ids.add(pickTemplate([], mkRng(s)).id);
  // Use ALL but one as recent
  const all = [...ids];
  const recent = all.slice(0, all.length - 1);
  const t = pickTemplate(recent, mkRng(1));
  // Picked one should be the only-not-used
  assert.equal(t.id, all[all.length - 1]);
});

test('generateLocalHook handles empty recent list', () => {
  const h = generateLocalHook('topic', 'both', 3, [], mkRng(7));
  assert.ok(h.template_id.length > 0);
});

test('generateLocalHook returns deterministic output for same rng seed', () => {
  const a = generateLocalHook('topic', 'both', 3, [], mkRng(99));
  const b = generateLocalHook('topic', 'both', 3, [], mkRng(99));
  assert.deepEqual(a, b);
});
