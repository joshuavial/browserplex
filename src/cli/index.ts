#!/usr/bin/env node
import { DaemonClient } from "../daemon/client.js";
import { TOOL_NAMES } from "../core/dispatch.js";

/**
 * Minimal generic CLI: `bp <tool> [--flag value | --flag]...`.
 * The ergonomic command layer (grouped subcommands, positional args, screenshot -o,
 * fill --field, eval from stdin) is bead .4 — this entry proves auto-spawn,
 * cross-process session reuse, and --json.
 */

// Flags that should coerce to number / boolean under generic parsing (replaced by
// per-command schemas in .4).
const NUMERIC_FLAGS = new Set(["timeout", "width", "height", "maxDepth", "maxDimension", "index"]);
const BOOLEAN_FLAGS = new Set(["headless", "interactive", "compact", "fullPage", "submit", "clear"]);

interface Parsed {
  tool: string | null;
  args: Record<string, unknown>;
  json: boolean;
  help: boolean;
}

function parseArgv(argv: string[]): Parsed {
  const out: Parsed = { tool: null, args: {}, json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      out.help = true;
    } else if (a === "--json") {
      out.json = true;
    } else if (a === "-s" || a === "--session") {
      out.args.session = argv[++i];
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (BOOLEAN_FLAGS.has(key)) {
        out.args[key] = true; // boolean flags never consume the next token
      } else if (next === undefined || next.startsWith("--")) {
        out.args[key] = true; // bare flag
      } else {
        i++;
        out.args[key] = NUMERIC_FLAGS.has(key) ? Number(next) : next;
      }
    } else if (out.tool === null) {
      out.tool = a;
    }
  }
  return out;
}

function usage(): string {
  return (
    "Usage: bp <tool> [--flag value | --flag]... [--json] [-s|--session <name>]\n\n" +
    "Tools:\n" +
    TOOL_NAMES.map((t) => `  ${t}`).join("\n") +
    "\n\n(Ergonomic grouped commands arrive in a later release.)"
  );
}

async function main(): Promise<number> {
  const parsed = parseArgv(process.argv.slice(2));

  if (parsed.help || !parsed.tool) {
    // eslint-disable-next-line no-console
    console.log(usage());
    return parsed.tool ? 0 : parsed.help ? 0 : 1;
  }

  if (!TOOL_NAMES.includes(parsed.tool)) {
    console.error(`Unknown tool: ${parsed.tool}\n\n${usage()}`);
    return 2;
  }

  const client = new DaemonClient();
  try {
    await client.connect();
    const res = await client.request(parsed.tool, parsed.args);

    if (parsed.json) {
      const { id: _id, ...rest } = res;
      void _id;
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(rest, null, 2));
    } else if (!res.ok) {
      console.error(`Error: ${res.error ?? "unknown error"}`);
      return 1;
    } else if (res.imageBase64) {
      // eslint-disable-next-line no-console
      console.log(
        `${res.text ? res.text + "\n" : ""}[image: ${res.imageBase64.length} base64 chars, ${res.mimeType ?? "image/png"}]`,
      );
    } else if (res.text && res.text.length > 0) {
      // eslint-disable-next-line no-console
      console.log(res.text);
    } else if (res.data !== undefined) {
      // eslint-disable-next-line no-console
      console.log(JSON.stringify(res.data, null, 2));
    }
    return res.ok ? 0 : 1;
  } catch (e) {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    return 1;
  } finally {
    client.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Error: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
