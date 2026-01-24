import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import type { BrowserSession, BrowserType, SessionInfo } from './types.js';

class SessionManager {
  private sessions: Map<string, BrowserSession> = new Map();

  async create(name: string, type: BrowserType = 'chromium'): Promise<BrowserSession> {
    if (this.sessions.has(name)) {
      throw new Error(`Session '${name}' already exists`);
    }

    let browser: Browser | BrowserContext;
    let context: BrowserContext;
    let page: Page;

    if (type === 'chromium') {
      browser = await chromium.launch({ headless: true });
      context = await browser.newContext();
      page = await context.newPage();
    } else if (type === 'camoufox') {
      // Camoufox returns a Browser or BrowserContext
      const { Camoufox } = await import('camoufox');
      const result = await Camoufox({ headless: true });
      // Camoufox can return Browser or BrowserContext depending on options
      if ('newContext' in result) {
        // It's a Browser
        browser = result as Browser;
        context = await (result as Browser).newContext();
      } else {
        // It's a BrowserContext
        context = result as BrowserContext;
        browser = context;
      }
      page = await context.newPage();
    } else {
      throw new Error(`Unknown browser type: ${type}`);
    }

    const session: BrowserSession = {
      name,
      type,
      browser,
      context,
      page,
      createdAt: new Date(),
    };

    this.sessions.set(name, session);
    return session;
  }

  get(name: string): BrowserSession | undefined {
    return this.sessions.get(name);
  }

  getOrThrow(name: string): BrowserSession {
    const session = this.sessions.get(name);
    if (!session) {
      throw new Error(`Session '${name}' not found. Create it first with session_create.`);
    }
    return session;
  }

  async destroy(name: string): Promise<void> {
    const session = this.sessions.get(name);
    if (!session) {
      throw new Error(`Session '${name}' not found`);
    }

    this.sessions.delete(name);
    try {
      await session.context.close();
      if (session.type === 'chromium' && 'close' in session.browser) {
        await (session.browser as Browser).close();
      }
    } catch {
      // Browser may already be closed
    }
  }

  list(): SessionInfo[] {
    const result: SessionInfo[] = [];
    for (const session of this.sessions.values()) {
      result.push({
        name: session.name,
        type: session.type,
        url: session.page.url(),
        createdAt: session.createdAt.toISOString(),
      });
    }
    return result;
  }

  async destroyAll(): Promise<void> {
    const names = Array.from(this.sessions.keys());
    for (const name of names) {
      try {
        await this.destroy(name);
      } catch {
        // Ignore errors during cleanup
      }
    }
  }
}

export const sessionManager = new SessionManager();
