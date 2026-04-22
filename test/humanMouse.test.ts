import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCurvedPath } from '../src/lib/humanMouse.js';

// Deterministic rng for reproducible tests
function mkRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

test('buildCurvedPath returns at least the configured steps', () => {
  const p = buildCurvedPath(0, 0, 100, 0, mkRng(42), { steps: 16, curveAmplitude: 0, jitter: 0 });
  assert.equal(p.length, 16);
});

test('buildCurvedPath final point is near the target', () => {
  const p = buildCurvedPath(0, 0, 200, 100, mkRng(1), { steps: 20, curveAmplitude: 0, jitter: 0 });
  const last = p[p.length - 1];
  assert.ok(Math.abs(last.x - 200) < 0.01, `x ${last.x} not near 200`);
  assert.ok(Math.abs(last.y - 100) < 0.01, `y ${last.y} not near 100`);
});

test('buildCurvedPath first point is near the start (but not identical due to jitter)', () => {
  const p = buildCurvedPath(50, 50, 200, 200, mkRng(7), { steps: 30, curveAmplitude: 10, jitter: 2 });
  assert.ok(Math.hypot(p[0].x - 50, p[0].y - 50) < 30, 'first point drifted too far from origin');
});

test('buildCurvedPath with zero amplitude/jitter is a straight line', () => {
  const p = buildCurvedPath(0, 0, 100, 0, mkRng(3), { steps: 10, curveAmplitude: 0, jitter: 0 });
  for (const pt of p) {
    assert.ok(Math.abs(pt.y) < 0.001, `y deviated: ${pt.y}`);
  }
});

test('buildCurvedPath with non-zero amplitude deviates from the line midway', () => {
  const p = buildCurvedPath(0, 0, 100, 0, mkRng(12), { steps: 20, curveAmplitude: 30, jitter: 0 });
  const mid = p[Math.floor(p.length / 2)];
  // With amplitude 30, midpoint y should be far from 0 (either positive or negative)
  assert.ok(Math.abs(mid.y) > 5, `midpoint y ${mid.y} not deviated enough`);
});

test('buildCurvedPath clamps steps to at least 8', () => {
  const p = buildCurvedPath(0, 0, 10, 10, mkRng(1), { steps: 2 });
  assert.equal(p.length, 8);
});

test('buildCurvedPath handles identical start and end', () => {
  const p = buildCurvedPath(50, 50, 50, 50, mkRng(1), { steps: 10, curveAmplitude: 0, jitter: 0 });
  assert.equal(p.length, 10);
  for (const pt of p) {
    assert.ok(Math.abs(pt.x - 50) < 0.01 && Math.abs(pt.y - 50) < 0.01);
  }
});
