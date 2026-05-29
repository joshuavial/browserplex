#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { sessionManager } from "../core/sessions.js";
import * as actions from "../core/actions.js";
import type { ActionResult } from "../core/types.js";

const server = new McpServer({
  name: "browserplex",
  version: "0.4.0",
});

type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

/**
 * Map a core ActionResult to MCP content blocks, preserving the original wire
 * shape: a single text block normally; for screenshots, the image block alone
 * (no savePath) or a text block followed by the image block (savePath set).
 */
function toMcp(result: ActionResult) {
  const content: McpContent[] = [];
  if (result.image) {
    if (result.text !== "") {
      content.push({ type: "text", text: result.text });
    }
    content.push({ type: "image", data: result.image.base64, mimeType: result.image.mimeType });
  } else {
    content.push({ type: "text", text: result.text });
  }
  return { content };
}

function error(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

/** Run a core action and map success/throw to MCP success/error output. */
async function wrap(fn: () => Promise<ActionResult>) {
  try {
    return toMcp(await fn());
  } catch (e) {
    return error((e as Error).message);
  }
}

// ---- Session management ----
server.tool(
  "session_create",
  "Create a new named browser session",
  {
    name: z.string().describe("Unique name for this browser session"),
    type: z.enum(["chromium", "firefox", "webkit", "camoufox", "electron"]).default("chromium").describe("Browser type: chromium (default), firefox, webkit (Safari), camoufox (stealth Firefox), or electron (drive an Electron app)"),
    headless: z.boolean().optional().describe("Run headless (default: true for chromium, false for camoufox; ignored for electron, which always opens a real window)"),
    electronArgs: z.array(z.string()).optional().describe("electron only: args passed to the Electron launch (default ['.']), e.g. the path to the target app"),
    executablePath: z.string().optional().describe("electron only: path to the Electron binary to launch (e.g. the target app's node_modules/.bin/electron). Selects WHICH Electron runs; if omitted, falls back to browserplex's dev-only bundled electron"),
    cwd: z.string().optional().describe("electron only: spawn working directory (does NOT select the Electron binary — use executablePath for that)"),
    env: z.record(z.string()).optional().describe("electron only: extra environment variables for the launched app (e.g. test-mode hooks)"),
  },
  async (args) => wrap(() => actions.sessionCreate(args)),
);

server.tool(
  "session_list",
  "List all active browser sessions",
  {},
  async () => wrap(() => actions.sessionList()),
);

server.tool(
  "session_destroy",
  "Close and cleanup a browser session",
  {
    name: z.string().describe("Name of the session to destroy"),
  },
  async (args) => wrap(() => actions.sessionDestroy(args)),
);

// ---- Storage ----
server.tool(
  "storage_save",
  "Save browser session cookies/storage to a named file for later reuse",
  {
    session: z.string().describe("Session name"),
    domain: z.string().describe("Domain to associate with this storage (e.g., 'linkedin.com')"),
    name: z.string().default("default").describe("Name for this stored session (e.g., 'work', 'personal')"),
  },
  async (args) => wrap(() => actions.storageSave(args)),
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
  async (args) => wrap(() => actions.storageLoad(args)),
);

server.tool(
  "storage_list",
  "List all stored browser sessions",
  {
    domain: z.string().optional().describe("Filter by domain (optional)"),
  },
  async (args) => wrap(() => actions.storageList(args)),
);

server.tool(
  "storage_delete",
  "Delete a stored browser session",
  {
    domain: z.string().describe("Domain of the stored session"),
    name: z.string().default("default").describe("Name of the stored session"),
  },
  async (args) => wrap(() => actions.storageDelete(args)),
);

server.tool(
  "storage_lock",
  "Acquire a lock for a domain (use during auth flows to prevent concurrent logins)",
  {
    domain: z.string().describe("Domain to lock"),
  },
  async (args) => wrap(() => actions.storageLock(args)),
);

server.tool(
  "storage_unlock",
  "Release a lock for a domain",
  {
    domain: z.string().describe("Domain to unlock"),
  },
  async (args) => wrap(() => actions.storageUnlock(args)),
);

// ---- Navigation ----
server.tool(
  "browser_navigate",
  "Navigate to a URL",
  {
    session: z.string().describe("Session name"),
    url: z.string().describe("URL to navigate to"),
  },
  async (args) => wrap(() => actions.browserNavigate(args)),
);

server.tool(
  "browser_navigate_back",
  "Navigate back in browser history",
  {
    session: z.string().describe("Session name"),
  },
  async (args) => wrap(() => actions.browserNavigateBack(args)),
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
  async (args) => wrap(() => actions.browserSnapshot(args)),
);

server.tool(
  "browser_take_screenshot",
  "Take a screenshot of the current page (auto-resized to fit LLM limits). Optionally save the original (un-resized) PNG to disk via savePath.",
  {
    session: z.string().describe("Session name"),
    fullPage: z.boolean().default(false).describe("Capture full scrollable page"),
    maxDimension: z.number().default(1280).describe("Max width/height in pixels (default 1280, safe for LLM context)"),
    savePath: z.string().optional().describe("Absolute path to write the original (un-resized) PNG. Parent directory must already exist. When set, the response includes a text confirmation alongside the (resized) image."),
  },
  async (args) => wrap(() => actions.browserTakeScreenshot(args)),
);

// ---- Interaction ----
server.tool(
  "browser_click",
  "Click an element on the page. Use refs (@e1, @e2) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("Element ref (@e1) or CSS selector to click"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async (args) => wrap(() => actions.browserClick(args)),
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
  async (args) => wrap(() => actions.browserType(args)),
);

server.tool(
  "browser_press_key",
  "Press a keyboard key",
  {
    session: z.string().describe("Session name"),
    key: z.string().describe("Key to press (e.g., Enter, Escape, ArrowDown)"),
  },
  async (args) => wrap(() => actions.browserPressKey(args)),
);

server.tool(
  "browser_hover",
  "Hover over an element. Use refs (@e1, @e2) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    selector: z.string().describe("Element ref (@e1) or CSS selector to hover over"),
    timeout: z.number().default(5000).describe("Timeout in milliseconds"),
  },
  async (args) => wrap(() => actions.browserHover(args)),
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
  async (args) => wrap(() => actions.browserDrag(args)),
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
  async (args) => wrap(() => actions.browserSelectOption(args)),
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
  async (args) => wrap(() => actions.browserFileUpload(args)),
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
  async (args) => wrap(() => actions.browserFillForm(args)),
);

