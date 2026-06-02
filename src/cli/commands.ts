import * as path from "node:path";
import { readFileSync } from "node:fs";
import type { DaemonResponse } from "../daemon/protocol.js";

/**
 * Ergonomic `bp` command surface: a declarative table of CommandSpecs consumed by a small
 * hand-rolled parser (no CLI-framework dependency). Each spec maps a subcommand path to a
 * core tool name, ordered positionals, and typed flags.
 */

type FlagType = "string" | "number" | "boolean" | "string[]";

interface FlagDef {
  /** action-arg key this flag fills (defaults to the flag's long name). */
  key?: string;
  type: FlagType;
  alias?: string; // single-char alias, e.g. "s"
  desc: string;
}

export interface CommandSpec {
  path: string[]; // e.g. ["session","create"] or ["navigate"]
  tool: string;
  positionals?: { key: string; required?: boolean; desc: string }[];
  flags?: Record<string, FlagDef>;
  summary: string;
}

// Flags every command accepts.
const GLOBAL_FLAGS: Record<string, FlagDef> = {
  session: { key: "session", type: "string", alias: "s", desc: "session name" },
};

const TIMEOUT: FlagDef = { type: "number", desc: "timeout in ms" };

export const COMMANDS: CommandSpec[] = [
  // ---- session ----
  {
    path: ["session", "create"],
    tool: "session_create",
    positionals: [{ key: "name", required: true, desc: "session name" }],
    flags: {
      browser: { key: "type", type: "string", alias: "b", desc: "chromium|firefox|webkit|camoufox|electron" },
      headless: { type: "boolean", desc: "run headless (default)" },
      headed: { type: "boolean", desc: "open a visible window (any browser type)" },
      "executable-path": { key: "executablePath", type: "string", desc: "electron: path to the Electron binary" },
      "electron-arg": { key: "electronArgs", type: "string[]", desc: "electron: launch arg (repeatable)" },
      cwd: { type: "string", desc: "electron: spawn working dir" },
      env: { type: "string[]", desc: "electron: K=V env var (repeatable)" },
    },
    summary: "Create a named browser session",
  },
  { path: ["session", "list"], tool: "session_list", summary: "List active sessions" },
  {
    path: ["session", "destroy"],
    tool: "session_destroy",
    positionals: [{ key: "name", required: true, desc: "session name" }],
    summary: "Destroy a session",
  },
  // ---- storage ----
  {
    path: ["storage", "save"],
    tool: "storage_save",
    positionals: [{ key: "domain", required: true, desc: "domain to associate" }],
    flags: { name: { type: "string", desc: "stored-session name (default 'default')" } },
    summary: "Save session storage for a domain",
  },
  {
    path: ["storage", "load"],
    tool: "storage_load",
    positionals: [
      { key: "name", required: true, desc: "new session name" },
      { key: "domain", required: true, desc: "domain to load from" },
    ],
    flags: {
      "storage-name": { key: "storageName", type: "string", desc: "stored-session name (default 'default')" },
      browser: { key: "type", type: "string", alias: "b", desc: "chromium|firefox|webkit|camoufox" },
      headless: { type: "boolean", desc: "run headless (default)" },
      headed: { type: "boolean", desc: "open a visible window" },
    },
    summary: "Load stored storage into a new session",
  },
  {
    path: ["storage", "list"],
    tool: "storage_list",
    flags: { domain: { type: "string", desc: "filter by domain" } },
    summary: "List stored sessions",
  },
  {
    path: ["storage", "delete"],
    tool: "storage_delete",
    positionals: [{ key: "domain", required: true, desc: "domain" }],
    flags: { name: { type: "string", desc: "stored-session name (default 'default')" } },
    summary: "Delete a stored session",
  },
  {
    path: ["storage", "lock"],
    tool: "storage_lock",
    positionals: [{ key: "domain", required: true, desc: "domain" }],
    summary: "Acquire a domain lock",
  },
  {
    path: ["storage", "unlock"],
    tool: "storage_unlock",
    positionals: [{ key: "domain", required: true, desc: "domain" }],
    summary: "Release a domain lock",
  },
  // ---- navigation ----
  {
    path: ["navigate"],
    tool: "browser_navigate",
    positionals: [{ key: "url", required: true, desc: "URL" }],
    summary: "Navigate to a URL",
  },
  { path: ["back"], tool: "browser_navigate_back", summary: "Go back in history" },
  {
    path: ["snapshot"],
    tool: "browser_snapshot",
    flags: {
      interactive: { type: "boolean", desc: "interactive elements only" },
      compact: { type: "boolean", desc: "drop empty structural nodes" },
      "max-depth": { key: "maxDepth", type: "number", desc: "max tree depth" },
      selector: { type: "string", desc: "scope to a CSS selector" },
    },
    summary: "Accessibility snapshot with refs",
  },
  {
    path: ["screenshot"],
    tool: "browser_take_screenshot",
    flags: {
      output: { key: "savePath", type: "string", alias: "o", desc: "write PNG to this path" },
      "full-page": { key: "fullPage", type: "boolean", desc: "capture full scrollable page" },
      "max-dimension": { key: "maxDimension", type: "number", desc: "max width/height px" },
    },
    summary: "Screenshot the page",
  },
  // ---- interaction ----
  {
    path: ["click"],
    tool: "browser_click",
    positionals: [{ key: "selector", required: true, desc: "ref (@e1) or CSS selector" }],
    flags: { timeout: TIMEOUT },
    summary: "Click an element",
  },
  {
    path: ["type"],
    tool: "browser_type",
    positionals: [
      { key: "selector", required: true, desc: "ref or CSS selector" },
      { key: "text", required: true, desc: "text to type" },
    ],
    flags: { submit: { type: "boolean", desc: "press Enter after" }, timeout: TIMEOUT },
    summary: "Type into an input",
  },
  {
    path: ["press"],
    tool: "browser_press_key",
    positionals: [{ key: "key", required: true, desc: "key (Enter, Escape, …)" }],
    summary: "Press a key",
  },
  {
    path: ["hover"],
    tool: "browser_hover",
    positionals: [{ key: "selector", required: true, desc: "ref or CSS selector" }],
    flags: { timeout: TIMEOUT },
    summary: "Hover an element",
  },
  {
    path: ["drag"],
    tool: "browser_drag",
    positionals: [
      { key: "sourceSelector", required: true, desc: "source ref/selector" },
      { key: "targetSelector", required: true, desc: "target ref/selector" },
    ],
    flags: { timeout: TIMEOUT },
    summary: "Drag one element to another",
  },
  {
    path: ["select"],
    tool: "browser_select_option",
    positionals: [{ key: "selector", required: true, desc: "select ref/selector" }],
    flags: {
      value: { type: "string", desc: "option value" },
      label: { type: "string", desc: "option label" },
      index: { type: "number", desc: "option index" },
      timeout: TIMEOUT,
    },
    summary: "Select a dropdown option",
  },
  {
    path: ["upload"],
    tool: "browser_file_upload",
    positionals: [{ key: "selector", required: true, desc: "file input ref/selector" }],
    flags: { file: { key: "files", type: "string[]", desc: "file path (repeatable)" }, timeout: TIMEOUT },
    summary: "Upload file(s) to an input",
  },
  {
    path: ["fill"],
    tool: "browser_fill_form",
    flags: {
      field: { type: "string[]", desc: "selector=value (repeatable)" },
      "fields-json": { key: "fields", type: "string", desc: "JSON array of {selector,value}" },
      timeout: TIMEOUT,
    },
    summary: "Fill multiple form fields",
  },
  {
    path: ["dialog"],
    tool: "browser_handle_dialog",
    positionals: [{ key: "action", required: true, desc: "accept|dismiss" }],
    flags: { "prompt-text": { key: "promptText", type: "string", desc: "text for prompt dialogs" } },
    summary: "Handle the next JS dialog",
  },
  // ---- utilities ----
  {
    path: ["wait"],
    tool: "browser_wait_for",
    positionals: [{ key: "selector", required: false, desc: "ref/selector (omit to wait for load)" }],
    flags: { state: { type: "string", desc: "attached|detached|visible|hidden" }, timeout: TIMEOUT },
    summary: "Wait for an element or load",
  },
  {
    path: ["eval"],
    tool: "browser_evaluate",
    positionals: [{ key: "script", required: false, desc: "JS (omit or '-' to read stdin)" }],
    summary: "Evaluate JS in the page (renderer)",
  },
  {
    path: ["electron-eval"],
    tool: "electron_evaluate",
    positionals: [{ key: "script", required: false, desc: "JS body, gets the Electron module as `electron` (omit or '-' for stdin)" }],
    summary: "Evaluate JS in the Electron MAIN process (electron sessions)",
  },
  {
    path: ["resize"],
    tool: "browser_resize",
    positionals: [
      { key: "width", required: true, desc: "width px" },
      { key: "height", required: true, desc: "height px" },
    ],
    summary: "Resize the viewport",
  },
  {
    path: ["console"],
    tool: "browser_console_messages",
    flags: { clear: { type: "boolean", desc: "clear after retrieving" } },
    summary: "Get console messages",
  },
  {
    path: ["network"],
    tool: "browser_network_requests",
    flags: { clear: { type: "boolean", desc: "clear after retrieving" } },
    summary: "Get network requests",
  },
  {
    path: ["tabs"],
    tool: "browser_tabs",
    positionals: [{ key: "action", required: false, desc: "list|new|switch|close (default list)" }],
    flags: { index: { type: "number", desc: "tab index" }, url: { type: "string", desc: "URL for new tab" } },
    summary: "List/switch/close tabs",
  },
];

