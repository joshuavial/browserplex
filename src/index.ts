#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sharp from "sharp";
import type { Locator } from "playwright";
import { sessionManager } from "./sessions.js";
import { storageManager } from "./storage.js";
import { getEnhancedSnapshot, getLocatorFromRef, isRef, getSnapshotStats } from "./snapshot.js";
import type { BrowserSession } from "./types.js";

const server = new McpServer({
  name: "browserplex",
  version: "0.1.0",
});

// Helper to format tool results
function success(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function error(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/**
 * Get a Playwright locator from a ref (@e1) or CSS selector.
 * Refs are looked up in the session's refMap from the last snapshot.
 */
function getLocator(session: BrowserSession, selector: string): Locator {
  if (isRef(selector)) {
    const locator = getLocatorFromRef(session.page, session.refMap, selector);
    if (!locator) {
      throw new Error(`Ref '${selector}' not found. Run browser_snapshot first to get current refs.`);
    }
    return locator;
  }
  return session.page.locator(selector);
}

/**
 * Convert Playwright errors to AI-friendly messages with actionable guidance.
 */
function toAIFriendlyError(e: unknown, selector: string): string {
  const message = e instanceof Error ? e.message : String(e);

  if (message.includes('strict mode violation')) {
    return `Selector "${selector}" matched multiple elements. Use browser_snapshot to get specific refs, or use a more specific CSS selector.`;
  }
  if (message.includes('intercepts pointer events')) {
    return `Element "${selector}" is blocked by another element (likely a modal or overlay). Try dismissing any modals/cookie banners first.`;
  }
  if (message.includes('not visible') || message.includes('element is not visible')) {
    return `Element "${selector}" is not visible. Try scrolling it into view or check if it's hidden.`;
  }
  if (message.includes('Timeout')) {
    return `Timeout waiting for "${selector}". The element may not exist or may be slow to appear. Try increasing timeout or check the selector.`;
  }

  return message;
}

// Session management tools
server.tool(
  "session_create",
  "Create a new named browser session",
  {
    name: z.string().describe("Unique name for this browser session"),
    type: z.enum(["chromium", "firefox", "webkit", "camoufox"]).default("chromium").describe("Browser type: chromium (default), firefox, webkit (Safari), or camoufox (stealth Firefox)"),
    headless: z.boolean().optional().describe("Run headless (default: true for chromium, false for camoufox)"),
  },
  async ({ name, type, headless }) => {
    try {
      // Note: Zod defaults don't apply via MCP SDK, so we must apply explicitly
      const browserType = type ?? 'chromium';
      // Default: chromium headless, camoufox headed (for manual interaction)
      const useHeadless = headless ?? (browserType === 'chromium');
      const session = await sessionManager.create(name, browserType, useHeadless);
      return success(`Created ${browserType} session '${name}'${useHeadless ? '' : ' (headed)'}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "session_list",
  "List all active browser sessions",
  {},
  async () => {
    const sessions = sessionManager.list();
    if (sessions.length === 0) {
      return success("No active sessions");
    }
    const lines = sessions.map(s => `- ${s.name} (${s.type}): ${s.url}`);
    return success(`Active sessions:\n${lines.join("\n")}`);
  }
);

server.tool(
  "session_destroy",
  "Close and cleanup a browser session",
  {
    name: z.string().describe("Name of the session to destroy"),
  },
  async ({ name }) => {
    try {
      await sessionManager.destroy(name);
      return success(`Destroyed session '${name}'`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

// Storage tools - persistent session state across browser instances
server.tool(
  "storage_save",
  "Save browser session cookies/storage to a named file for later reuse",
  {
    session: z.string().describe("Session name"),
    domain: z.string().describe("Domain to associate with this storage (e.g., 'linkedin.com')"),
    name: z.string().default("default").describe("Name for this stored session (e.g., 'work', 'personal')"),
  },
  async ({ session, domain, name }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const storageName = name ?? 'default';
      const savedPath = await storageManager.save(s.context, domain, storageName);
      return success(`Saved session '${storageName}' for ${domain}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "storage_load",
  "Load stored session cookies/storage into a new browser session",
  {
    name: z.string().describe("Name for the new browser session"),
    domain: z.string().describe("Domain to load storage from"),
    storageName: z.string().default("default").describe("Name of the stored session to load"),
    type: z.enum(["chromium", "firefox", "webkit", "camoufox"]).default("chromium").describe("Browser type"),
    headless: z.boolean().optional().describe("Run headless (default: true for chromium, false for camoufox)"),
  },
  async ({ name, domain, storageName, type, headless }) => {
    try {
      const browserType = type ?? 'chromium';
      const storage = storageName ?? 'default';

      // Load storage state
      const storageState = await storageManager.load(domain, storage);

      // Create session with the loaded storage state
      const useHeadless = headless ?? (browserType === 'chromium');
      const session = await sessionManager.createWithStorage(name, browserType, useHeadless, storageState);

      return success(`Created ${browserType} session '${name}' with stored session '${storage}' for ${domain}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "storage_list",
  "List all stored browser sessions",
  {
    domain: z.string().optional().describe("Filter by domain (optional)"),
  },
  async ({ domain }) => {
    try {
      const sessions = await storageManager.list(domain);
      if (sessions.length === 0) {
        return success(domain ? `No stored sessions for ${domain}` : "No stored sessions");
      }
      const lines = sessions.map(s => `- ${s.domain}/${s.name} (modified: ${s.modifiedAt})`);
      return success(`Stored sessions:\n${lines.join("\n")}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "storage_delete",
  "Delete a stored browser session",
  {
    domain: z.string().describe("Domain of the stored session"),
    name: z.string().default("default").describe("Name of the stored session"),
  },
  async ({ domain, name }) => {
    try {
      const storageName = name ?? 'default';
      await storageManager.delete(domain, storageName);
      return success(`Deleted stored session '${storageName}' for ${domain}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "storage_lock",
  "Acquire a lock for a domain (use during auth flows to prevent concurrent logins)",
  {
    domain: z.string().describe("Domain to lock"),
  },
  async ({ domain }) => {
    try {
      const acquired = await storageManager.acquireLock(domain);
      if (acquired) {
        return success(`Acquired lock for ${domain}`);
      } else {
        return error(`Failed to acquire lock for ${domain} - another process holds it`);
      }
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "storage_unlock",
  "Release a lock for a domain",
  {
    domain: z.string().describe("Domain to unlock"),
  },
  async ({ domain }) => {
    try {
      await storageManager.releaseLock(domain);
      return success(`Released lock for ${domain}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

// Navigation tools
server.tool(
  "browser_navigate",
  "Navigate to a URL",
  {
    session: z.string().describe("Session name"),
    url: z.string().describe("URL to navigate to"),
  },
  async ({ session, url }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      await s.page.goto(url, { waitUntil: "domcontentloaded" });
      return success(`Navigated to ${url}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_navigate_back",
  "Navigate back in browser history",
  {
    session: z.string().describe("Session name"),
  },
  async ({ session }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      await s.page.goBack();
      return success(`Navigated back to ${s.page.url()}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_snapshot",
  "Get an accessibility tree snapshot with element refs for interaction. Use refs (@e1, @e2) with click/type tools instead of CSS selectors for more reliable automation.",
  {
    session: z.string().describe("Session name"),
    interactive: z.boolean().default(false).describe("Only show interactive elements (buttons, links, inputs) - much smaller output"),
    compact: z.boolean().default(false).describe("Remove empty structural elements"),
    maxDepth: z.number().optional().describe("Maximum tree depth (0 = root only)"),
    selector: z.string().optional().describe("CSS selector to scope the snapshot to a specific element"),
  },
  async ({ session, interactive, compact, maxDepth, selector }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const title = await s.page.title();
      const url = s.page.url();

      const snapshot = await getEnhancedSnapshot(s.page, {
        interactive: interactive ?? false,
        compact: compact ?? false,
        maxDepth,
        selector,
      });

      // Store refs in session for later use with click/type/etc
      s.refMap = snapshot.refs;

      const stats = getSnapshotStats(snapshot.tree, snapshot.refs);

      return success(
        `Page: ${title}\nURL: ${url}\n` +
        `Stats: ${stats.refs} refs, ${stats.interactive} interactive, ~${stats.tokens} tokens\n\n` +
        `${snapshot.tree}\n\n` +
        `Use refs like @e1, @e2 with browser_click, browser_type, etc.`
      );
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_take_screenshot",
  "Take a screenshot of the current page (auto-resized to fit LLM limits)",
  {
    session: z.string().describe("Session name"),
    fullPage: z.boolean().default(false).describe("Capture full scrollable page"),
    maxDimension: z.number().default(1280).describe("Max width/height in pixels (default 1280, safe for LLM context)"),
  },
  async ({ session, fullPage, maxDimension }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const rawBuffer = await s.page.screenshot({ fullPage });

      // Resize if needed to stay within LLM image limits
      // Note: Zod defaults don't apply via MCP SDK, so we must apply explicitly
      const maxDim = maxDimension ?? 1280;
      const metadata = await sharp(rawBuffer).metadata();
      let buffer = rawBuffer;

      if (metadata.width && metadata.height) {
        const maxSide = Math.max(metadata.width, metadata.height);
        if (maxSide > maxDim) {
          buffer = await sharp(rawBuffer)
            .resize(maxDim, maxDim, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer();
        }
      }

      const base64 = buffer.toString("base64");
      return {
        content: [{
          type: "image" as const,
          data: base64,
          mimeType: "image/png",
        }],
      };
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

// Interaction tools
server.tool(
  "browser_click",
  "Click an element on the page. Use refs (@e1, @e2) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("Element ref (@e1) or CSS selector to click"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      const locator = getLocator(s, selector);
      await locator.click({ timeout: t });
      return success(`Clicked '${selector}'`);
    } catch (e) {
      return error(toAIFriendlyError(e, selector));
    }
  }
);

server.tool(
  "browser_type",
  "Type text into an input element. Use refs (@e1, @e2) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("Element ref (@e3) or CSS selector for the input"),
    text: z.string().describe("Text to type"),
    submit: z.boolean().default(false).describe("Press Enter after typing"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, text, submit, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      const locator = getLocator(s, selector);
      await locator.fill(text, { timeout: t });
      if (submit) {
        await locator.press("Enter", { timeout: t });
      }
      return success(`Typed into '${selector}'${submit ? " and submitted" : ""}`);
    } catch (e) {
      return error(toAIFriendlyError(e, selector));
    }
  }
);

server.tool(
  "browser_press_key",
  "Press a keyboard key",
  {
    session: z.string().describe("Session name"),
    key: z.string().describe("Key to press (e.g., Enter, Escape, ArrowDown)"),
  },
  async ({ session, key }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      await s.page.keyboard.press(key);
      return success(`Pressed '${key}'`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_hover",
  "Hover over an element. Use refs (@e1, @e2) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("Element ref (@e1) or CSS selector to hover over"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      const locator = getLocator(s, selector);
      await locator.hover({ timeout: t });
      return success(`Hovering over '${selector}'`);
    } catch (e) {
      return error(toAIFriendlyError(e, selector));
    }
  }
);

server.tool(
  "browser_drag",
  "Drag an element to another location. Use refs (@e1, @e2) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    sourceSelector: z.string().describe("Element ref or CSS selector for element to drag"),
    targetSelector: z.string().describe("Element ref or CSS selector for drop target"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, sourceSelector, targetSelector, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      const sourceLocator = getLocator(s, sourceSelector);
      const targetLocator = getLocator(s, targetSelector);
      await sourceLocator.dragTo(targetLocator, { timeout: t });
      return success(`Dragged '${sourceSelector}' to '${targetSelector}'`);
    } catch (e) {
      return error(toAIFriendlyError(e, sourceSelector));
    }
  }
);

server.tool(
  "browser_select_option",
  "Select an option from a dropdown. Use refs (@e1) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("Element ref or CSS selector for the select element"),
    value: z.string().optional().describe("Option value to select"),
    label: z.string().optional().describe("Option label to select"),
    index: z.number().optional().describe("Option index to select (0-based)"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, value, label, index, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      const locator = getLocator(s, selector);
      let selected: string[];
      if (value !== undefined) {
        selected = await locator.selectOption({ value }, { timeout: t });
      } else if (label !== undefined) {
        selected = await locator.selectOption({ label }, { timeout: t });
      } else if (index !== undefined) {
        selected = await locator.selectOption({ index }, { timeout: t });
      } else {
        return error("Must provide value, label, or index");
      }
      return success(`Selected option(s): ${selected.join(', ')}`);
    } catch (e) {
      return error(toAIFriendlyError(e, selector));
    }
  }
);

server.tool(
  "browser_file_upload",
  "Upload file(s) to a file input element. Use refs (@e1) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("Element ref or CSS selector for the file input"),
    files: z.array(z.string()).describe("Array of file paths to upload"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, files, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      const locator = getLocator(s, selector);
      await locator.setInputFiles(files, { timeout: t });
      return success(`Uploaded ${files.length} file(s) to '${selector}'`);
    } catch (e) {
      return error(toAIFriendlyError(e, selector));
    }
  }
);

server.tool(
  "browser_fill_form",
  "Fill multiple form fields at once. Use refs (@e1, @e2) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    fields: z.array(z.object({
      selector: z.string().describe("Element ref or CSS selector for the input"),
      value: z.string().describe("Value to fill"),
    })).describe("Array of {selector, value} pairs"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, fields, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      for (const field of fields) {
        const locator = getLocator(s, field.selector);
        await locator.fill(field.value, { timeout: t });
      }
      return success(`Filled ${fields.length} form field(s)`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_handle_dialog",
  "Handle JavaScript dialogs (alert, confirm, prompt)",
  {
    session: z.string().describe("Session name"),
    action: z.enum(["accept", "dismiss"]).describe("Whether to accept or dismiss the dialog"),
    promptText: z.string().optional().describe("Text to enter for prompt dialogs"),
  },
  async ({ session, action, promptText }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      s.page.once('dialog', async (dialog) => {
        if (action === 'accept') {
          await dialog.accept(promptText);
        } else {
          await dialog.dismiss();
        }
      });
      return success(`Dialog handler set to ${action}${promptText ? ` with text '${promptText}'` : ''}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

// Utility tools
server.tool(
  "browser_wait_for",
  "Wait for an element or condition. Use refs (@e1) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    selector: z.string().optional().describe("Element ref or CSS selector to wait for"),
    state: z.enum(["attached", "detached", "visible", "hidden"]).default("visible").describe("State to wait for"),
    timeout: z.number().default(30000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, state, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const waitState = state ?? 'visible';
      const t = timeout ?? 30000;
      if (selector) {
        const locator = getLocator(s, selector);
        await locator.waitFor({ state: waitState, timeout: t });
        return success(`Element '${selector}' is ${waitState}`);
      } else {
        await s.page.waitForLoadState("networkidle", { timeout: t });
        return success("Page load complete");
      }
    } catch (e) {
      return error(toAIFriendlyError(e, selector ?? 'page'));
    }
  }
);

server.tool(
  "browser_evaluate",
  "Execute JavaScript in the page context",
  {
    session: z.string().describe("Session name"),
    script: z.string().describe("JavaScript code to execute"),
  },
  async ({ session, script }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const result = await s.page.evaluate(script);
      return success(JSON.stringify(result, null, 2));
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_resize",
  "Resize the browser viewport",
  {
    session: z.string().describe("Session name"),
    width: z.number().describe("Viewport width in pixels"),
    height: z.number().describe("Viewport height in pixels"),
  },
  async ({ session, width, height }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      await s.page.setViewportSize({ width, height });
      return success(`Resized viewport to ${width}x${height}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_console_messages",
  "Get console messages from the page",
  {
    session: z.string().describe("Session name"),
    clear: z.boolean().default(false).describe("Clear messages after retrieving"),
  },
  async ({ session, clear }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const messages = [...s.consoleMessages];
      if (clear) {
        s.consoleMessages.length = 0;
      }
      if (messages.length === 0) {
        return success("No console messages");
      }
      const lines = messages.map(m => `[${m.type}] ${m.text}`);
      return success(`Console messages (${messages.length}):\n${lines.join('\n')}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_network_requests",
  "Get network requests made by the page",
  {
    session: z.string().describe("Session name"),
    clear: z.boolean().default(false).describe("Clear requests after retrieving"),
  },
  async ({ session, clear }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const requests = [...s.networkRequests];
      if (clear) {
        s.networkRequests.length = 0;
      }
      if (requests.length === 0) {
        return success("No network requests");
      }
      const lines = requests.map(r => `${r.method} ${r.url} ${r.status ?? 'pending'}`);
      return success(`Network requests (${requests.length}):\n${lines.join('\n')}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_tabs",
  "List or switch between tabs/pages in a session",
  {
    session: z.string().describe("Session name"),
    action: z.enum(["list", "new", "switch", "close"]).default("list").describe("Action to perform"),
    index: z.number().optional().describe("Tab index for switch/close actions (0-based)"),
    url: z.string().optional().describe("URL to open in new tab"),
  },
  async ({ session, action, index, url }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const pages = s.context.pages();
      const act = action ?? 'list';

      if (act === 'list') {
        const tabs = pages.map((p, i) => `${i}: ${p.url()}`);
        return success(`Tabs (${pages.length}):\n${tabs.join('\n')}`);
      } else if (act === 'new') {
        const newPage = await s.context.newPage();
        if (url) {
          await newPage.goto(url);
        }
        s.page = newPage;
        return success(`Created new tab${url ? ` at ${url}` : ''}`);
      } else if (act === 'switch') {
        if (index === undefined || index < 0 || index >= pages.length) {
          return error(`Invalid tab index. Valid range: 0-${pages.length - 1}`);
        }
        s.page = pages[index];
        return success(`Switched to tab ${index}: ${s.page.url()}`);
      } else if (act === 'close') {
        if (pages.length === 1) {
          return error("Cannot close the last tab");
        }
        const closeIndex = index ?? pages.indexOf(s.page);
        if (closeIndex < 0 || closeIndex >= pages.length) {
          return error(`Invalid tab index. Valid range: 0-${pages.length - 1}`);
        }
        await pages[closeIndex].close();
        if (s.page === pages[closeIndex]) {
          s.page = s.context.pages()[0];
        }
        return success(`Closed tab ${closeIndex}`);
      }
      return error(`Unknown action: ${act}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

// Cleanup on exit
process.on("SIGINT", async () => {
  await sessionManager.destroyAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await sessionManager.destroyAll();
  process.exit(0);
});

// Start the server
const transport = new StdioServerTransport();
await server.connect(transport);
