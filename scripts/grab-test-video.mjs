// One-off helper: drive rent-roll-slides, generate a video, save MP4 to disk.
// Usage: node scripts/grab-test-video.mjs "topic text"
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const topic = process.argv[2] || 'Biggest landlord screening mistakes';
const outDir = path.resolve('downloads');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

console.log('→ navigating');
await page.goto('https://rent-roll-slides.vercel.app/', { waitUntil: 'domcontentloaded' });

console.log('→ configuring form');
// Carousels = 1
await page.locator('select').first().selectOption('1');
// Output = Video
await page.getByRole('button', { name: '🎬 Video' }).click();
// Style Mode = Outline
await page.getByRole('button', { name: 'Outline', exact: true }).click();
// Type topic
await page.getByRole('textbox').fill(topic);

console.log('→ clicking Generate');
await page.getByRole('button', { name: 'Generate', exact: true }).click();

console.log('→ waiting for video src to populate');
await page.waitForFunction(
  () => {
    const v = document.querySelector('video');
    return !!(v && v.src && v.src.startsWith('data:video/mp4;base64,'));
  },
  null,
  { timeout: 180000 }
);

console.log('→ extracting video');
const dataUrl = await page.evaluate(() => document.querySelector('video')?.src || '');
if (!dataUrl.startsWith('data:video/mp4;base64,')) {
  throw new Error(`Unexpected video src prefix: ${dataUrl.slice(0, 40)}`);
}
const buf = Buffer.from(dataUrl.split(',')[1], 'base64');

const slug = await page.evaluate(() => {
  const text = Array.from(document.querySelectorAll('p'))
    .map(p => p.textContent || '')
    .find(t => /\d+ slides ·/.test(t)) || '';
  const m = text.match(/·\s*([a-z0-9-]+)/);
  return m ? m[1] : 'video';
});

const caption = await page.evaluate(() => {
  const ps = Array.from(document.querySelectorAll('p'));
  const captionLabelIdx = ps.findIndex(p => p.textContent?.trim() === 'Caption:');
  if (captionLabelIdx < 0) return null;
  const body = ps[captionLabelIdx + 1]?.textContent?.trim() || '';
  const tags = ps[captionLabelIdx + 2]?.textContent?.trim() || '';
  return { body, tags, full: `${body}\n\n${tags}` };
});

const filename = `${Date.now()}-${slug}.mp4`;
const outPath = path.join(outDir, filename);
fs.writeFileSync(outPath, buf);

const captionPath = outPath.replace(/\.mp4$/, '.caption.txt');
fs.writeFileSync(captionPath, caption?.full || '');

console.log(JSON.stringify({
  videoPath: outPath,
  captionPath,
  sizeMB: (buf.length / 1024 / 1024).toFixed(2),
  slug,
  caption,
}, null, 2));

await browser.close();
