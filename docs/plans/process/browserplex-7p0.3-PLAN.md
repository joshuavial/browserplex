# Bead browserplex-7p0.3 — PLAN

**Title:** CLI client + daemon auto-spawn
**Gate level:** 2 (process-spawn + the reply-correlation contract the whole CLI relies on).

## Acceptance (from bead)
First `bp` command transparently spawns the daemon; a second `bp` command in a new process reuses
the same live session; `--json` emits structured data.

## Objective
Make `bp` usable: a thin client that connects to the daemon (auto-spawning it on first use) and a
minimal CLI entry that turns `bp <tool> [--flag value]…` into a request and prints the reply. The
**ergonomic** command layer (grouped subcommands like `bp session create`, positional args,
`screenshot -o`, `fill --field`, `eval` from stdin) is bead **.4** — this bead delivers the generic
plumbing + enough surface to prove the acceptance.

## New files
```
src/daemon/client.ts   connect-or-auto-spawn + request/reply correlation (reusable by .4)
src/cli/index.ts       the `bp` bin (#!/usr/bin/env node): parse argv -> {tool,args} -> client -> print
```

## Client (`src/daemon/client.ts`)
- `class DaemonClient`:
  - `connect()`: `net.connect(SOCKET_PATH)`. On `ENOENT`/`ECONNREFUSED` → `ensureDaemon()` then retry
    with bounded backoff (e.g. 20×100ms).
  - `ensureDaemon()`: resolve the daemon entry as `path.resolve(dirNameOf(import.meta.url),
    "../daemon/server.js")`; `spawn(process.execPath, [entry], { detached:true, stdio:"ignore" })` then
    `child.unref()` so `bp` can exit while the daemon lives. The daemon's own `EADDRINUSE` connect-probe
    (bead .2) makes a double-spawn race safe (a redundant daemon exits cleanly).
  - `request(tool, args)`: assign an incrementing `id`, write `encodeMessage({id,tool,args})`, and
    resolve the promise when a reply with **matching `id`** arrives (a `Map<id, resolver>` fed by a
    `LineDecoder` on the socket). **Correlate by id, not arrival order** — the daemon does not
    guarantee FIFO (per .2 review). Reject on socket error/close before reply.
  - `close()`: end the socket.
- Returns the `DaemonResponse` to the caller; the CLI decides how to render it.

## CLI (`src/cli/index.ts`)
- Parse `argv`: first non-flag token = tool name; remaining `--key value` / `--flag` (boolean) →
  `args`. Global flags: `--json`, and `-s/--session <name>` (sugar that sets `args.session`).
- A small set of typed coercions so generic parsing is usable now: numbers for known numeric flags
  (`timeout`,`width`,`height`,`maxDepth`,`maxDimension`,`index`), booleans for bare flags
  (`headless`,`interactive`,`compact`,`fullPage`,`submit`,`clear`). (.4 replaces this with explicit
  per-command schemas.)
- Validate the tool name against `TOOL_NAMES` (from `core/dispatch.ts`); unknown → friendly error +
  list, exit 2.
- Send via `DaemonClient`; on reply:
  - `--json` → print `JSON.stringify({ok,text,data,...})`.
  - else → print `text` (or `data` pretty-printed when there's no text); image replies print
    `[image: N bytes base64]` placeholder (real `--output file` handling is .4).
  - `ok:false` → print `Error: <error>` to stderr, exit 1.
- `bp` with no args / `--help` → usage listing the known tools (full help text is .4).

## Out of scope (later beads)
Ergonomic grouped subcommands + positional args + `screenshot -o` / `fill --field` / `eval` stdin
(.4), idle-exit / `bp serve|status|stop` / log-file (.5), committed tests (.6), packaging/README (.7).

## Verification
- `npm run build` clean; existing 68 tests still green.
- Script (in /tmp): ensure no daemon running (rm socket); run `node dist/cli/index.js session_create
  --name a --type chromium --headless` → **auto-spawns daemon**, prints "Created…". Then a SEPARATE
  process `node dist/cli/index.js browser_navigate -s a --url https://example.com` → reuses the live
  session, prints "Navigated…". Then `… session_list --json` → structured JSON with session `a`.
  Then `… browser_console_messages -s a --json` proves the buffer persists across separate `bp`
  processes. Clean up: `… session_destroy --name a`; kill daemon.
- Confirm a second `bp` invoked while the daemon already runs does NOT spawn a second one (pid stable).
