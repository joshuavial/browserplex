import { promises as fs } from "node:fs";
import { sessionManager } from "./sessions.js";
import { storageManager } from "./storage.js";
import { getEnhancedSnapshot, getSnapshotStats } from "./snapshot.js";
import { getLocator, getSnapshotRoot, withFriendlyError } from "./locator.js";

/**
 * Normalize the `frame` argument to a string[] chain (outermost first), or
 * undefined for main-frame operations. Accepts a single string (one iframe)
 * or array of strings (nested iframes). This is the shared boundary for
 * iframe-aware actions — every action that supports `frame` should run its
 * input through this helper before passing to the locator helpers.
 */
function normalizeFrame(frame: unknown): string[] | undefined {
  if (frame === undefined || frame === null) return undefined;
  if (typeof frame === "string") return frame === "" ? undefined : [frame];
  if (Array.isArray(frame)) {
    const arr = frame.filter((v): v is string => typeof v === "string" && v !== "");
    return arr.length > 0 ? arr : undefined;
  }
  throw new Error(`frame must be a string or string[], got ${typeof frame}`);
}
import type { ElectronApplication } from "playwright";
import type { ActionResult, BrowserType } from "./types.js";

/**
 * Core actions: one async function per tool. Each returns an ActionResult or
 * throws an Error. These are framework-agnostic — the MCP server and the `bp`
 * CLI/daemon both call them. Behaviour is preserved verbatim from the original
 * MCP handlers (`src/index.ts`); only the success()/error() wrapping is removed
 * (the caller maps ActionResult → its own output, and catches throws).
 *
 * Note: zod defaults do not apply via the MCP SDK, so the explicit `?? default`
 * workarounds are preserved here exactly.
 */

// ---- Session management ----

/** Headless unless `headed` is set; `headless` still works as an explicit opt-in. Default: headless. */
function resolveHeadless(args: { headless?: boolean; headed?: boolean }): boolean {
  if (args.headed) return false;
  return args.headless ?? true;
}

export async function sessionCreate(args: {
  name: string;
  type?: BrowserType;
  headless?: boolean;
  headed?: boolean;
  // electron-only launch options (ignored for other types)
  electronArgs?: string[];
  executablePath?: string;
  cwd?: string;
  env?: Record<string, string>;
}): Promise<ActionResult> {
  const browserType = args.type ?? "chromium";
  // All browser types default to headless; `headed` (or headless:false) opts into a visible window.
  // Electron always opens a real window regardless.
  const useHeadless = browserType === "electron" ? false : resolveHeadless(args);
  const launch =
    browserType === "electron"
      ? { args: args.electronArgs, executablePath: args.executablePath, cwd: args.cwd, env: args.env }
      : undefined;
  await sessionManager.create(args.name, browserType, useHeadless, launch);
  return { text: `Created ${browserType} session '${args.name}'${useHeadless ? "" : " (headed)"}` };
}

export async function sessionList(): Promise<ActionResult> {
  const sessions = sessionManager.list();
  if (sessions.length === 0) {
    return { text: "No active sessions", data: [] };
  }
  const lines = sessions.map((s) => `- ${s.name} (${s.type}): ${s.url}`);
  return { text: `Active sessions:\n${lines.join("\n")}`, data: sessions };
}

export async function sessionDestroy(args: { name: string }): Promise<ActionResult> {
  await sessionManager.destroy(args.name);
  return { text: `Destroyed session '${args.name}'` };
}

// ---- Storage ----

