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

/**
 * Ref map for element references from ARIA snapshots.
 * Derived from agent-browser by Vercel Inc. (Apache 2.0)
 */
export interface RefMap {
  [ref: string]: {
    role: string;
    name?: string;
    /** Index for disambiguation when multiple elements have same role+name */
    nth?: number;
  };
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
  /** Cached refs from last snapshot */
  refMap: RefMap;
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
