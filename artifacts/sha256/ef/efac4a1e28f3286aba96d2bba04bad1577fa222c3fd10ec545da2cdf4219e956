# Bead browserplex-7p0.6 — VERIFY

## Build & suite
- `npm run build` → clean.
- `npm test` → **87/87 pass** (was 71; +16: 9 protocol + 4 daemon + 3 cli-e2e), all **7** test files
  green. Run **twice** — stable, no flakiness.

## New tests
- `protocol.test.ts` (9, pure/fast): `LineDecoder` one-per-line, multi-per-chunk, split-across-chunks,
  empty-line skip, **multi-byte UTF-8 split across chunk boundary**, `encodeMessage` round-trip, and
  both `MAX_LINE_BYTES` overflow paths throw.
- `daemon.test.ts` (4, spawns built daemon in an isolated `BROWSERPLEX_DIR`): socket round-trip
  (session_create→navigate→evaluate→console→destroy, id-correlated via the real `LineDecoder`); error
  isolation (unknown tool, malformed line → connection survives); `__daemon_status` control RPC; and
  **idle-exit** observed via `process.kill(pid,0)` (never a socket connect, which would re-arm the
  timer).
- `cli-e2e.test.ts` (3, separate `bp` processes, isolated dir): auto-spawn + cross-process session
  reuse; **console buffer persists across separate `bp` processes**; `bp daemon status`/`stop`.

## Isolation + leak checks (the gate's concerns)
- Product change: `BROWSERPLEX_DIR` overrides the base dir in both `protocol.ts` (socket/pid/log) and
  `storage.ts` (sessions) — coherent relocation + per-test isolation. Each spawned daemon/CLI gets a
  unique temp dir via env; vitest workers compute paths themselves (no import-time env dependency).
- Cleanup kills the **daemon pid** (from PID_PATH / `bp daemon stop`), not the detached `bp` child,
  tolerating ESRCH. After two full runs: **no stray `dist/daemon/server.js` processes** and **no
  leftover `/tmp/bp-*` dirs** (`mkdtemp` dirs removed in `afterAll`).
- Tests use chromium headless (always available via the playwright dep) → CI-friendly; the electron
  test (2mv) remains separately skip-guarded.

## Result
**PASS** — committed daemon IPC + CLI e2e + protocol tests pass (twice), parallel-isolated, no leaks.
