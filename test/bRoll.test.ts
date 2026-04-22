import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOverlayText, buildCaption } from '../src/lib/bRoll.js';

const sampleHook = {
  overlay_lines: [
    'Buy at 118k, not 145k',
    'Put 27k into rehab work',
    'Rent it for 1,640 a month',
    'Refi at 75% of 214k',
    'You leave in only 14.5k',
  ],
  closer_line: "It's called the BRRRR method.",
  caption: 'Most people only see the buy price. The refi is where the math clicks. Save this before you call a deal overpriced.',
  hashtags: ['#realestate', '#investing', '#BRRRR', '#rentalproperty', '#moneytok', '#fyp'],
};

test('buildOverlayText joins lines with newlines and closer with blank line', () => {
  const result = buildOverlayText(sampleHook);
  assert.equal(
    result,
    'Buy at 118k, not 145k\nPut 27k into rehab work\nRent it for 1,640 a month\nRefi at 75% of 214k\nYou leave in only 14.5k\n\nIt\'s called the BRRRR method.',
  );
});

test('buildOverlayText handles hook with no closer_line', () => {
  const result = buildOverlayText({ ...sampleHook, closer_line: '' });
  assert.equal(result, 'Buy at 118k, not 145k\nPut 27k into rehab work\nRent it for 1,640 a month\nRefi at 75% of 214k\nYou leave in only 14.5k');
});

test('buildOverlayText handles hook with no overlay_lines', () => {
  const result = buildOverlayText({ ...sampleHook, overlay_lines: [] });
  assert.equal(result, "It's called the BRRRR method.");
});

test('buildOverlayText skips empty lines', () => {
  const result = buildOverlayText({ ...sampleHook, overlay_lines: ['A', '', '  ', 'B'] });
  assert.equal(result, "A\nB\n\nIt's called the BRRRR method.");
});

test('buildCaption keeps first 3 api tags and drops #fyp (diversified)', () => {
  const { caption, hashtags } = buildCaption(sampleHook);
  const tagList = hashtags.split(' ');
  assert.equal(tagList.length, 5);
  assert.equal(tagList[0], '#realestate');
  assert.equal(tagList[1], '#investing');
  assert.equal(tagList[2], '#BRRRR');
  assert.ok(!tagList.some(t => t.toLowerCase() === '#fyp'));
  assert.ok(caption.includes('\n\n#'));
});

test('buildCaption normalizes missing # prefix on api tags', () => {
  const { hashtags } = buildCaption({ ...sampleHook, hashtags: ['realestate', '#investing', 'BRRRR'] });
  const tagList = hashtags.split(' ');
  for (const t of tagList) assert.ok(t.startsWith('#'), `${t} missing #`);
});

test('buildCaption fills from pool when api has no hashtags', () => {
  const { caption, hashtags } = buildCaption({ ...sampleHook, hashtags: [] });
  const tagList = hashtags.split(' ');
  assert.equal(tagList.length, 5);
  assert.ok(caption.includes('\n\n#'));
});

test('buildCaption works with empty caption body (just hashtags)', () => {
  const { caption, hashtags } = buildCaption({ ...sampleHook, caption: '' });
  const tagList = hashtags.split(' ');
  assert.equal(tagList.length, 5);
  assert.ok(caption.startsWith('\n\n#'));
});
