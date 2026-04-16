// src/schedule.ts
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { generatePlist } from './lib/plist.js';
import type { Settings } from './lib/types.js';

const LABEL = 'com.user.tiktokpost';
const ROOT = process.cwd();
const SETTINGS_PATH = path.join(ROOT, 'config', 'settings.json');
const PLIST_PATH = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);

async function main() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Settings;
  const nodePath = process.execPath;
  const scriptPath = path.join(ROOT, 'dist', 'post.js');
  const stdoutPath = path.join(ROOT, 'logs', 'launchd.out.log');
  const stderrPath = path.join(ROOT, 'logs', 'launchd.err.log');

  const xml = generatePlist({
    label: LABEL,
    nodePath,
    scriptPath,
    workingDir: ROOT,
    times: settings.schedule,
    stdoutPath,
    stderrPath,
  });

  fs.mkdirSync(path.dirname(PLIST_PATH), { recursive: true });
  fs.writeFileSync(PLIST_PATH, xml, 'utf8');
  console.log(`Wrote plist to ${PLIST_PATH}`);

  const uid = process.getuid?.() ?? 0;

  // Bootout the existing service if present (ignore failure — may not exist yet).
  spawnSync('launchctl', ['bootout', `gui/${uid}/${LABEL}`], { stdio: 'ignore' });

  // Bootstrap the new plist.
  const bootstrap = spawnSync('launchctl', ['bootstrap', `gui/${uid}`, PLIST_PATH], { encoding: 'utf8' });
  if (bootstrap.status !== 0) {
    console.error('launchctl bootstrap failed:', bootstrap.stderr);
    process.exit(1);
  }

  console.log(`Loaded ${LABEL}. Schedule (local time):`);
  for (const t of settings.schedule) console.log(`  ${t}`);
  console.log(`\nCheck status with:  launchctl print gui/${uid}/${LABEL}`);
  console.log(`Pause with:         npm run pause`);
  console.log(`Tail logs with:     npm run logs`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