const NUMERIC_POSITIONALS = new Set(["width", "height"]);

export interface Parsed {
  spec: CommandSpec;
  args: Record<string, unknown>;
  json: boolean;
  help: boolean;
}

export class CliError extends Error {
  constructor(message: string, readonly code = 2) {
    super(message);
  }
}

/** A token is a flag iff it starts with '-', isn't '-' (stdin), and isn't a negative number. */
function isFlag(t: string): boolean {
  return t.startsWith("-") && t !== "-" && !/^-\d/.test(t);
}

function findSpec(argv: string[]): { spec: CommandSpec; rest: string[] } {
  // longest matching path prefix
  let best: CommandSpec | undefined;
  for (const spec of COMMANDS) {
    if (spec.path.every((p, i) => argv[i] === p)) {
      if (!best || spec.path.length > best.path.length) best = spec;
    }
  }
  if (!best) throw new CliError(`Unknown command: ${argv.filter((t) => !isFlag(t))[0] ?? ""}`);
  return { spec: best, rest: argv.slice(best.path.length) };
}

function flagDefFor(spec: CommandSpec, token: string): { name: string; def: FlagDef } | null {
  const long = token.replace(/^--?/, "");
  // long flags
  const merged: Record<string, FlagDef> = { ...GLOBAL_FLAGS, ...(spec.flags ?? {}) };
  if (token.startsWith("--") && merged[long]) return { name: long, def: merged[long] };
  // single-char alias
  if (!token.startsWith("--") && token.startsWith("-")) {
    for (const [name, def] of Object.entries(merged)) {
      if (def.alias === long) return { name, def };
    }
  }
  return null;
}

