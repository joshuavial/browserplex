import type { Browser, BrowserContext, Page, ElectronApplication } from 'playwright';
import type { TauriLaunchOptions, TauriSession } from './tauri.js';

export type BrowserType = 'chromium' | 'firefox' | 'webkit' | 'camoufox' | 'electron' | 'tauri';

/** Launch options used only when type === 'electron'. */
export interface ElectronLaunchOptions {
  /** Args passed to electron (default ['.']). Typically the path to the target app. */
  args?: string[];
  /**
   * Path to the Electron binary to launch. This is what selects WHICH Electron is used
   * (e.g. the target app's own `node_modules/.bin/electron`). When omitted, Playwright
   * falls back to `require('electron')` resolved from browserplex's install — which is a
   * dev-only devDependency, so production users driving their own app should set this.
   */
  executablePath?: string;
  /** Spawn working directory (NOT used to resolve the Electron binary — that's executablePath). */
  cwd?: string;
  /** Extra environment for the launched app (e.g. test-mode hooks). */
  env?: Record<string, string>;
}

export type { TauriLaunchOptions };

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
  browser: Browser | BrowserContext | ElectronApplication | TauriSession;
  context: BrowserContext;
  page: Page;
  tauri?: TauriSession;
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

/**
 * Result of a core action. Frontends (MCP server, CLI/daemon) map this to their
 * own output: the MCP adapter turns `text`/`image` into content blocks; the CLI
 * prints `text` (or `data` under --json). Actions throw `Error` on failure.
 *
 * `data` MUST be JSON-serializable (plain objects/arrays/primitives) — it is the
 * daemon/CLI wire payload in later beads.
 */
export interface ActionResult {
  /** Human-readable summary (identical to the MCP server's prior success() text). */
  text: string;
  /** Structured payload for scripting (list/console/network/evaluate). JSON-serializable. */
  data?: unknown;
  /** Base64 image payload (screenshot only). */
  image?: { base64: string; mimeType: string };
}
