import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeHandleTargetX, spanFraction } from '../src/lib/overlayMath.js';

test('computeHandleTargetX at 0s returns 0', () => {
  assert.equal(computeHandleTargetX(0, 10, 500), 0);
});

test('computeHandleTargetX at full duration returns full width', () => {
  assert.equal(computeHandleTargetX(10, 10, 500), 500);
});

test('computeHandleTargetX scales linearly', () => {
  assert.equal(computeHandleTargetX(5, 10, 500), 250);
  assert.equal(computeHandleTargetX(2.5, 10, 500), 125);
});

test('computeHandleTargetX clamps above total to full width', () => {
  assert.equal(computeHandleTargetX(15, 10, 500), 500);
});

test('computeHandleTargetX handles zero/negative total gracefully', () => {
  assert.equal(computeHandleTargetX(5, 0, 500), 0);
  assert.equal(computeHandleTargetX(5, -1, 500), 0);
});

test('spanFraction returns span / total', () => {
  assert.equal(spanFraction(5, 10), 0.5);
  assert.equal(spanFraction(10, 10), 1.0);
});

test('spanFraction handles tiny spans', () => {
  assert.equal(spanFraction(0.1, 10), 0.01);
});

test('spanFraction returns 0 for non-positive total', () => {
  assert.equal(spanFraction(5, 0), 0);
  assert.equal(spanFraction(5, -1), 0);
});