export async function storageSave(args: {
  session: string;
  domain: string;
  name?: string;
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const storageName = args.name ?? "default";
  await storageManager.save(s.context, args.domain, storageName);
  return { text: `Saved session '${storageName}' for ${args.domain}` };
}

export async function storageLoad(args: {
  name: string;
  domain: string;
  storageName?: string;
  type?: BrowserType;
  headless?: boolean;
  headed?: boolean;
}): Promise<ActionResult> {
  const browserType = args.type ?? "chromium";
  const storage = args.storageName ?? "default";
  const storageState = await storageManager.load(args.domain, storage);
  const useHeadless = resolveHeadless(args); // headless by default; --headed opts in
  await sessionManager.createWithStorage(args.name, browserType, useHeadless, storageState);
  return {
    text: `Created ${browserType} session '${args.name}' with stored session '${storage}' for ${args.domain}`,
  };
}

export async function storageList(args: { domain?: string }): Promise<ActionResult> {
  const sessions = await storageManager.list(args.domain);
  if (sessions.length === 0) {
    return {
      text: args.domain ? `No stored sessions for ${args.domain}` : "No stored sessions",
      data: [],
    };
  }
  const lines = sessions.map((s) => `- ${s.domain}/${s.name} (modified: ${s.modifiedAt})`);
  return { text: `Stored sessions:\n${lines.join("\n")}`, data: sessions };
}

export async function storageDelete(args: { domain: string; name?: string }): Promise<ActionResult> {
  const storageName = args.name ?? "default";
  await storageManager.delete(args.domain, storageName);
  return { text: `Deleted stored session '${storageName}' for ${args.domain}` };
}

export async function storageLock(args: { domain: string }): Promise<ActionResult> {
  const acquired = await storageManager.acquireLock(args.domain);
  if (!acquired) {
    throw new Error(`Failed to acquire lock for ${args.domain} - another process holds it`);
  }
  return { text: `Acquired lock for ${args.domain}` };
}

export async function storageUnlock(args: { domain: string }): Promise<ActionResult> {
  await storageManager.releaseLock(args.domain);
  return { text: `Released lock for ${args.domain}` };
}

// ---- Navigation ----

export async function browserNavigate(args: { session: string; url: string }): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  await s.page.goto(args.url, { waitUntil: "domcontentloaded" });
  return { text: `Navigated to ${args.url}` };
}

export async function browserNavigateBack(args: { session: string }): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  await s.page.goBack();
  return { text: `Navigated back to ${s.page.url()}` };
}