/** Parse argv (already minus the command path is computed here) into a Parsed request. */
export function parseCommand(argv: string[]): Parsed {
  const { spec, rest } = findSpec(argv);
  const positionals: string[] = [];
  const flags: Record<string, unknown> = {};
  let json = false;
  let help = false;
  let endOfOpts = false;

  for (let i = 0; i < rest.length; i++) {
    const t = rest[i];
    if (!endOfOpts && t === "--") {
      endOfOpts = true;
      continue;
    }
    if (!endOfOpts && (t === "--json")) {
      json = true;
      continue;
    }
    // Help is value-slot-aware: only a -h/--help reached in flag position (before `--`, and not
    // consumed as a flag's value via the rest[++i] below) counts. A -h after `--` or as a flag's
    // value is NOT help.
    if (!endOfOpts && (t === "-h" || t === "--help")) {
      help = true;
      continue;
    }
    if (!endOfOpts && isFlag(t)) {
      const match = flagDefFor(spec, t);
      if (!match) throw new CliError(`Unknown flag: ${t}\n\n${usageFor(spec)}`);
      const { name, def } = match;
      const key = def.key ?? name;
      if (def.type === "boolean") {
        flags[key] = true;
      } else {
        const val = rest[++i];
        if (val === undefined) throw new CliError(`Flag ${t} expects a value`);
        if (def.type === "number") flags[key] = Number(val);
        else if (def.type === "string[]") {
          if (!Array.isArray(flags[key])) flags[key] = [];
          (flags[key] as string[]).push(val);
        } else flags[key] = val;
      }
    } else {
      positionals.push(t);
    }
  }

  // Short-circuit on help BEFORE buildArgs, so `bp eval --help` etc. don't trigger stdin reads or
  // required-positional/validation errors.
  if (help) return { spec, args: {}, json, help: true };

  const args = buildArgs(spec, positionals, flags);
  return { spec, args, json, help: false };
}

