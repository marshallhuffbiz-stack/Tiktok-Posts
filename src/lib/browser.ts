// src/lib/browser.ts
import { chromium, type BrowserContext, type Page } from 'playwright';
import path from 'node:path';

export interface OpenBrowserOptions {
  /** Absolute path to the persistent data dir. Default: ./browser-data/ */
  dataDir?: string;
  /** Show the browser window. Default: false (headless). */
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
  const context = await chromium.launchPersistentContext(dataDir, {
    headless: !opts.headed,
    viewport: { width: 1280, height: 800 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled'],
    // 60s default action timeout; specific waits override
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