export async function browserSnapshot(args: {
  session: string;
  interactive?: boolean;
  compact?: boolean;
  maxDepth?: number;
  selector?: string;
  frame?: string | string[];
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const title = await s.page.title();
  const url = s.page.url();
  const frame = normalizeFrame(args.frame);

  // When --frame is set, the snapshot is scoped to the (possibly nested)
  // iframe chain. Refs generated here are NOT compatible with main-frame
  // clicks/types — callers should use CSS selectors with the same --frame
  // for follow-up interactions inside the same iframe.
  const rootLocator = frame ? getSnapshotRoot(s, frame) : undefined;
  const snapshot = await getEnhancedSnapshot(s.page, {
    interactive: args.interactive ?? false,
    compact: args.compact ?? false,
    maxDepth: args.maxDepth,
    selector: frame ? undefined : args.selector,
    rootLocator,
  });

  // Store refs in session for later use with click/type/etc. Refs are
  // role+name pairs, so the same refMap works for both main-frame and
  // iframe-scoped resolution — the caller selects scope by passing (or
  // omitting) --frame on the follow-up action. Caveat: a refMap populated
  // by an iframe snapshot will not resolve sensibly against the main page,
  // and vice versa — keep snapshot scope and action scope in sync.
  s.refMap = snapshot.refs;

  const stats = getSnapshotStats(snapshot.tree, snapshot.refs);
  const frameNote = frame ? ` (scoped to iframe chain: ${frame.join(" >> ")})` : "";

  return {
    text:
      `Page: ${title}\nURL: ${url}${frameNote}\n` +
      `Stats: ${stats.refs} refs, ${stats.interactive} interactive, ~${stats.tokens} tokens\n\n` +
      `${snapshot.tree}\n\n` +
      (frame
        ? `Use CSS selectors with --frame ${frame.map((f) => JSON.stringify(f)).join(" --frame ")} for clicks/types inside this iframe.`
        : `Use refs like @e1, @e2 with browser_click, browser_type, etc.`),
    data: { title, url, stats, frame },
  };
}

export async function browserTakeScreenshot(args: {
  session: string;
  fullPage?: boolean;
  maxDimension?: number;
  savePath?: string;
}): Promise<ActionResult> {
  if (args.savePath !== undefined && !args.savePath.startsWith("/")) {
    throw new Error("savePath must be an absolute path");
  }

  const s = sessionManager.getOrThrow(args.session);
  const rawBuffer = await s.page.screenshot({ fullPage: args.fullPage ?? false });

  if (args.savePath) {
    await fs.writeFile(args.savePath, rawBuffer);
  }

  // Resize if needed to stay within LLM image limits. `sharp` is an OPTIONAL dependency (it's a
  // heavy native module) — loaded lazily; if it isn't installed we return the un-resized PNG.
  const maxDim = args.maxDimension ?? 1280;
  let buffer = rawBuffer;
  try {
    const { default: sharp } = await import("sharp");
    const metadata = await sharp(rawBuffer).metadata();
    if (metadata.width && metadata.height) {
      const maxSide = Math.max(metadata.width, metadata.height);
      if (maxSide > maxDim) {
        buffer = await sharp(rawBuffer)
          .resize(maxDim, maxDim, { fit: "inside", withoutEnlargement: true })
          .png()
          .toBuffer();
      }
    }
  } catch {
    // sharp not installed → skip resize, return the full-size screenshot.
    // Install sharp (`npm i sharp`) to enable auto-resize for LLM image limits.
  }

  const base64 = buffer.toString("base64");
  // text is set only when savePath was written; the adapter emits the text block
  // before the image block (preserving the original content[0]=text, content[1]=image).
  return {
    text: args.savePath ? `Saved screenshot to ${args.savePath}` : "",
    image: { base64, mimeType: "image/png" },
  };
}

// ---- Interaction ----

export async function browserClick(args: {
  session: string;
  selector: string;
  timeout?: number;
  frame?: string | string[];
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const t = args.timeout ?? 5000;
  const frame = normalizeFrame(args.frame);
  const locator = getLocator(s, args.selector, frame);
  await withFriendlyError(args.selector, () => locator.click({ timeout: t }));
  return { text: `Clicked '${args.selector}'${frame ? ` (in iframe ${frame.join(" >> ")})` : ""}` };
}

export async function browserType(args: {
  session: string;
  selector: string;
  text: string;
  submit?: boolean;
  timeout?: number;
  frame?: string | string[];
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const t = args.timeout ?? 5000;
  const frame = normalizeFrame(args.frame);
  const locator = getLocator(s, args.selector, frame);
  await withFriendlyError(args.selector, async () => {
    await locator.fill(args.text, { timeout: t });
    if (args.submit) {
      await locator.press("Enter", { timeout: t });
    }
  });
  return {
    text:
      `Typed into '${args.selector}'${args.submit ? " and submitted" : ""}` +
      (frame ? ` (in iframe ${frame.join(" >> ")})` : ""),
  };
}

export async function browserPressKey(args: { session: string; key: string }): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  // keyboard.press dispatches at the page level, not at an element — so it
  // operates on whichever element currently has focus (which can be inside
  // an iframe if the previous click/type was iframe-scoped). No --frame
  // plumbing needed here; users sequence press after an iframe click/type
  // and the keypress lands on the focused element regardless of frame.
  await s.page.keyboard.press(args.key);
  return { text: `Pressed '${args.key}'` };
}

export async function browserHover(args: {
  session: string;
  selector: string;
  timeout?: number;
  frame?: string | string[];
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const t = args.timeout ?? 5000;
  const frame = normalizeFrame(args.frame);
  const locator = getLocator(s, args.selector, frame);
  await withFriendlyError(args.selector, () => locator.hover({ timeout: t }));
  return { text: `Hovering over '${args.selector}'${frame ? ` (in iframe ${frame.join(" >> ")})` : ""}` };
}

export async function browserDrag(args: {
  session: string;
  sourceSelector: string;
  targetSelector: string;
  timeout?: number;
  frame?: string | string[];
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const t = args.timeout ?? 5000;
  // Drag both source and target inside the same iframe chain. Cross-frame
  // drags aren't supported here — that's an unusual UX and the browser's
  // own drag handlers usually can't span frames anyway.
  const frame = normalizeFrame(args.frame);
  const sourceLocator = getLocator(s, args.sourceSelector, frame);
  const targetLocator = getLocator(s, args.targetSelector, frame);
  await withFriendlyError(args.sourceSelector, () => sourceLocator.dragTo(targetLocator, { timeout: t }));
  return { text: `Dragged '${args.sourceSelector}' to '${args.targetSelector}'` };
}

export async function browserSelectOption(args: {
  session: string;
  selector: string;
  value?: string;
  label?: string;
  index?: number;
  timeout?: number;
  frame?: string | string[];
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const t = args.timeout ?? 5000;
  const frame = normalizeFrame(args.frame);
  const locator = getLocator(s, args.selector, frame);
  const selected = await withFriendlyError(args.selector, async () => {
    if (args.value !== undefined) {
      return locator.selectOption({ value: args.value }, { timeout: t });
    } else if (args.label !== undefined) {
      return locator.selectOption({ label: args.label }, { timeout: t });
    } else if (args.index !== undefined) {
      return locator.selectOption({ index: args.index }, { timeout: t });
    }
    throw new Error("Must provide value, label, or index");
  });
  return { text: `Selected option(s): ${selected.join(", ")}` };
}

export async function browserFileUpload(args: {
  session: string;
  selector: string;
  files: string[];
  timeout?: number;
  frame?: string | string[];
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const t = args.timeout ?? 5000;
  const frame = normalizeFrame(args.frame);
  const locator = getLocator(s, args.selector, frame);
  await withFriendlyError(args.selector, () => locator.setInputFiles(args.files, { timeout: t }));
  return { text: `Uploaded ${args.files.length} file(s) to '${args.selector}'` };
}

export async function browserFillForm(args: {
  session: string;
  fields: Array<{ selector: string; value: string }>;
  timeout?: number;
  frame?: string | string[];
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const t = args.timeout ?? 5000;
  // All fields share the same iframe scope — typical for multi-field forms
  // inside one Stripe Elements iframe or one embedded checkout. For a cross-
  // frame fill, call browser_fill_form once per frame.
  const frame = normalizeFrame(args.frame);
  for (const field of args.fields) {
    const locator = getLocator(s, field.selector, frame);
    await locator.fill(field.value, { timeout: t });
  }
  return {
    text: `Filled ${args.fields.length} form field(s)${frame ? ` (in iframe ${frame.join(" >> ")})` : ""}`,
  };
}

export async function browserHandleDialog(args: {
  session: string;
  action: "accept" | "dismiss";
  promptText?: string;
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  s.page.once("dialog", async (dialog) => {
    if (args.action === "accept") {
      await dialog.accept(args.promptText);
    } else {
      await dialog.dismiss();
    }
  });
  return {
    text: `Dialog handler set to ${args.action}${args.promptText ? ` with text '${args.promptText}'` : ""}`,
  };
}

// ---- Utilities ----

export async function browserWaitFor(args: {
  session: string;
  selector?: string;
  state?: "attached" | "detached" | "visible" | "hidden";
  timeout?: number;
  frame?: string | string[];
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const waitState = args.state ?? "visible";
  const t = args.timeout ?? 30000;
  const frame = normalizeFrame(args.frame);
  return withFriendlyError(args.selector ?? "page", async () => {
    if (args.selector) {
      const locator = getLocator(s, args.selector, frame);
      await locator.waitFor({ state: waitState, timeout: t });
      return { text: `Element '${args.selector}' is ${waitState}${frame ? ` (in iframe ${frame.join(" >> ")})` : ""}` };
    }
    await s.page.waitForLoadState("networkidle", { timeout: t });
    return { text: "Page load complete" };
  });
}

export async function browserEvaluate(args: { session: string; script: string }): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const result = await s.page.evaluate(args.script);
  // Preserve original formatting verbatim (incl. undefined-result behaviour).
  return { text: JSON.stringify(result, null, 2) as string, data: result };
}

// Run JavaScript in the Electron MAIN process (electron sessions only). The script body is
// evaluated with the Electron module bound to `electron` — e.g. stub native dialogs:
//   `electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: ['/x.mp4'] });`
// Same trust model as browser_evaluate, but with full Node/Electron (main) power.
export async function electronEvaluate(args: { session: string; script: string }): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  if (s.type !== "electron") {
    throw new Error(`Session '${args.session}' is not an electron session (type: ${s.type})`);
  }
  const app = s.browser as ElectronApplication;
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const fn = new Function("electron", args.script) as (electron: unknown) => unknown;
  const result = await app.evaluate(fn as never);
  return { text: JSON.stringify(result ?? null, null, 2), data: result };
}

export async function browserResize(args: {
  session: string;
  width: number;
  height: number;
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  await s.page.setViewportSize({ width: args.width, height: args.height });
  return { text: `Resized viewport to ${args.width}x${args.height}` };
}

export async function browserConsoleMessages(args: {
  session: string;
  clear?: boolean;
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const messages = [...s.consoleMessages];
  if (args.clear) {
    s.consoleMessages.length = 0;
  }
  if (messages.length === 0) {
    return { text: "No console messages", data: [] };
  }
  const lines = messages.map((m) => `[${m.type}] ${m.text}`);
  return { text: `Console messages (${messages.length}):\n${lines.join("\n")}`, data: messages };
}

export async function browserNetworkRequests(args: {
  session: string;
  clear?: boolean;
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const requests = [...s.networkRequests];
  if (args.clear) {
    s.networkRequests.length = 0;
  }
  if (requests.length === 0) {
    return { text: "No network requests", data: [] };
  }
  const lines = requests.map((r) => `${r.method} ${r.url} ${r.status ?? "pending"}`);
  return { text: `Network requests (${requests.length}):\n${lines.join("\n")}`, data: requests };
}

export async function browserTabs(args: {
  session: string;
  action?: "list" | "new" | "switch" | "close";
  index?: number;
  url?: string;
}): Promise<ActionResult> {
  const s = sessionManager.getOrThrow(args.session);
  const pages = s.context.pages();
  const act = args.action ?? "list";

  if (act === "list") {
    const tabs = pages.map((p, i) => `${i}: ${p.url()}`);
    return {
      text: `Tabs (${pages.length}):\n${tabs.join("\n")}`,
      data: pages.map((p, i) => ({ index: i, url: p.url() })),
    };
  } else if (act === "new") {
    const newPage = await s.context.newPage();
    if (args.url) {
      await newPage.goto(args.url);
    }
    s.page = newPage;
    return { text: `Created new tab${args.url ? ` at ${args.url}` : ""}` };
  } else if (act === "switch") {
    if (args.index === undefined || args.index < 0 || args.index >= pages.length) {
      throw new Error(`Invalid tab index. Valid range: 0-${pages.length - 1}`);
    }
    s.page = pages[args.index];
    return { text: `Switched to tab ${args.index}: ${s.page.url()}` };
  } else if (act === "close") {
    if (pages.length === 1) {
      throw new Error("Cannot close the last tab");
    }
    const closeIndex = args.index ?? pages.indexOf(s.page);
    if (closeIndex < 0 || closeIndex >= pages.length) {
      throw new Error(`Invalid tab index. Valid range: 0-${pages.length - 1}`);
    }
    await pages[closeIndex].close();
    if (s.page === pages[closeIndex]) {
      s.page = s.context.pages()[0];
    }
    return { text: `Closed tab ${closeIndex}` };
  }
  throw new Error(`Unknown action: ${act}`);
}
