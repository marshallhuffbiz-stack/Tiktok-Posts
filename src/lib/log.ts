// src/lib/log.ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { RunEntry } from './types.js';

export async function appendRun(filePath: string, entry: RunEntry): Promise<void> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
}

export async function readRecentRuns(filePath: string, n: number): Promise<RunEntry[]> {
  if (!fs.existsSync(filePath)) return [];
  const raw = await fsp.readFile(filePath, 'utf8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  const tail = lines.slice(-n);
  return tail.map(l => JSON.parse(l) as RunEntry);
}
