# Bead browserplex-7p0.5 — PLAN

**Title:** Daemon lifecycle polish
**Gate level:** 2 (process lifecycle — idle timers, signals, stale-pid recovery; the resource-
lifecycle class that produced the .2/.3 blockers). agy + Opus + Codex.

## Acceptance (from bead)
Daemon idle-exits after the last session is destroyed; `bp daemon status`/`stop` work; a stale socket
from a dead daemon is recovered automatically.

## Already in place (from .2/.3)
- Logging: the daemon logs via `console.error`; the client redirects the auto-spawned daemon's
  stdio to `~/.browserplex/daemon.log` (bead .3). So file logging already works for auto-spawn.
- Partial stale recovery: the daemon's `EADDRINUSE` connect-probe (bead .2) unlinks a stale socket
  and exits if a live daemon already owns it. This bead adds **pid-based** detection so a dead
  daemon whose socket lingers is cleaned up proactively, and the client surfaces it.

## Changes

### 1. Idle shutdown (daemon — `src/daemon/server.ts`) — race-hardened per gate
- Configurable: `IDLE_MS = Number(process.env.BROWSERPLEX_IDLE_MS) || 300_000` (5 min); `0` disables.
- **Idle condition = ALL of: `sessionManager.list().length === 0` AND `inFlight === 0` AND
  `openConnections === 0`.** (Gate BLOCK fix #1 — a session-count-only check drops a live session when
  a `session_create` is dispatched-but-unresolved, or a client has connected but not yet sent.)
  - `inFlight`: incremented before `handleRequest`, decremented after `reply` (in the `.then`).
  - `openConnections`: incremented in `onConnection`, decremented on socket `close`.
- `evaluateIdle()` is called on every transition: after each request completes, on every connection
  open AND close, and once at startup. If the idle condition holds → arm a single shared `unref()`'d
  timer; otherwise clear it. (Hook into connection/request lifecycle, not just request completion —
  agy/Codex follow-up — so a session created/destroyed and a bare connection both re-evaluate.)
- On timer **fire**: re-check the full idle condition; only then run `shutdown('idle', server)`,
  else re-arm. `shutdown()` also clears the idle timer (so a signal-triggered shutdown leaves no
  pending fire). Reuses the existing re-entrant `shutdown()`. A freshly-spawned daemon with no
  session/connection still idle-exits after IDLE_MS (prevents orphans from a failed CLI run).

### 2. Stale-socket recovery (`src/daemon/server.ts` startup) — TOCTOU-hardened per gate
- On `EADDRINUSE`, loop (bounded, e.g. 5 tries): **probe** the socket (`net.connect`):
  - alive → another daemon owns it → log + `exit(0)`.
  - stale → `unlink` the socket (and a stale `daemon.pid`) → retry `listen()`. If `listen` throws
    `EADDRINUSE` again, **re-probe** (don't blindly unlink again) — handles a concurrent daemon that
    rebound between our probe and unlink (gate BLOCK fix #3). Give up after the bound with a clear error.
- For a CLI-auto-spawned single-user daemon, concurrent starts are already rare; the probe-before-
  unlink + re-probe loop closes the practical TOCTOU window.

### 3. Daemon control via RPC, not signals (gate BLOCK fix #2)
- The daemon handles two **control requests** in its request handler *before* `actionDispatch` (so no
  fake entries in the tool registry): `{tool:"__daemon_status"}` → reply `{ok, data:{pid, sessions:
  [...names], uptimeMs}}`; `{tool:"__daemon_stop"}` → reply `{ok, text:"stopping"}` then
  `shutdown("rpc", server)`. **No `kill(pid)` of a possibly-reused PID** — control flows over the
  socket, which only a live daemon answers.
- **`bp daemon status`**: connect; on success send `__daemon_status` → print `running (pid <pid>), <n>
  session(s)`; on connect failure → if `PID_PATH` exists print `not running (stale pid/socket)` else
  `not running`.
- **`bp daemon stop`**: connect; on success send `__daemon_stop`, wait for the reply + socket removal
  → `stopped`; on connect failure → `not running` (exit 0), cleaning a stale pid/socket if present.
  (No signalling a foreign PID — we only ever talk to a daemon that answers on the socket.)
- **`bp serve`**: run the daemon in the FOREGROUND — `spawn(process.execPath,[daemonEntry],
  {stdio:'inherit'})`, forward SIGINT/SIGTERM, exit with its code. If a daemon already owns the socket,
  the EADDRINUSE probe makes the child `exit(0)`; `serve` detects this (child exited 0 quickly) and
  prints `daemon already running` rather than implying it started one.

## Files
- `src/daemon/server.ts`: idle-timer logic + stale-pid unlink on startup.
- `src/daemon/protocol.ts` (or client.ts): `isDaemonAlive()` + (maybe) a `readPid()` helper.
- `src/cli/index.ts`: dispatch `serve` / `daemon status` / `daemon stop` before the command table;
  add them to `topUsage()` text.

## Out of scope
Committed automated tests (.6) — this bead is verified by a script; packaging/`bp` bin (.7).

## Verification (script in /tmp, real processes)
- **Idle exit:** start daemon with `BROWSERPLEX_IDLE_MS=1500`; create a session, confirm it stays up
  past 1.5s while the session exists; destroy the session; confirm the daemon exits within ~grace and
  removes the socket/pid. Also: spawn with short idle and NO session → exits after grace.
- **status/stop:** `bp daemon status` → "not running"; auto-spawn via a command; `bp daemon status`
  → "running (pid …), N sessions"; `bp daemon stop` → "stopped" + socket gone + `status` "not
  running".
- **Stale recovery:** write a bogus `daemon.pid` (dead pid) + leave a stale socket file; run a `bp`
  command → daemon replaces the stale socket and serves normally; `daemon status` consistent.
- `bp serve` (foreground): starts, logs to terminal, Ctrl-C / SIGTERM shuts down cleanly.
- Build clean; 71 unit tests still pass.
