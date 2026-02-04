import type { Browser, BrowserContext, Page } from 'playwright';

export type BrowserType = 'chromium' | 'firefox' | 'webkit' | 'camoufox';

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: number;
}

export interface NetworkRequest {
  url: string;
  method: string;
  status?: number;
  timestamp: number;
}

export interface BrowserSession {
  name: string;
  type: BrowserType;
  browser: Browser | BrowserContext;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
  consoleMessages: ConsoleMessage[];
  networkRequests: NetworkRequest[];
}

export interface SessionInfo {
  name: string;
  type: BrowserType;
  url: string;
  createdAt: string;
}

export interface StoredSession {
  domain: string;
  name: string;
  path: string;
  modifiedAt: string;
}

export interface LockInfo {
  domain: string;
  acquiredAt: number;
  pid: number;
}
