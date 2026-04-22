import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diversifyHashtags, rewriteCaptionOpener, HASHTAG_POOL } from '../src/lib/contentVariety.js';

function mkRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

test('diversifyHashtags keeps the first N api tags', () => {
  const api = ['#realestate', '#investing', '#BRRRR', '#rentalproperty', '#moneytok', '#fyp'];
  const out = diversifyHashtags(api, mkRng(1), { keepApi: 3, targetCount: 5 });
  assert.equal(out.length, 5);
  assert.equal(out[0], '#realestate');
  assert.equal(out[1], '#investing');
  assert.equal(out[2], '#BRRRR');
});

test('diversifyHashtags drops #fyp from api tags', () => {
  const api = ['#realestate', '#fyp', '#BRRRR', '#rentalproperty'];
  const out = diversifyHashtags(api, mkRng(2), { keepApi: 3, targetCount: 5 });
  assert.ok(!out.some(t => t.toLowerCase() === '#fyp'));
});

test('diversifyHashtags fills to targetCount from pool', () => {
  const out = diversifyHashtags([], mkRng(3), { keepApi: 0, targetCount: 5 });
  assert.equal(out.length, 5);
  for (const t of out) {
    assert.ok(HASHTAG_POOL.includes(t), `${t} not in pool`);
  }
});

test('diversifyHashtags dedupes between api and pool', () => {
  const api = ['#realestate', '#investing', '#BRRRR'];  // all in pool
  const out = diversifyHashtags(api, mkRng(4), { keepApi: 3, targetCount: 6 });
  const lower = out.map(t => t.toLowerCase());
  const unique = new Set(lower);
  assert.equal(unique.size, out.length);
});

test('diversifyHashtags produces different sets with different rng seeds', () => {
  const api = ['#realestate', '#investing'];
  const a = diversifyHashtags(api, mkRng(1), { keepApi: 2, targetCount: 6 });
  const b = diversifyHashtags(api, mkRng(999), { keepApi: 2, targetCount: 6 });
  // Tail (positions 2+) should differ across seeds most of the time
  assert.notDeepEqual(a.slice(2), b.slice(2));
});

test('diversifyHashtags handles missing # prefix on input', () => {
  const out = diversifyHashtags(['realestate', 'BRRRR'], mkRng(5), { keepApi: 2, targetCount: 2 });
  assert.equal(out[0], '#realestate');
  assert.equal(out[1], '#BRRRR');
});

test('rewriteCaptionOpener keeps body when rng rolls above 0.6', () => {
  // Rng returning 0.9 — above the 0.6 threshold, so no rewrite
  const rng = () => 0.9;
  const body = 'Most people only see the rehab bill. Save this.';
  assert.equal(rewriteCaptionOpener(body, rng), body);
});

test('rewriteCaptionOpener replaces a matching opener when rng rolls below 0.6', () => {
  // rng 0.3 triggers rewrite; 0 picks first alt
  const calls = [0.3, 0];
  let i = 0;
  const rng = () => calls[i++] ?? 0;
  const body = 'Most people only see the rehab bill. Save this.';
  const out = rewriteCaptionOpener(body, rng);
  assert.notEqual(out, body);
  assert.ok(out.startsWith('Everyone fixates on '));
});

test('rewriteCaptionOpener leaves non-matching body alone', () => {
  const rng = () => 0.1;
  const body = 'Here is a wild take about property.';
  assert.equal(rewriteCaptionOpener(body, rng), body);
});
