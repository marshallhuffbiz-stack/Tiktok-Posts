import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAspectRatio, is916 } from '../src/lib/bRollParse.js';

test('parseAspectRatio extracts WxH from "3840×2160 h264"', () => {
  assert.equal(parseAspectRatio('stream-copy trim · 3840×2160 h264/no-audio'), '3840x2160');
});

test('parseAspectRatio handles ASCII x separator too', () => {
  assert.equal(parseAspectRatio('1080x1920 h264'), '1080x1920');
});

test('parseAspectRatio handles the real observed processing string', () => {
  const processing = 'stream-copy trim · 1080×1920 h264/aac @ 0fps · crop in-app at post time';
  assert.equal(parseAspectRatio(processing), '1080x1920');
});

test('parseAspectRatio throws on unparseable input', () => {
  assert.throws(() => parseAspectRatio('no dimensions here'));
});

test('is916 true for 1080x1920', () => {
  assert.equal(is916('1080x1920'), true);
});

test('is916 true for 720x1280 (1% tolerance)', () => {
  assert.equal(is916('720x1280'), true);
});

test('is916 true for 540x960', () => {
  assert.equal(is916('540x960'), true);
});

test('is916 false for 1920x1080 landscape', () => {
  assert.equal(is916('1920x1080'), false);
});

test('is916 false for 3840x2160 4K landscape', () => {
  assert.equal(is916('3840x2160'), false);
});

test('is916 false for malformed input', () => {
  assert.equal(is916('not a ratio'), false);
  assert.equal(is916(''), false);
});
