# Bead browserplex-7p0.3 — VERIFY

## Build & regression
- `npm run build` → clean. New: `dist/daemon/client.js`, `dist/cli/index.js`.
- `npm test` → **68/68 pass** (additive).

## Acceptance script — `/tmp/verify-d3.mjs`, RESULT: PASS
Each `bp` invocation is a **separate `node dist/cli/index.js` process** (real cross-process test):
- ✓ no daemon at start (socket removed).
- ✓ first command `session_create --name a --type chromium --headless` → **auto-spawns the daemon**
  and prints "Created chromium session 'a'".
- ✓ a SECOND process `browser_navigate -s a --url https://example.com` → **reuses the same live
  session** ("Navigated to https://example.com").
- ✓ **daemon pid stable** across invocations (no second daemon spawned).
- ✓ `session_list --json` → structured `{ok:true, data:[…]}` listing session `a`.
- ✓ **console buffer survives across separate `bp` processes**: `browser_evaluate` logs a message in
  one process; `browser_console_messages --json` in another process returns it. (The core proof the
  daemon architecture delivers.)
- ✓ unknown tool → friendly error + usage, exit code 2.

## PLAN-gate follow-ups — confirmed applied
- Daemon spawned with stdio redirected to `~/.browserplex/daemon.log` (append fd), not `"ignore"` —
  startup crashes are now debuggable. ✓
- Auto-spawn/connect exhaustion throws an actionable error naming the socket + log path. ✓
- `fileURLToPath(import.meta.url)` used to resolve the daemon entry (`dist/daemon/server.js`). ✓
- Replies correlated by `id` via a `Map<id,resolver>` (not arrival order); request promise rejects
  if the socket closes/errors before a reply; optional `BROWSERPLEX_TIMEOUT` env request timeout
  (default off, so long browser ops aren't cut short). ✓
- Deferred (noted): `bp` bin entry + `files`/package coverage of `dist/daemon` → bead .7.

## Result
**PASS** — `bp` transparently spawns the daemon, separate processes share one live session, and
`--json` emits structured data. Acceptance met.
