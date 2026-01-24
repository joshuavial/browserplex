#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import sharp from "sharp";
import { sessionManager } from "./sessions.js";

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

// Session management tools
server.tool(
  "session_create",
  "Create a new named browser session",
  {
    name: z.string().describe("Unique name for this browser session"),
    type: z.enum(["chromium", "webkit", "camoufox"]).default("chromium").describe("Browser type: chromium (default), webkit (Safari engine), or camoufox (stealth)"),
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
  "browser_snapshot",
  "Get a structured snapshot of the current page (title, URL, and visible text content)",
  {
    session: z.string().describe("Session name"),
  },
  async ({ session }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const title = await s.page.title();
      const url = s.page.url();
      // Get visible text content
      const content = await s.page.evaluate(() => {
        const walk = (node: Node): string => {
          if (node.nodeType === Node.TEXT_NODE) {
            return node.textContent?.trim() || '';
          }
          if (node.nodeType !== Node.ELEMENT_NODE) return '';
          const el = node as Element;
          const tag = el.tagName.toLowerCase();
          // Skip hidden elements and scripts
          if (tag === 'script' || tag === 'style' || tag === 'noscript') return '';
          const style = window.getComputedStyle(el);
          if (style.display === 'none' || style.visibility === 'hidden') return '';

          const children = Array.from(node.childNodes).map(walk).filter(Boolean);
          const text = children.join(' ');

          // Add structure for semantic elements
          if (['h1','h2','h3','h4','h5','h6'].includes(tag)) {
            return `[${tag.toUpperCase()}] ${text}`;
          }
          if (tag === 'a' && el.getAttribute('href')) {
            return `[link: ${text}]`;
          }
          if (tag === 'button' || el.getAttribute('role') === 'button') {
            return `[button: ${text}]`;
          }
          if (tag === 'input') {
            const type = el.getAttribute('type') || 'text';
            const label = el.getAttribute('placeholder') || el.getAttribute('aria-label') || '';
            return `[input:${type} ${label}]`;
          }
          return text;
        };
        return walk(document.body);
      });

      return success(`Title: ${title}\nURL: ${url}\n\n${content}`);
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
  "Click an element on the page",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("CSS selector or text to click"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      await s.page.click(selector, { timeout: t });
      return success(`Clicked '${selector}'`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_type",
  "Type text into an input element",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("CSS selector for the input"),
    text: z.string().describe("Text to type"),
    submit: z.boolean().default(false).describe("Press Enter after typing"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, text, submit, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      await s.page.fill(selector, text, { timeout: t });
      if (submit) {
        await s.page.press(selector, "Enter", { timeout: t });
      }
      return success(`Typed into '${selector}'${submit ? " and submitted" : ""}`);
    } catch (e) {
      return error((e as Error).message);
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
  "Hover over an element",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("CSS selector to hover over"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      await s.page.hover(selector, { timeout: t });
      return success(`Hovering over '${selector}'`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

// Utility tools
server.tool(
  "browser_wait_for",
  "Wait for an element or condition",
  {
    session: z.string().describe("Session name"),
    selector: z.string().optional().describe("CSS selector to wait for"),
    state: z.enum(["attached", "detached", "visible", "hidden"]).default("visible").describe("State to wait for"),
    timeout: z.number().default(30000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, state, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const waitState = state ?? 'visible';
      const t = timeout ?? 30000;
      if (selector) {
        await s.page.waitForSelector(selector, { state: waitState, timeout: t });
        return success(`Element '${selector}' is ${waitState}`);
      } else {
        await s.page.waitForLoadState("networkidle", { timeout: t });
        return success("Page load complete");
      }
    } catch (e) {
      return error((e as Error).message);
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
