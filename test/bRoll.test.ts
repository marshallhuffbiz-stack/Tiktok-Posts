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

test('buildCaption joins body and hashtags with blank line', () => {
  const { caption, hashtags } = buildCaption(sampleHook);
  assert.equal(hashtags, '#realestate #investing #BRRRR #rentalproperty #moneytok #fyp');
  assert.ok(caption.startsWith('Most people only see'));
  assert.ok(caption.endsWith('#fyp'));
  assert.ok(caption.includes('\n\n#realestate'));
});

test('buildCaption handles hashtags without # prefix', () => {
  const { caption, hashtags } = buildCaption({ ...sampleHook, hashtags: ['fyp', '#already', 'thrid'] });
  assert.equal(hashtags, '#fyp #already #thrid');
  assert.ok(caption.endsWith('#thrid'));
});

test('buildCaption handles no hashtags', () => {
  const { caption, hashtags } = buildCaption({ ...sampleHook, hashtags: [] });
  assert.equal(hashtags, '');
  assert.equal(caption, sampleHook.caption);
  assert.ok(!caption.includes('\n\n'));
});

test('buildCaption handles empty caption body', () => {
  const { caption } = buildCaption({ ...sampleHook, caption: '' });
  assert.equal(caption, '\n\n#realestate #investing #BRRRR #rentalproperty #moneytok #fyp');
});
