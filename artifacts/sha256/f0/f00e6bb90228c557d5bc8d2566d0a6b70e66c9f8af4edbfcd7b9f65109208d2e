# Bead browserplex-7p0.6 — PLAN

**Title:** Tests: daemon IPC + CLI e2e
**Gate level:** 1 (additive tests; the one small product change — a `BROWSERPLEX_DIR` override for
test isolation — is low-risk and independently useful). agy + Opus.

## Acceptance (from bead)
New daemon + e2e tests pass in CI; `npm test` green overall. (Formalize the `/tmp` verify scripts
proven across .2–.5 into committed vitest tests.)

## Test isolation (small product change)
vitest runs test files in parallel, but the daemon socket path is fixed at
`~/.browserplex/daemon.sock` — parallel daemon/CLI tests (and a developer's own running daemon) would
collide. Make the base dir overridable:
- `src/daemon/protocol.ts`: `BASE_DIR = process.env.BROWSERPLEX_DIR || path.join(os.homedir(),
  ".browserplex")` (socket/pid/log derive from it). This is also a genuinely useful feature (relocate
  the runtime dir). Each new test sets `BROWSERPLEX_DIR` to a unique temp dir for the daemon/CLI it
  spawns, so tests never collide with each other or a real daemon.
- The test computes socket/pid paths from its own `BROWSERPLEX_DIR` (no in-process import-time env
  dependency); spawned daemon/CLI children get the env explicitly.

## New test files
1. **`src/__tests__/protocol.test.ts`** (pure, fast, no processes) — `LineDecoder` + `encodeMessage`:
   - one message per line; multiple messages in one chunk; a message split across two chunks;
   - empty lines skipped; a multi-byte UTF-8 char split across chunk boundaries decodes intact;
   - a line exceeding `MAX_LINE_BYTES` throws; round-trip `encodeMessage`→decode.
2. **`src/__tests__/daemon.test.ts`** (spawns `dist/daemon/server.js`, isolated `BROWSERPLEX_DIR`):
   - round-trip over a raw `net` socket using the real `LineDecoder`/`encodeMessage`:
     `session_create {chromium, headless}` → `browser_navigate` (data: URL) → `browser_evaluate`
     (renderer value) → `browser_console_messages` (buffer) → `session_destroy`; assert id-correlated
     replies and `ok`.
   - error isolation: unknown tool → `{ok:false}`; a malformed line → error reply, connection
     survives; oversized line → error + socket closed.
   - control RPC: `__daemon_status` returns `{pid, sessions}`; `__daemon_stop` → reply then exit +
     socket removed.
   - idle-exit: spawn with `BROWSERPLEX_IDLE_MS` small + no session → process exits (observed via
     `process.kill(pid,0)`, never via a socket connect that would re-arm the timer).
3. **`src/__tests__/cli-e2e.test.ts`** (spawns `dist/cli/index.js` as SEPARATE processes, isolated
   `BROWSERPLEX_DIR`):
   - first command auto-spawns the daemon; a second process reuses the live session;
   - **console buffer survives across separate `bp` processes** (the core proof); `--json` structured;
   - `bp daemon status` running/not-running; `bp daemon stop` → stopped; daemon pid stable across
     commands.

## Mechanics / hygiene
- All spawned daemons use a per-file unique temp `BROWSERPLEX_DIR`; `afterAll`/`afterEach` SIGTERM the
  daemon (or `bp daemon stop`) and remove the temp dir, so no daemon/browser leaks between tests.
- Use chromium headless (always available via the playwright dep) so these run in CI without a
  display. (The electron test from bead 2mv stays separately skip-guarded.)
- Generous per-test timeouts (browser launch); vitest config already 30s — bump specific tests to 60s.
- These tests spawn the BUILT `dist/...` (same pattern as the existing `integration.test.ts` which
  spawns `dist/mcp/server.js`), so `npm test` continues to require a prior `npm run build`.

## Out of scope
Packaging/README/`bp` bin (.7); the deferred lifecycle edges tracked on .7.

## Verification
- `npm run build` && `npm test` → all suites green incl. the 3 new files; run twice to check for
  flakiness/daemon leaks; confirm no stray daemon processes or leftover temp dirs afterward.
- Confirm parallel-safety: the new daemon/cli tests use distinct `BROWSERPLEX_DIR`s and pass when run
  together.
