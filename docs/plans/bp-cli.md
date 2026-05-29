# Plan: `bp` CLI for Browserplex

> **Dev approach:** this plan is driven through the **etude dev loop** — one bead = one commit,
> plan → implement → verify → docs → review per bead. Tracking epic: `browserplex-7p0`
> (`bd show browserplex-7p0`).

## Context

Browserplex is today an **MCP stdio server** (`src/index.ts`, 768 lines, 28 `server.tool`
registrations). We want a `bp` command-line tool so browser sessions can be driven from a
shell / scripts, **coexisting** with the existing MCP server over a shared core.

The defining constraint, established by reading the code:

- `SessionManager` (`src/sessions.ts`) keeps a `Map<string, BrowserSession>` **in memory** for
  the life of the process.
- A `BrowserSession` (`src/types.ts`) holds **live, non-serializable** Playwright handles
  (`Browser`, `BrowserContext`, `Page`) plus in-RAM state: `refMap` (the `@e1` refs `getLocator`
  needs — `src/index.ts:30`), the `consoleMessages` buffer, and the `networkRequests` buffer
  (both filled by persistent `page.on(...)` listeners).

An MCP server survives across calls because it is one long-lived process. A CLI is the opposite:
`bp navigate …` runs and **exits**; `bp click …` is a fresh cold process. So something must keep
the browser + its in-RAM state alive between two `bp` invocations.

## Investigation outcome (verified)

