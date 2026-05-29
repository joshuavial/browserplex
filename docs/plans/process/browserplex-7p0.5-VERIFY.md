# Bead browserplex-7p0.5 — VERIFY

## Build & regression
- `npm run build` → clean. New `dist/cli/meta.js`; daemon/client/cli updated.
- `npm test` → **71/71 pass**.

## Lifecycle script — `/tmp/verify-d5.mjs`, RESULT: PASS (16 checks)
- ✓ `bp daemon status` with no daemon → "not running", and does **not** auto-spawn one.
- ✓ a command auto-spawns the daemon (inheriting `BROWSERPLEX_IDLE_MS`); `bp daemon status` → "running
  (pid …), 1 session(s): app".
- ✓ **daemon stays up past the idle window while a session exists** (idle suppressed by session count).
- ✓ **idle-exit:** after the last session is destroyed and a quiet wait > grace (no intervening
  connections), the daemon process is gone (checked via `process.kill(pid,0)`) and the socket removed.
- ✓ **`bp daemon stop`** (RPC `__daemon_stop`, no signalling) → "stopped", socket gone; `status` → "not
  running".
- ✓ **stale-socket recovery:** SIGKILL a live daemon (leaving a real stale socket inode) → the next
  `bp` command recovers (probe→unlink→relisten) and works; daemon listening again.
- ✓ **`bp serve`:** detects an already-running daemon ("daemon already running"); and starts the daemon
  in the foreground when none runs, exiting cleanly when the daemon is stopped.

## Verifying the gate's race concern
The idle-exit test deliberately observes via `process.kill(pid,0)` rather than socket polling — an
early version polled with `net.connect`, and each probe (correctly) bumped `openConnections` and
**re-armed** the idle timer, proving the guard works: any live connection suppresses idle-exit.

## PLAN-gate (round 2) follow-ups — applied
- Idle condition = `sessions==0 && inFlight==0 && openConnections==0`, re-checked on fire; idle timer
  cleared inside `shutdown()`; `inFlight--` in a `.finally`. ✓
- Control via RPC `__daemon_status`/`__daemon_stop` (handled before `actionDispatch`) — no `kill(pid)`
  of a possibly-reused PID. ✓
- Stale recovery: bounded probe→unlink→relisten loop, re-probes on a repeat `EADDRINUSE`, tolerates
  `ENOENT`. ✓
- `bp serve` detects already-running by probing first (not timing). ✓

## Deferred follow-ups (tracked)
- Per-connection inactivity timeout (Codex "consider"): intentionally **not** added — a blanket socket
  timeout would kill legitimate long ops (e.g. `wait_for`); a truly-abandoned connection from a
  misbehaving client is an acceptable edge for a single-user daemon. Tracked on .7.
- Client only auto-spawns on `ENOENT`/`ECONNREFUSED`; a non-socket regular file at the socket path
  (`ENOTSOCK`) isn't recovered (unrealistic vs a SIGKILL'd daemon's socket inode). Tracked on .7.
- Stale-recovery unlink is not atomic (acceptable for single-user autospawn). Tracked on .7.

## Final-review follow-up (Codex) — fixed
Codex's final review (PASS_WITH_FOLLOWUPS) caught a real bug: `Number(env ?? "") || 300_000` maps
`BROWSERPLEX_IDLE_MS=0` back to the default (0 is falsy), so "0 disables" was broken. Fixed with an
explicit `parseIdleMs()` (returns 0 for "0", default only when unset/empty/NaN/negative). Also added
Codex's defensive clamp: an idempotent `counted` flag so a double `close` can't decrement
`openConnections` twice. Proven by a contrast test (`/tmp/verify-idle0.mjs`): `IDLE_MS=800` + idle →
daemon exits; `IDLE_MS=0` + idle → daemon stays up. Full lifecycle suite + units still green.

## Result
**PASS** — daemon idle-exits when truly idle (race-guarded; `0` disables), `bp daemon status`/`stop`
work over RPC, stale sockets recover, and `bp serve` runs the daemon in the foreground.
