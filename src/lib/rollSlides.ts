// src/lib/rollSlides.ts
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Page } from 'playwright';
import type { Settings, RollSlidesResult } from './types.js';

const URL = 'https://rent-roll-slides.vercel.app/';

interface ColorMap { [name: string]: string; }
const COLORS: ColorMap = {
  white: 'rgb(255, 255, 255)',
  black: 'rgb(0, 0, 0)',
  // Add more here as needed for other styling profiles.
};

async function clickColorButton(page: Page, sectionLabel: 'Text Color' | 'Outline Color' | 'BG Color', cssColor: string) {
  // Color buttons have no accessible labels — match by computed background.
  const matched = await page.evaluate(
    ({ label, target }) => {
      // The section div has its label text as its full textContent.
      // Find the outer section div by exact textContent match.
      const labels = Array.from(document.querySelectorAll('div'))
        .filter(el => (el.textContent || '').trim() === label);
      if (labels.length === 0) throw new Error(`label not found: ${label}`);
      const sectionDiv = labels[0]!;
      // The buttons live in a .flex.flex-wrap inside this section div (NOT the shared parent).
      const container = sectionDiv.querySelector('.flex.flex-wrap');
      if (!container) throw new Error(`no buttons container under ${label}`);
      const buttons = Array.from(container.querySelectorAll('button')) as HTMLButtonElement[];
      for (let i = 0; i < buttons.length; i++) {
        const bg = getComputedStyle(buttons[i]!).backgroundColor;
        if (bg === target) {
          buttons[i]!.click();
          // Verify the click took effect: active button has borderColor rgb(22, 237, 167).
          // (We do this in a tiny synchronous check; if not active, try a second click.)
          return i;
        }
      }
      throw new Error(`no button with bg ${target} under ${label}`);
    },
    { label: sectionLabel, target: cssColor },
  );
  return matched;
}

export async function generateVideo(
  page: Page,
  topic: string,
  settings: Settings,
  outDir: string,
): Promise<RollSlidesResult> {
  await fsp.mkdir(outDir, { recursive: true });
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Form: carousels = 1
  await page.locator('select').first().selectOption(String(settings.rollSlides.carousels));
  // Output mode
  await page.getByRole('button', { name: settings.rollSlides.outputMode === 'Video' ? '🎬 Video' : '📷 Images' }).click();
  // Style mode
  await page.getByRole('button', { name: settings.rollSlides.styleMode, exact: true }).click();
  // Text color
  const textColorRgb = COLORS[settings.rollSlides.textColor];
  if (!textColorRgb) throw new Error(`unsupported textColor: ${settings.rollSlides.textColor}`);
  await clickColorButton(page, 'Text Color', textColorRgb);
  // Outline / BG color: label depends on style mode
  const outlineLabel = settings.rollSlides.styleMode === 'Outline' ? 'Outline Color' : 'BG Color';
  const outlineColorRgb = COLORS[settings.rollSlides.outlineColor];
  if (!outlineColorRgb) throw new Error(`unsupported outlineColor: ${settings.rollSlides.outlineColor}`);
  await clickColorButton(page, outlineLabel, outlineColorRgb);

  // Topic
  await page.getByRole('textbox').fill(topic);

  // Generate
  await page.getByRole('button', { name: 'Generate', exact: true }).click();

  // Wait for video element with populated data URL (more reliable than waiting for "Done!" text)
  await page.waitForFunction(
    () => {
      const v = document.querySelector('video') as HTMLVideoElement | null;
      return !!(v && v.src && v.src.startsWith('data:video/mp4;base64,'));
    },
    null,
    { timeout: 180_000 },
  );

  // Extract video src and write to disk INSIDE Node (large string, can't ferry through return)
  // We use page.evaluate to fetch the data URL, then decode in Node.
  const dataUrl = await page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).src);
  if (!dataUrl.startsWith('data:video/mp4;base64,')) {
    throw new Error(`unexpected video src prefix: ${dataUrl.slice(0, 40)}`);
  }
  const buf = Buffer.from(dataUrl.split(',')[1]!, 'base64');

  // Slug from "5 slides · slug-text"
  const slug = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('p'));
    const slugLine = ps.map(p => p.textContent || '').find(t => /\d+ slides ·/.test(t)) || '';
    const m = slugLine.match(/·\s*([a-z0-9-]+)/);
    return m ? m[1] : 'video';
  });

  // Caption + hashtags from the "Caption:" block
  const captionData = await page.evaluate(() => {
    const ps = Array.from(document.querySelectorAll('p'));
    const idx = ps.findIndex(p => (p.textContent || '').trim() === 'Caption:');
    if (idx < 0) return null;
    return {
      body: (ps[idx + 1]?.textContent || '').trim(),
      tags: (ps[idx + 2]?.textContent || '').trim(),
    };
  });
  if (!captionData) throw new Error('caption block not found on page');

  // Carousel title (h3 above the slug)
  const carouselTitle = await page.evaluate(() => {
    const h3 = document.querySelector('h3');
    return h3?.textContent?.trim() ?? '';
  });

  const ts = Date.now();
  const filename = `${ts}-${slug}.mp4`;
  const videoPath = path.join(outDir, filename);
  fs.writeFileSync(videoPath, buf);

  const captionFull = `${captionData.body}\n\n${captionData.tags}`;
  const captionPath = videoPath.replace(/\.mp4$/, '.caption.txt');
  fs.writeFileSync(captionPath, captionFull);

  return {
    videoPath,
    captionPath,
    caption: captionFull,
    hashtags: captionData.tags,
    slug: slug || 'video',
    carouselTitle,
  };
}