/** Map positionals + raw flags into the action-arg object, applying per-command transforms. */
function buildArgs(spec: CommandSpec, positionals: string[], flags: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = { ...flags };
  const defs = spec.positionals ?? [];
  if (positionals.length > defs.length) {
    throw new CliError(
      `Too many arguments for 'bp ${spec.path.join(" ")}' (expected ${defs.length}, got ${positionals.length}). ` +
        `Did you mean to pass a flag like -s/--session?\n\n${usageFor(spec)}`,
    );
  }
  for (let i = 0; i < defs.length; i++) {
    const d = defs[i];
    if (positionals[i] !== undefined) {
      args[d.key] = NUMERIC_POSITIONALS.has(d.key) ? Number(positionals[i]) : positionals[i];
    } else if (d.required && !(d.key === "script")) {
      // 'script' may come from stdin — handled below
      throw new CliError(`Missing required argument <${d.key}>\n\n${usageFor(spec)}`);
    }
  }

  // --env K=V (repeatable) -> object (split on FIRST '=')
  if (Array.isArray(args.env)) {
    const obj: Record<string, string> = {};
    for (const kv of args.env as string[]) {
      const eq = kv.indexOf("=");
      if (eq < 0) throw new CliError(`--env expects K=V, got: ${kv}`);
      obj[kv.slice(0, eq)] = kv.slice(eq + 1);
    }
    args.env = obj;
  }

  // --field and --fields-json are mutually exclusive (otherwise fields-json would silently win).
  if (Array.isArray(args.field) && typeof args.fields === "string") {
    throw new CliError("use either --field or --fields-json, not both");
  }
  // --field selector=value (repeatable) -> fields[] (split on FIRST '=', selectors may contain '=')
  if (Array.isArray(args.field)) {
    args.fields = (args.field as string[]).map((kv) => {
      const eq = kv.indexOf("=");
      if (eq < 0) throw new CliError(`--field expects selector=value, got: ${kv}`);
      return { selector: kv.slice(0, eq), value: kv.slice(eq + 1) };
    });
    delete args.field;
  }
  // --fields-json '[...]' -> fields[]
  if (typeof args.fields === "string") {
    try {
      args.fields = JSON.parse(args.fields as string);
    } catch {
      throw new CliError(`--fields-json must be a JSON array`);
    }
  }

  // screenshot --output: resolve to absolute (daemon rejects non-absolute savePath)
  if (spec.tool === "browser_take_screenshot" && typeof args.savePath === "string") {
    args.savePath = path.resolve(process.cwd(), args.savePath as string);
  }

  // eval / electron-eval: script from positional, or stdin when omitted / '-'
  if (spec.tool === "browser_evaluate" || spec.tool === "electron_evaluate") {
    const s = args.script;
    if (s === undefined || s === "-") {
      args.script = readFileSync(0, "utf8");
    }
    if (!args.script) throw new CliError("eval needs a script (positional or stdin)");
  }

  return args;
}

export function usageFor(spec: CommandSpec): string {
  const pos = (spec.positionals ?? [])
    .map((p) => (p.required ? `<${p.key}>` : `[${p.key}]`))
    .join(" ");
  const lines = [`Usage: bp ${spec.path.join(" ")} ${pos} [flags]`, "", spec.summary];
  const allFlags = { ...(spec.flags ?? {}), session: GLOBAL_FLAGS.session };
  if (Object.keys(allFlags).length) {
    lines.push("", "Flags:");
    for (const [name, def] of Object.entries(allFlags)) {
      const a = def.alias ? `-${def.alias}, ` : "    ";
      lines.push(`  ${a}--${name}${def.type === "boolean" ? "" : " <val>"}  ${def.desc}`);
    }
    lines.push("  --json  structured JSON output");
  }
  return lines.join("\n");
}

export function topUsage(): string {
  const lines = ["Usage: bp <command> [args] [flags]", "", "Commands:"];
  let group = "";
  for (const spec of COMMANDS) {
    const g = spec.path.length > 1 ? spec.path[0] : "browser";
    if (g !== group) {
      lines.push("");
      group = g;
    }
    lines.push(`  ${spec.path.join(" ").padEnd(22)} ${spec.summary}`);
  }
  lines.push("");
  lines.push("  prime                  Print an AI-agent primer on how to drive bp");
  lines.push("  serve                  Run the daemon in the foreground");
  lines.push("  daemon status          Show daemon status");
  lines.push("  daemon stop            Stop the running daemon");
  lines.push("", "Global: -s/--session <name>, --json, -h/--help");
  return lines.join("\n");
}

/** Render a daemon response to stdout/stderr; returns the process exit code. */
export function render(res: DaemonResponse, json: boolean, hasOutputFile: boolean): number {
  if (json) {
    // Normalize undefined text/data to null so JSON never emits a bare `undefined`
    // (carried .1 follow-up: browser_evaluate of an undefined result).
    const out = {
      ok: res.ok,
      text: res.text ?? null,
      data: res.data ?? null,
      ...(res.imageBase64 ? { imageBase64: res.imageBase64, mimeType: res.mimeType } : {}),
      ...(res.error ? { error: res.error } : {}),
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(out, null, 2));
    return res.ok ? 0 : 1;
  }
  if (!res.ok) {
    console.error(`Error: ${res.error ?? "unknown error"}`);
    return 1;
  }
  if (res.imageBase64 && !hasOutputFile) {
    // eslint-disable-next-line no-console
    console.log(`${res.text ? res.text + "\n" : ""}[image: ${res.imageBase64.length} base64 chars, ${res.mimeType ?? "image/png"}]`);
  } else if (res.text !== undefined && res.text !== "") {
    // eslint-disable-next-line no-console
    console.log(res.text);
  } else if (res.text === undefined) {
    // evaluate of an undefined result
    // eslint-disable-next-line no-console
    console.log("undefined");
  } else if (res.data !== undefined) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(res.data, null, 2));
  }
  return 0;
}
