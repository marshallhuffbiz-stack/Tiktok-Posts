// src/lib/notify.ts
import { spawn } from 'node:child_process';

// Exposed for test injection.
export const _internals = { spawn };

function escape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function notify(title: string, body: string, sound?: string): Promise<void> {
  const parts = [
    `display notification "${escape(body)}" with title "${escape(title)}"`,
  ];
  if (sound) parts.push(`sound name "${escape(sound)}"`);
  const script = parts.join(' ');
  return new Promise((resolve, reject) => {
    const child = _internals.spawn('osascript', ['-e', script]);
    child.on('close', (code: number) => {
      if (code === 0) resolve();
      else reject(new Error(`osascript exited ${code}`));
    });
  });
}
