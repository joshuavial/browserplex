#!/usr/bin/env node
import { DaemonClient } from "../daemon/client.js";
import { parseCommand, render, topUsage, usageFor, CliError } from "./commands.js";
import { serve, status, stop } from "./meta.js";
import { primeText } from "./prime.js";

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

  // Agent-onboarding primer (no daemon needed).
  if (argv[0] === "prime") {
    // eslint-disable-next-line no-console
    console.log(primeText());
    return 0;
  }

  // Daemon lifecycle meta-commands (not daemon tools; handled before the dispatch table).
  if (argv[0] === "serve") return serve();
  if (argv[0] === "daemon" && argv[1] === "status") return status();
  if (argv[0] === "daemon" && argv[1] === "stop") return stop();

  // Command parsing handles per-command help in a value-slot-aware way (a -h/--help in flag
  // position sets parsed.help); a -h after `--` or as a flag value is NOT help.
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

  if (parsed.help) {
    // eslint-disable-next-line no-console
    console.log(usageFor(parsed.spec));
    return 0;
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
