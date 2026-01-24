import type { Browser, BrowserContext, Page } from 'playwright';

export type BrowserType = 'chromium' | 'camoufox';

export interface BrowserSession {
  name: string;
  type: BrowserType;
  browser: Browser | BrowserContext;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
}

export interface SessionInfo {
  name: string;
  type: BrowserType;
  url: string;
  createdAt: string;
}
