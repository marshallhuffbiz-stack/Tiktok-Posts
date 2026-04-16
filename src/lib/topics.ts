// src/lib/topics.ts
import fs from 'node:fs';

export function readTopics(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0 && !line.startsWith('#'));
}

export function pickRandomTopic(
  filePath: string,
  rng: () => number = Math.random,
): string {
  const topics = readTopics(filePath);
  if (topics.length === 0) {
    throw new Error(`no topics in ${filePath}`);
  }
  const idx = Math.min(Math.floor(rng() * topics.length), topics.length - 1);
  return topics[idx]!;
}
