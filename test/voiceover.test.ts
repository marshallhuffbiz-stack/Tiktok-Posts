import { test } from 'node:test';
import assert from 'node:assert/strict';
import { speakableText, VOICES } from '../src/lib/voiceover.js';

test('speakableText converts $ amounts to spoken form', () => {
  const out = speakableText('Buy at $118k for the deal');
  assert.match(out, /118 thousand/);
  assert.ok(!out.includes('$'));
});

test('speakableText converts standalone Nk to N thousand', () => {
  const out = speakableText('Refi at 180k after 24 months');
  assert.match(out, /180 thousand/);
});

test('speakableText handles multiline overlay', () => {
  const out = speakableText('Buy at $118k\nRent for $1,475\nNet $312 monthly');
  assert.match(out, /118 thousand/);
  // newlines collapsed to spaces
  assert.ok(!out.includes('\n'));
});

test('speakableText returns empty for empty input', () => {
  assert.equal(speakableText('').length, 0);
});

test('VOICES contains at least 3 macOS voices', () => {
  assert.ok(VOICES.length >= 3);
  for (const v of VOICES) assert.ok(typeof v === 'string' && v.length > 0);
});
