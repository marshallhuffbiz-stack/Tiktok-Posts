// src/login.ts
import readline from 'node:readline';
import { openBrowser } from './lib/browser.js';

async function main() {
  console.log('Opening a HEADED Chromium window for TikTok login.');
  console.log('Steps:');
  console.log('  1. Log in to TikTok in the browser window that opens.');
  console.log('  2. Solve the captcha (the wheel-slider puzzle) if prompted.');
  console.log('  3. Verify you land on a TikTok page where you are logged in');
  console.log('     (e.g. tiktok.com/foryou shows your avatar in the top-right).');
  console.log('  4. Come back here and press Enter to save the session and exit.\n');

  const browser = await openBrowser({ headed: true });
  await browser.page.goto('https://www.tiktok.com/login', { waitUntil: 'domcontentloaded' });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise<void>(resolve => rl.question('Press Enter when logged in: ', () => { rl.close(); resolve(); }));

  // Verify by checking for the upload page (will redirect to login if not authenticated).
  await browser.page.goto('https://www.tiktok.com/tiktokstudio/upload', { waitUntil: 'domcontentloaded' });
  if (browser.page.url().includes('/login')) {
    console.error('\n❌ Still not authenticated — the upload page redirected to /login.');
    console.error('   Cookies were not saved. Re-run `npm run login` and complete login first.');
    await browser.close();
    process.exit(1);
  }

  console.log('\n✅ Logged in. Session cookies saved to ./browser-data/');
  await browser.close();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