server.tool(
  "browser_handle_dialog",
  "Handle JavaScript dialogs (alert, confirm, prompt)",
  {
    session: z.string().describe("Session name"),
    action: z.enum(["accept", "dismiss"]).describe("Whether to accept or dismiss the dialog"),
    promptText: z.string().optional().describe("Text to enter for prompt dialogs"),
  },
  async (args) => wrap(() => actions.browserHandleDialog(args)),
);

// ---- Utilities ----
server.tool(
  "browser_wait_for",
  "Wait for an element or condition. Use refs (@e1) from browser_snapshot or CSS selectors.",
  {
    session: z.string().describe("Session name"),
    selector: z.string().optional().describe("Element ref or CSS selector to wait for"),
    state: z.enum(["attached", "detached", "visible", "hidden"]).default("visible").describe("State to wait for"),
    timeout: z.number().default(30000).describe("Timeout in milliseconds"),
  },
  async (args) => wrap(() => actions.browserWaitFor(args)),
);

server.tool(
  "browser_evaluate",
  "Execute JavaScript in the page context",
  {
    session: z.string().describe("Session name"),
    script: z.string().describe("JavaScript code to execute"),
  },
  async (args) => wrap(() => actions.browserEvaluate(args)),
);

server.tool(
  "browser_resize",
  "Resize the browser viewport",
  {
    session: z.string().describe("Session name"),
    width: z.number().describe("Viewport width in pixels"),
    height: z.number().describe("Viewport height in pixels"),
  },
  async (args) => wrap(() => actions.browserResize(args)),
);

server.tool(
  "browser_console_messages",
  "Get console messages from the page",
  {
    session: z.string().describe("Session name"),
    clear: z.boolean().default(false).describe("Clear messages after retrieving"),
  },
  async (args) => wrap(() => actions.browserConsoleMessages(args)),
);

server.tool(
  "browser_network_requests",
  "Get network requests made by the page",
  {
    session: z.string().describe("Session name"),
    clear: z.boolean().default(false).describe("Clear requests after retrieving"),
  },
  async (args) => wrap(() => actions.browserNetworkRequests(args)),
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
  async (args) => wrap(() => actions.browserTabs(args)),
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
