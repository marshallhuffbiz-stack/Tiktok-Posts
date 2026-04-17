// src/lib/browser.ts
import path from 'node:path';
import type { BrowserContext, Page } from 'patchright';
import { chromium } from 'patchright';

export interface OpenBrowserOptions {
  /** Absolute path to the persistent data dir. Default: ./browser-data/ */
  dataDir?: string;
  /** Show the browser window on-screen. Default: false (headed but off-screen). */
  headed?: boolean;
}

export interface OpenBrowserResult {
  context: BrowserContext;
  page: Page;
  /** Closes the context. Idempotent. */
  close(): Promise<void>;
}

export async function openBrowser(opts: OpenBrowserOptions = {}): Promise<OpenBrowserResult> {
  const dataDir = opts.dataDir ?? path.resolve('browser-data');
  const offScreen = !opts.headed;
  // Patchright with channel:'chrome' launches the user's installed Google Chrome
  // (NOT bundled Chromium). This passes browser-fingerprint checks that flag
  // bundled Chromium (missing Widevine, missing proprietary AAC, wrong
  // userAgentData.brands, etc.). Patchright also patches the CDP Runtime.Enable
  // leak that standard playwright-stealth/puppeteer-extra-plugin-stealth do NOT.
  const context = await chromium.launchPersistentContext(dataDir, {
    channel: 'chrome',
    headless: false,
    // No viewport override — let real Chrome use its native viewport.
    // (Patchright docs: omit no_viewport in TS by passing viewport: null.)
    viewport: null,
    // No user agent override — real Chrome sends a real Chrome UA.
    args: [
      ...(offScreen ? ['--window-position=10000,10000'] : []),
    ],
    timezoneId: 'America/New_York',
  });
  context.setDefaultTimeout(60_000);
  const page = context.pages()[0] ?? await context.newPage();
  let closed = false;
  return {
    context,
    page,
    async close() {
      if (closed) return;
      closed = true;
      await context.close();
    },
  };
}
