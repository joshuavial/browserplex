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

server.tool(
  "browser_drag",
  "Drag an element to another location",
  {
    session: z.string().describe("Session name"),
    sourceSelector: z.string().describe("CSS selector for element to drag"),
    targetSelector: z.string().describe("CSS selector for drop target"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, sourceSelector, targetSelector, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      await s.page.dragAndDrop(sourceSelector, targetSelector, { timeout: t });
      return success(`Dragged '${sourceSelector}' to '${targetSelector}'`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_select_option",
  "Select an option from a dropdown",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("CSS selector for the select element"),
    value: z.string().optional().describe("Option value to select"),
    label: z.string().optional().describe("Option label to select"),
    index: z.number().optional().describe("Option index to select (0-based)"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, value, label, index, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      let selected: string[];
      if (value !== undefined) {
        selected = await s.page.selectOption(selector, { value }, { timeout: t });
      } else if (label !== undefined) {
        selected = await s.page.selectOption(selector, { label }, { timeout: t });
      } else if (index !== undefined) {
        selected = await s.page.selectOption(selector, { index }, { timeout: t });
      } else {
        return error("Must provide value, label, or index");
      }
      return success(`Selected option(s): ${selected.join(', ')}`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_file_upload",
  "Upload file(s) to a file input element",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("CSS selector for the file input"),
    files: z.array(z.string()).describe("Array of file paths to upload"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, selector, files, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      await s.page.setInputFiles(selector, files, { timeout: t });
      return success(`Uploaded ${files.length} file(s) to '${selector}'`);
    } catch (e) {
      return error((e as Error).message);
    }
  }
);

server.tool(
  "browser_fill_form",
  "Fill multiple form fields at once",
  {
    session: z.string().describe("Session name"),
    fields: z.array(z.object({
      selector: z.string().describe("CSS selector for the input"),
      value: z.string().describe("Value to fill"),
    })).describe("Array of {selector, value} pairs"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async ({ session, fields, timeout }) => {
    try {
      const s = sessionManager.getOrThrow(session);
      const t = timeout ?? 5000;
      for (const field of fields) {
        await s.page.fill(field.selector, field.value, { timeout: t });
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
