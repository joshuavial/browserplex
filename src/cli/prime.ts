import { COMMANDS, type CommandSpec } from "./commands.js";

/**
 * `bp prime` — an onboarding primer for an AI agent driving the `bp` CLI. Mixes hand-written
 * guidance (the daemon model, the ref workflow + its gotchas, output/exit-codes/env) with a command
 * reference generated from the spec table so it never goes stale.
 */

function commandLine(spec: CommandSpec): string {
  const pos = (spec.positionals ?? [])
    .map((p) => (p.required ? `<${p.key}>` : `[${p.key}]`))
    .join(" ");
  const flags = Object.entries(spec.flags ?? {}).map(([n, d]) => {
    const v = d.type === "boolean" ? "" : d.type === "string[]" ? " <v>…" : " <v>";
    const alias = d.alias ? `-${d.alias}/` : "";
    return `${alias}--${n}${v}`;
  });
  const head = `bp ${spec.path.join(" ")}${pos ? " " + pos : ""}`;
  return `  ${head.padEnd(40)} ${spec.summary}${flags.length ? `\n      flags: ${flags.join("  ")}` : ""}`;
}

export function primeText(): string {
  const groups: Record<string, CommandSpec[]> = {};
  for (const s of COMMANDS) {
    const g = s.path.length > 1 ? s.path[0] : "browser";
    (groups[g] ??= []).push(s);
  }
  const groupBlock = Object.entries(groups)
    .map(([g, specs]) => `## ${g}\n${specs.map(commandLine).join("\n")}`)
    .join("\n\n");

  return `# bp — Browserplex CLI primer (for AI agents)

bp drives real browser sessions (Playwright) from the shell. Use it to open pages, read their
content, interact, screenshot, run JS, and inspect console/network.

## Mental model: a background daemon holds your live sessions
- A browser session is a live, in-memory browser. It cannot live inside a one-shot CLI process, so
  bp talks to a **background daemon** that owns the sessions.
- The **first** bp command **auto-spawns** the daemon. Every later bp command — even from a different
  terminal or a separate script invocation — **reuses the same live sessions**. You do NOT manage the
  daemon; just run commands.
- Sessions persist until you \`bp session destroy\` them or the daemon idle-exits (no sessions/clients
  for the grace period; default 5 min). Console/network buffers live in the session across commands.

## The loop you will almost always run
\`\`\`
bp session create web --browser chromium   # once; chromium (default) | firefox | webkit | camoufox | electron. Headless by default — add --headed for a visible window (electron is always headed).
bp navigate <url> -s web                    # -s/--session selects the session; every browser command needs it (omitting it errors)
bp snapshot -s web                          # READ the page: prints an accessibility tree with refs (@e1, @e2, …)
bp click @e3 -s web                         # act using a ref FROM THE SNAPSHOT YOU JUST TOOK
bp eval -s web "document.title"             # run JS in the page; result is JSON (strings are quoted)
bp session destroy web                      # clean up when done
\`\`\`

## The ref workflow — read this, it's the #1 source of mistakes
- \`bp snapshot\` prints elements with refs shown as \`[ref=e1]\`, \`[ref=e2]\`, …. To act on one, pass it
  with an \`@\` prefix — e.g. snapshot shows \`button "Submit" [ref=e3]\`, so you run \`bp click @e3 -s web\`.
  Use refs instead of guessing CSS selectors — they're more reliable.
- **Refs are valid only for the snapshot you just took.** After ANY page change (navigate, click that
  loads new content, etc.) the old refs are stale — **re-run \`bp snapshot\`** before acting again.
  Acting on a stale ref gives a clear "not found / timeout" error.
- **Ref numbers depend on snapshot options.** \`bp snapshot --interactive\` (interactive elements only)
  numbers differently than a full snapshot. Always use refs from the SAME snapshot call you're acting
  on. Prefer \`--interactive\` for forms/buttons (smaller, focused output).
- You can always fall back to a CSS selector (e.g. \`bp click "#submit"\`) instead of a ref.

## Output & scripting
- Default output is human text (the same strings the MCP server returns).
- Add **\`--json\`** to any command for \`{ok, text, data, …}\` you can parse. \`data\` carries structured
  payloads (session_list, console, network, evaluate result). Prefer --json when scripting.
- \`bp eval\` returns the JS result as JSON: numbers print bare (\`2\`), strings are quoted (\`"hi"\`),
  \`undefined\` prints \`undefined\` (and \`text:null\` under --json).

## Exit codes
- \`0\` success · \`1\` the action failed (e.g. selector not found — the message is AI-friendly and
  suggests a fix) · \`2\` usage error (unknown command, missing/extra argument, bad flag).

## Handy specifics
- \`bp screenshot -s web -o out.png\` writes the PNG to disk (path is resolved to absolute).
- \`bp eval -s web "1+1"\` OR pipe JS on stdin: \`echo 'document.title' | bp eval -s web\`.
- \`bp fill -s web --field "#user=alice" --field "#pw=secret"\` (repeatable; split on the FIRST \`=\`, so
  selectors/values may contain \`=\`). Or \`--fields-json '[{"selector":"#user","value":"alice"}]'\`.
- \`bp wait "#done" -s web\` waits for an element (selector is a POSITIONAL, not a flag); \`bp wait -s web\`
  (no selector) waits for page load.
- \`bp console -s web --json\` / \`bp network -s web --json\` read the buffers captured since the session
  started (use \`--clear\` to reset).
- \`bp download list -s web --json\` shows captured downloads; \`bp download save -s web out.bin\`
  saves the latest one (or pass \`--id d1\`).
- \`bp tabs -s web list|new|switch|close\` (\`--index\`, \`--url\`).
- A token that looks like a flag can be passed as a literal value after \`--\`:
  \`bp type "#in" -- -h\` types the text \`-h\`.

## Driving an Electron app (e.g. a desktop app under test)
\`\`\`
bp session create app --browser electron \\
  --executable-path /path/app/node_modules/.bin/electron \\
  --electron-arg /path/app --cwd /path/app --env MY_TEST_MODE=1
bp eval -s app "window.myPreloadBridge !== undefined"   # eval runs in the renderer; preload bridge is live
bp electron-eval -s app "return electron.app.getName()" # eval in the MAIN process; body gets the Electron module as \`electron\`
\`\`\`
\`bp electron-eval\` runs JS in the Electron MAIN process (electron sessions only) — the script is a
function BODY (use \`return\`) and receives the Electron module as \`electron\` (e.g. stub a native
dialog). Set \`--executable-path\` to the target app's Electron binary (bp does not bundle Electron at runtime).
\`webkit\`/\`camoufox\` engines require their Playwright/camoufox browser binaries to be installed.

## Daemon control & environment
- \`bp daemon status\` — is it running, pid, active sessions · \`bp daemon stop\` — stop it ·
  \`bp serve\` — run it in the foreground (logs to the terminal).
- \`BROWSERPLEX_IDLE_MS\` — idle-exit grace in ms (default 300000; \`0\` disables).
- \`BROWSERPLEX_DIR\` — relocate the runtime dir (socket/pid/log + stored sessions; default ~/.browserplex).

## Full command reference
Every browser command also accepts the global flags \`-s/--session <name>\` and \`--json\` (omitted from
the per-command lines below). Positionals are shown as \`<required>\` / \`[optional]\`.

${groupBlock}

Run \`bp <command> --help\` for a single command's flags.
`;
}
