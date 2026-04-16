// test/topics.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { pickRandomTopic, readTopics } from '../src/lib/topics.ts';

function tmpFile(content: string): string {
  const p = path.join(os.tmpdir(), `topics-${Date.now()}-${Math.random()}.txt`);
  fs.writeFileSync(p, content);
  return p;
}

test('readTopics ignores blank lines and # comments', () => {
  const p = tmpFile([
    '# header comment',
    'topic one',
    '',
    '   ',
    '# another comment',
    'topic two',
    'topic three',
  ].join('\n'));
  const topics = readTopics(p);
  assert.deepEqual(topics, ['topic one', 'topic two', 'topic three']);
  fs.unlinkSync(p);
});

test('pickRandomTopic uses injected rng deterministically', () => {
  const p = tmpFile('a\nb\nc\nd\n');
  // rng=0 → first index, rng=0.99 → last index
  const first = pickRandomTopic(p, () => 0);
  const last = pickRandomTopic(p, () => 0.99);
  assert.equal(first, 'a');
  assert.equal(last, 'd');
  fs.unlinkSync(p);
});

test('pickRandomTopic throws on empty file', () => {
  const p = tmpFile('# comment only\n\n');
  assert.throws(() => pickRandomTopic(p), /no topics/i);
  fs.unlinkSync(p);
});
