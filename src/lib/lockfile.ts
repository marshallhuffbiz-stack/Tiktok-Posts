// src/lib/lockfile.ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';

export function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 doesn't actually send a signal; it just checks whether the process exists.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // ESRCH = no such process; EPERM = exists but we can't signal — still alive.
    const code = (err as NodeJS.ErrnoException).code;
    return code === 'EPERM';
  }
}

export interface Lock {
  release(): Promise<void>;
}

export async function acquireLock(filePath: string): Promise<Lock> {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8').trim();
    const existingPid = parseInt(existing, 10);
    if (Number.isFinite(existingPid) && isPidAlive(existingPid)) {
      throw new Error(`already in flight (pid ${existingPid}); lock at ${filePath}`);
    }
    // Stale lock — fall through and overwrite.
  }
  await fsp.writeFile(filePath, `${process.pid}\n`, 'utf8');
  return {
    async release() {
      try {
        await fsp.unlink(filePath);
      } catch {
        // Already removed — fine.
      }
    },
  };
}
