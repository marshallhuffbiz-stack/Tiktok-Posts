// src/captureEditor.ts
//
// One-shot helper that drives Patchright (same profile + stealth setup
// as `npm run post`) through generate → upload → open editor, then dumps
// every piece of information we need to write overlay.ts selectors:
//
//   /tmp/tiktok-editor/interactive-elements.json — every visible button/input with selector + text
//   /tmp/tiktok-editor/editor-modal-candidates.html — outer HTML of any editor/modal region
//   /tmp/tiktok-editor/page.html          — full page HTML
//   /tmp/tiktok-editor/screenshot-*.png   — screenshots at each phase
//   /tmp/tiktok-editor/console.jsonl      — console messages during run
//
// Usage:
//   npm run capture-editor
//
// The browser launches headed (visible) so you can watch it drive. Press
// Ctrl+C to abort at any time. After the editor opens, the script
// dumps artifacts and waits on Enter before closing — giving you a
// chance to manually click around and capture more if needed.

import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { openBrowser } from './lib/browser.js';
import { generateBRoll } from './lib/bRoll.js';
import { openUploadPage, attachVideo, installDialogAutoAccept } from './lib/tiktok.js';
import { is916 } from './lib/bRollParse.js';
import type { Settings } from './lib/types.js';

const ROOT = process.cwd();
const SETTINGS_PATH = path.join(ROOT, 'config', 'settings.json');
const DOWNLOADS_DIR = path.join(ROOT, 'downloads');
const OUT_DIR = '/tmp/tiktok-editor';