- **B — daemonless `connect()` per call: BLOCKED.** With the Playwright wire protocol a fresh
  `connect()` returns an **empty `browser.contexts()`** — you cannot reattach to a page an earlier
  process created ([playwright#1709]). `connectOverCDP` can, but is **Chromium-only** and its
  per-connection listeners can't rebuild the console/network buffers.
- **C — one-shot persistent profile: loses features.** No daemon, cookies persist on disk, but
  `refMap`/console/network/live-tabs all die between calls and every command pays a launch cost.
- **A — daemon + thin client: CHOSEN.** A background process *is* today's `SessionManager` (live
  Maps, listeners, refs) with the transport swapped from stdio to a local socket. Reuses ~100% of
  logic; behaviour identical to today.

Sources: <https://playwright.dev/docs/api/class-browsertype> ·
<https://github.com/microsoft/playwright/issues/1709> ·
<https://www.browserstack.com/guide/playwright-connect-to-existing-browser>

## Decisions
- **Architecture:** A — daemon + thin client.
- **Scope:** Coexist — MCP server and `bp` CLI are both thin frontends over a shared core.

---

## Target architecture

```
src/core/        framework-agnostic engine (no MCP, no CLI, no socket imports)
  sessions.ts      (moved as-is — already core)
  storage.ts       (moved as-is — already core)
  snapshot.ts      (moved as-is — already core)
  types.ts         (moved as-is)
  actions.ts       NEW: one pure async fn per tool, (session/args) -> ActionResult
src/mcp/
  server.ts        the existing 28 server.tool() regs, each handler now: zod-validate
                   -> call core action -> wrap in MCP content. (was src/index.ts)
src/daemon/
  server.ts        owns the singleton sessionManager; listens on a unix socket; for each
                   request {tool,args} calls the core action and returns {ok,text,data,image}
  protocol.ts      shared request/response types + newline-delimited JSON framing
  client.ts        connect-or-auto-spawn helper (used by the CLI)
src/cli/
  index.ts         the `bp` bin: parse argv -> {tool,args} -> client -> print
  commands.ts      argv<->tool mapping + flag parsing + output formatting
```

The live sessions exist **only inside the daemon process**. MCP host and CLI never hold
browsers themselves — both speak to a core (MCP in-process; CLI via the daemon socket).

### IPC protocol (no new deps)
- Unix domain socket `~/.browserplex/daemon.sock`; also `daemon.pid`, `daemon.log`.
- Newline-delimited JSON. Request `{id, tool, args}` → Response
  `{id, ok, text?, data?, imageBase64?, error?}`. Screenshots: daemon returns base64 (and/or
  honours the existing `savePath`); CLI writes the file / prints the path.

### Daemon lifecycle
- **Auto-spawn:** CLI connects to the socket; on ENOENT/ECONNREFUSED it spawns
  `node dist/daemon/server.js` **detached**, waits for the socket, retries.
- **Stale recovery:** on connect failure, check `daemon.pid`; if dead, unlink the stale socket
  before spawning.
- **Idle shutdown:** daemon exits when it has **zero sessions** for a grace period (default 5 min).
  While any session exists it stays up.
- **Explicit control:** `bp serve` (foreground), `bp daemon status`, `bp daemon stop`.
- Reuse the existing `destroyAll()` SIGINT/SIGTERM cleanup (currently `src/index.ts` tail).

### CLI command surface (1:1 with the 28 tools)
Global flags: `-s/--session <name>`, `--json` (structured output), plus create-time `--browser`,
`--headless`.
- `bp session create|list|destroy`
- `bp storage save|load|list|delete|lock|unlock`
- `bp navigate|back|snapshot|screenshot|click|type|press|hover|drag|select|upload|fill|dialog|wait|eval|resize|console|network|tabs`
- Notables: `bp screenshot -s x -o shot.png` (maps to `savePath`); `bp fill` takes
  `--field selector=value` repeated or `--json '[…]'`; `bp eval` reads JS from arg or stdin.
- Default output = today's human text (`success()` strings); `--json` returns `data` for scripting.

## Files
- **Move (git mv, no behaviour change):** `src/sessions.ts`,`storage.ts`,`snapshot.ts`,`types.ts`
  → `src/core/`. Fix `.js` import specifiers.
- **New:** `src/core/actions.ts`, `src/daemon/{server,protocol,client}.ts`,
  `src/cli/{index,commands}.ts`.
- **Rewrite as thin adapter:** `src/index.ts` → `src/mcp/server.ts` (handlers delegate to
  `core/actions.ts`). Keep `browserplex` bin pointing at the new path.
- **Edit:** `package.json` (add `bp` bin → `dist/cli/index.js`; keep `browserplex` bin →
  `dist/mcp/server.js`; `build` still `tsc`), `README.md` (CLI section), `CHANGELOG.md`,
  `tsconfig.json` if needed for new dirs.

## Phases → beads (epic `browserplex-7p0`, sequential)
1. **`.1` Extract shared core** — move the 4 core files under `src/core/`, create `actions.ts`,
   rewrite the MCP server as a thin adapter. *No behaviour change; existing tests stay green.*
2. **`.2` Daemon server + protocol** — unix-socket server hosting the singleton `sessionManager`,
   request→action→response dispatch, JSON-line framing, graceful shutdown.
3. **`.3` CLI client + auto-spawn** — `bp` bin, argv→request, connect-or-spawn daemon, text/`--json`.
4. **`.4` Full command surface** — wire all 28 tools incl. flag/`fill`/`eval`/`screenshot -o` parsing.
5. **`.5` Lifecycle polish** — idle shutdown, stale-socket recovery, `bp serve`/`status`/`stop`, logging.
6. **`.6` Tests** — daemon IPC round-trip + CLI e2e, alongside the untouched vitest suites.
7. **`.7` Docs + packaging** — `package.json` bins, README CLI section, CHANGELOG entry.

## Verification
- `npm run build` clean; `npm test` (existing `sessions`/`storage`/`integration` suites) still pass
  after the core extraction (proves no behaviour regression).
- New e2e: `node dist/cli/index.js session create demo --browser chromium` →
  `bp navigate -s demo https://example.com` → `bp snapshot -s demo` (shows title/refs) →
  `bp click -s demo @e1` → `bp console -s demo` (buffer survived across separate processes —
  the core proof the daemon works) → `bp session destroy demo`.
- Confirm daemon auto-spawns on first command, that a second terminal sees the same session, and
  that the daemon idle-exits after the last session is destroyed.
- Regression: point an MCP host at `dist/mcp/server.js` and confirm the 28 tools behave as before.
