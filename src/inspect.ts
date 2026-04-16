// src/inspect.ts
// Debug helper: opens the production browser (same data dir as npm run post)
// HEADED and VISIBLE, navigated to the upload page. Lets the user see exactly
// what tour modals / popups appear in a fresh Playwright Chromium session,
// so we can update the script to dismiss them.
import readline from 'node:readline';
import { openBrowser } from './lib/browser.js';

async function main() {
  console.log('Opening production browser (same ./browser-data/) headed at the upload page.');
  console.log('Watch for any tour / modal / tooltip that appears that we do not dismiss.');
  console.log('When you are done inspecting, press Enter in this terminal to close.\n');

  const browser = await openBrowser({ headed: true });
  await browser.page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded' });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>(resolve => rl.question('Press Enter to close: ', () => { rl.close(); resolve(); }));
  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