function mkdirp(p: string): void { fs.mkdirSync(p, { recursive: true }); }

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  mkdirp(OUT_DIR);
  const settings = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8')) as Settings;

  console.log('[capture] Step 1/5 — fetching B-roll clip via /api/broll');
  const b = await generateBRoll(settings.bRoll, DOWNLOADS_DIR);
  console.log(`[capture]   got: ${b.slug} · ${b.clipDurationSec.toFixed(1)}s · ${b.aspectRatio}`);
  console.log(`[capture]   video: ${b.videoPath}`);
  console.log(`[capture]   needsCrop: ${!is916(b.aspectRatio)}`);

  console.log('[capture] Step 2/5 — launching Patchright headed');
  const browser = await openBrowser({ headed: true });
  installDialogAutoAccept(browser.page);

  // Capture console messages (might surface editor lifecycle events)
  const consoleStream = fs.createWriteStream(path.join(OUT_DIR, 'console.jsonl'));
  browser.page.on('console', msg => {
    consoleStream.write(JSON.stringify({ type: msg.type(), text: msg.text() }) + '\n');
  });

  // Dump whatever state Patchright is in right now, regardless of error.
  // Lets us diagnose captchas, dialogs, or unexpected popups blocking the upload.
  async function dumpState(tag: string): Promise<void> {
    try {
      const file = path.join(OUT_DIR, `state-${tag}.png`);
      await browser.page.screenshot({ path: file, fullPage: true });
      console.log(`[capture]   dumped: ${file}`);
    } catch (e) { console.warn('[capture]   screenshot failed:', (e as Error).message); }
    try {
      const html = await browser.page.content();
      fs.writeFileSync(path.join(OUT_DIR, `state-${tag}.html`), html);
    } catch { /* ignore */ }
    try {
      const url = browser.page.url();
      fs.appendFileSync(path.join(OUT_DIR, 'state-urls.log'), `${tag}: ${url}\n`);
      console.log(`[capture]   url: ${url}`);
    } catch { /* ignore */ }
  }

  try {
    console.log('[capture] Step 3/5 — opening upload page + attaching video');
    try {
      await openUploadPage(browser.page, settings);
    } catch (err) {
      await dumpState('openUploadPage-failed');
      throw err;
    }
    await sleep(1500);
    await browser.page.screenshot({ path: path.join(OUT_DIR, 'screenshot-1-upload.png'), fullPage: true });
    try {
      await attachVideo(browser.page, b.videoPath);
    } catch (err) {
      await dumpState('attachVideo-failed');
      throw err;
    }
    console.log('[capture]   upload complete');
    await sleep(2000);  // let TikTok render preview + edit affordance
    await browser.page.screenshot({ path: path.join(OUT_DIR, 'screenshot-2-attached.png'), fullPage: true });

    console.log('[capture] Step 4/5 — attempting to open editor');
    // Try a range of heuristic selectors in order — whichever works, works.
    // We know the editor affordance exists on the preview; it could be a button,
    // an overlay on hover, or a separate panel link.
    const candidates = [
      'button:has-text("Edit")',
      'button:has-text("edit video")',
      'button:has-text("Edit video")',
      '[data-e2e*="edit"]',
      '[aria-label*="Edit" i]',
      'button[class*="edit" i]',
      'div[class*="preview"] button',
    ];
    let opened = false;
    for (const sel of candidates) {
      try {
        const loc = browser.page.locator(sel).first();
        const count = await loc.count();
        if (count > 0) {
          await loc.click({ timeout: 3000 });
          await sleep(1500);
          console.log(`[capture]   clicked ${sel} — checking for editor modal`);
          opened = true;
          break;
        }
      } catch { /* try next */ }
    }
    if (!opened) {
      console.warn('[capture]   Could NOT auto-click into editor — dumping current page anyway.');
      console.warn('[capture]   You can manually click Edit now, then press Enter below to continue the dump.');
    }

    await sleep(1500);
    await browser.page.screenshot({ path: path.join(OUT_DIR, 'screenshot-3-editor-attempt.png'), fullPage: true });

    console.log('[capture] Step 5/5 — pausing so you can manually click into the editor if needed');
    console.log('[capture]   Once the editor is open (Crop, Text, etc. tools visible), press Enter here.');

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await new Promise<void>(resolve => rl.question('Press Enter to dump editor DOM: ', () => { rl.close(); resolve(); }));

    await browser.page.screenshot({ path: path.join(OUT_DIR, 'screenshot-4-editor-open.png'), fullPage: true });

    // Crop is context-sensitive in TikTok's editor: it appears only after
    // you click the video clip on the timeline. Try several selectors to
    // locate a clip element, click it, wait for the properties panel to
    // render, then dump that state.
    try {
      console.log('[capture] Clicking the video clip to reveal crop + properties...');
      const clipCandidates = [
        '[class*="Timeline"] [class*="clip" i]',
        '[class*="TrackItem"]',
        '[class*="ClipItem"]',
        '[class*="Clip__"]',
        '[class*="track" i] [draggable="true"]',
        // Fallback: click the video preview itself
        '.Editor__root video',
        'video',
      ];
      let clipClicked = false;
      for (const sel of clipCandidates) {
        try {
          const loc = browser.page.locator(sel).first();
          const n = await loc.count();
          if (n > 0) {
            await loc.click({ timeout: 2000 });
            console.log(`[capture]   clicked clip via ${sel}`);
            clipClicked = true;
            break;
          }
        } catch { /* try next */ }
      }
      if (!clipClicked) console.log('[capture]   no clip selector matched — you may need to click the clip manually');
      await sleep(1500);
      await browser.page.screenshot({ path: path.join(OUT_DIR, 'screenshot-4b-clip-selected.png'), fullPage: true });

      // Dump interactive elements AGAIN now that crop tool should be visible
      const interactiveAfterClipClick = await browser.page.evaluate(() => {
        const buildSelector = (el: Element): string => {
          if (el.id) return `#${el.id}`;
          const e2e = el.getAttribute('data-e2e');
          if (e2e) return `[data-e2e="${e2e}"]`;
          const aria = el.getAttribute('aria-label');
          if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
          const className = (el.className || '').toString().split(/\s+/).filter(c => c && !/^[0-9]/.test(c))[0];
          if (className) return `${el.tagName.toLowerCase()}.${className}`;
          return el.tagName.toLowerCase();
        };
        const out: Array<{ tag: string; text: string; name: string; selector: string; dataAttrs: Record<string,string> }> = [];
        for (const el of Array.from(document.querySelectorAll('button, input, [role="button"], [contenteditable="true"], textarea'))) {
          const he = el as HTMLElement;
          const rect = he.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          const dataAttrs: Record<string,string> = {};
          for (const a of Array.from(he.attributes)) if (a.name.startsWith('data-')) dataAttrs[a.name] = a.value;
          out.push({
            tag: el.tagName.toLowerCase(),
            text: (he.innerText || '').trim().slice(0, 80),
            name: he.getAttribute('aria-label') || (he as HTMLInputElement).placeholder || '',
            selector: buildSelector(el),
            dataAttrs,
          });
        }
        return out;
      });
      fs.writeFileSync(path.join(OUT_DIR, 'interactive-elements-after-clip-click.json'), JSON.stringify(interactiveAfterClipClick, null, 2));
    } catch (e) {
      console.warn('[capture]   clip-click drive failed:', (e as Error).message);
    }

    // Try to drive one step deeper: click the Text tool, then the first preset,
    // so the dumped state includes the text input + timeline text clip.
    try {
      console.log('[capture] Clicking Text tool to expose text panel...');
      await browser.page.locator('button[data-button-name="text"]').first().click({ timeout: 3000 });
      await sleep(1500);
      await browser.page.screenshot({ path: path.join(OUT_DIR, 'screenshot-5-text-panel.png'), fullPage: true });

      // Click whatever looks like a preset in the left panel
      const presetCandidates = [
        '[class*="TextPreset"] [class*="item"]',
        '[class*="AddTextPreset"] > div > div',
        '[class*="preset" i] button',
        '.AddTextPresetPanel button',
      ];
      let presetClicked = false;
      for (const sel of presetCandidates) {
        try {
          const loc = browser.page.locator(sel).first();
          if ((await loc.count()) > 0) {
            await loc.click({ timeout: 2000 });
            presetClicked = true;
            console.log(`[capture]   clicked preset via ${sel}`);
            break;
          }
        } catch { /* try next */ }
      }
      if (!presetClicked) console.log('[capture]   could not auto-click a text preset');
      await sleep(1500);
      await browser.page.screenshot({ path: path.join(OUT_DIR, 'screenshot-6-text-added.png'), fullPage: true });
    } catch (e) {
      console.warn('[capture]   text-panel drive failed:', (e as Error).message);
    }

    // Full page HTML (may be large; we save a trimmed version + full)
    const fullHtml = await browser.page.content();
    fs.writeFileSync(path.join(OUT_DIR, 'page.html'), fullHtml);

    // A targeted dump of any element that looks like an editor modal root
    const modalDump = await browser.page.evaluate(() => {
      const candidates: string[] = [];
      const seen = new Set<Element>();
      for (const el of Array.from(document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="editor" i]'))) {
        // Dedup by outermost matching ancestor
        let root: Element = el;
        while (root.parentElement && (
          root.parentElement.getAttribute('role') === 'dialog' ||
          /modal|editor/i.test(root.parentElement.className || '')
        )) {
          root = root.parentElement;
        }
        if (seen.has(root)) continue;
        seen.add(root);
        candidates.push((root as HTMLElement).outerHTML.slice(0, 50000));
      }
      return candidates;
    });
    fs.writeFileSync(path.join(OUT_DIR, 'editor-modal-candidates.html'), modalDump.join('\n\n<!-- === NEXT CANDIDATE === -->\n\n'));

    // Interactive element inventory — every button/input with its accessible name + selector
    const interactive = await browser.page.evaluate(() => {
      const buildSelector = (el: Element): string => {
        if (el.id) return `#${el.id}`;
        const e2e = el.getAttribute('data-e2e');
        if (e2e) return `[data-e2e="${e2e}"]`;
        const aria = el.getAttribute('aria-label');
        if (aria) return `${el.tagName.toLowerCase()}[aria-label="${aria.replace(/"/g, '\\"')}"]`;
        const className = (el.className || '').toString().split(/\s+/).filter(c => c && !/^[0-9]/.test(c))[0];
        if (className) return `${el.tagName.toLowerCase()}.${className}`;
        return el.tagName.toLowerCase();
      };
      const out: Array<{
        tag: string;
        text: string;
        name: string;
        selector: string;
        dataAttrs: Record<string, string>;
      }> = [];
      for (const el of Array.from(document.querySelectorAll('button, input, [role="button"], [contenteditable="true"], textarea'))) {
        const he = el as HTMLElement;
        const rect = he.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;  // skip hidden
        const dataAttrs: Record<string, string> = {};
        for (const a of Array.from(he.attributes)) {
          if (a.name.startsWith('data-')) dataAttrs[a.name] = a.value;
        }
        out.push({
          tag: el.tagName.toLowerCase(),
          text: (he.innerText || '').trim().slice(0, 80),
          name: he.getAttribute('aria-label') || (he as HTMLInputElement).placeholder || '',
          selector: buildSelector(el),
          dataAttrs,
        });
      }
      return out;
    });
    fs.writeFileSync(path.join(OUT_DIR, 'interactive-elements.json'), JSON.stringify(interactive, null, 2));

    console.log('\n[capture] DONE. Artifacts written to /tmp/tiktok-editor/:');
    for (const f of fs.readdirSync(OUT_DIR)) {
      const p = path.join(OUT_DIR, f);
      const size = fs.statSync(p).size;
      console.log(`  - ${f}  (${size.toLocaleString()} bytes)`);
    }
    console.log('\n[capture] Paste the contents of these files back to Claude:');
    console.log('  - interactive-elements.json');
    console.log('  - editor-modal-candidates.html (first ~50KB)');
    console.log('  - (optionally) screenshot-4-editor-open.png');
  } finally {
    consoleStream.end();
    await browser.close();
  }
}

main().catch(err => {
  console.error('[capture] FAILED:', err);
  process.exit(1);
});
