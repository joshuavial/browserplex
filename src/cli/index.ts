#!/usr/bin/env node
import { DaemonClient } from "../daemon/client.js";
import { COMMANDS, parseCommand, render, topUsage, usageFor, CliError } from "./commands.js";

/**
 * `bp` CLI entry. Parses argv into a command + args via the declarative table in commands.ts,
 * sends it to the daemon (auto-spawned by DaemonClient), and renders the reply.
 */
async function main(): Promise<number> {
  const argv = process.argv.slice(2);

  // Top-level help / no command.
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    // eslint-disable-next-line no-console
    console.log(topUsage());
    return argv.length === 0 ? 1 : 0;
  }

  // Per-command help: `bp <command...> --help`.
  if (argv.includes("-h") || argv.includes("--help")) {
    const spec = COMMANDS.find((s) => s.path.every((p, i) => argv[i] === p));
    // eslint-disable-next-line no-console
    console.log(spec ? usageFor(spec) : topUsage());
    return 0;
  }

  let parsed;
  try {
    parsed = parseCommand(argv);
  } catch (e) {
    if (e instanceof CliError) {
      console.error(e.message);
      return e.code;
    }
    throw e;
  }

  const client = new DaemonClient();
  try {
    await client.connect();
    const res = await client.request(parsed.spec.tool, parsed.args);
    const hasOutputFile = parsed.spec.tool === "browser_take_screenshot" && parsed.args.savePath !== undefined;
    return render(res, parsed.json, hasOutputFile);
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
