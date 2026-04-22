import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePexelsUrl, buildHdCandidates } from '../src/lib/pexelsVariant.js';

test('parsePexelsUrl parses a UHD landscape URL', () => {
  const p = parsePexelsUrl('https://videos.pexels.com/video-files/18484620/18484620-uhd_3840_2160_30fps.mp4');
  assert.ok(p);
  assert.equal(p!.id, '18484620');
  assert.equal(p!.tier, 'uhd');
  assert.equal(p!.width, 3840);
  assert.equal(p!.height, 2160);
  assert.equal(p!.fps, 30);
});

test('parsePexelsUrl parses a portrait UHD URL', () => {
  const p = parsePexelsUrl('https://videos.pexels.com/video-files/7117478/7117478-uhd_2160_4096_30fps.mp4');
  assert.ok(p);
  assert.equal(p!.tier, 'uhd');
  assert.equal(p!.width, 2160);
  assert.equal(p!.height, 4096);
});

test('parsePexelsUrl parses an HD URL', () => {
  const p = parsePexelsUrl('https://videos.pexels.com/video-files/8479730/8479730-hd_1080_1920_25fps.mp4');
  assert.ok(p);
  assert.equal(p!.tier, 'hd');
});

test('parsePexelsUrl returns null for non-Pexels URLs', () => {
  assert.equal(parsePexelsUrl('https://example.com/foo.mp4'), null);
  assert.equal(parsePexelsUrl('https://videos.pexels.com/wrongpath/foo.mp4'), null);
});

test('buildHdCandidates includes half-size variant first for landscape UHD', () => {
  const c = buildHdCandidates('https://videos.pexels.com/video-files/18484620/18484620-uhd_3840_2160_30fps.mp4');
  assert.ok(c.length >= 1, 'expected at least one candidate');
  assert.match(c[0], /hd_1920_1080_30fps/);
});

test('buildHdCandidates includes half-size variant first for portrait UHD', () => {
  const c = buildHdCandidates('https://videos.pexels.com/video-files/7117478/7117478-uhd_2160_4096_30fps.mp4');
  assert.match(c[0], /hd_1080_2048_30fps/);
});

test('buildHdCandidates returns empty for HD input', () => {
  const c = buildHdCandidates('https://videos.pexels.com/video-files/8479730/8479730-hd_1080_1920_25fps.mp4');
  assert.deepEqual(c, []);
});

test('buildHdCandidates returns empty for non-Pexels input', () => {
  assert.deepEqual(buildHdCandidates('https://example.com/foo.mp4'), []);
});

test('buildHdCandidates dedupes when half-size matches a standard', () => {
  // 3840x2160 → half is 1920x1080, which is also the standard landscape mobile size
  const c = buildHdCandidates('https://videos.pexels.com/video-files/18484620/18484620-uhd_3840_2160_30fps.mp4');
  // Should include 1920x1080 only ONCE
  const matches = c.filter(u => /1920_1080/.test(u));
  assert.equal(matches.length, 1);
});
