# Bead browserplex-7p0.2 — VERIFY

## Build & regression
- `npm run build` → clean. New: `dist/core/dispatch.js`, `dist/daemon/{protocol,server}.js`.
- `npm test` → **68/68 pass** (core untouched; this bead is additive).

## Round-trip script (the acceptance) — `/tmp/verify-d2.mjs`, RESULT: PASS
Spawned `node dist/daemon/server.js`, connected a raw `net` client, exercised the wire protocol:
- ✓ socket file created at `~/.browserplex/daemon.sock`.
- ✓ **`session_create` (chromium headless) → ok** ("Created chromium session 'd2'").
- ✓ **`browser_navigate` → ok** against the live browser the daemon holds ("Navigated to
  https://example.com").
- ✓ `browser_snapshot` returns both `text` and structured `data` (data.url echoed) — proves the
  `ActionResult.data` wire path.
- ✓ **error isolation:** unknown tool → `{ok:false, error:"Unknown tool: …"}`; a malformed JSON line
  and a missing-`id` shape error each produce an error reply **without killing the connection**;
  subsequent `session_list` still succeeds.
- ✓ **clean shutdown:** `SIGTERM` → daemon exits code 0 and the socket file is removed.

## PLAN-gate follow-ups — confirmed applied
1. Shutdown: `shuttingDown` re-entrancy guard + 10s `unref()`'d force-exit backstop. ✓
2. `reply.id === request.id` invariant; best-effort id echo even on shape errors; `id:null` only when
   unparseable. ✓ (script asserts both)
3. Socket perms `0o600` via `fs.chmod`. ✓
4. `LineDecoder` skips empty lines and throws past `MAX_LINE_BYTES` (16 MiB) → connection rejected
   + destroyed. ✓
5. JSON encode wrapped (`safeEncode`) so a non-serializable `data` degrades to an error reply rather
   than crashing. ✓
6. `EADDRINUSE` → **probe the socket** (`net.connect`): live daemon → exit cleanly; stale → unlink &
   retry. Never blindly unlinks a live daemon. ✓

## Final-review BLOCK (Codex) — fixed + re-verified
Codex final-review found a real BLOCK: `LineDecoder` only capped the unterminated *tail*, so an
oversized **complete** line ending in `\n` bypassed `MAX_LINE_BYTES`. Fixed by capping **every**
completed line (not just the tail). Folded in three agy hardening points + Codex's probe timeout:
- `LineDecoder` now uses `StringDecoder` so multi-byte UTF-8 split across chunks isn't corrupted.
- Oversized-line rejection uses `socket.end(payload)` (flushes) instead of `write`+`destroy` (drops).
- Socket bound under `umask(0o177)` (perms correct from creation; no chmod race), chmod kept as belt-and-suspenders.
- `probeSocket()` has a 2s timeout so a wedged connect can't hang startup.

Re-verification (`/tmp/verify-d2c.mjs`, `/tmp/verify-utf8.mjs`) — all PASS:
- ✓ **oversized complete line (17 MiB ending in `\n`) → error reply** ("message exceeds 16777216
  bytes"), daemon stays alive and serves the next request.
- ✓ socket perms `0o600` confirmed via `fs.stat`.
- ✓ **multi-byte UTF-8 round-trips** (`café — 日本語 — 🚀`) via `evaluate` of a unicode literal —
  IPC-only path, both directions. (An earlier apparent failure was a charset-less `data:` URL the
  *browser* mis-decoded; with `charset=utf-8` the title is also correct — not an IPC bug.)
- ✓ clean SIGTERM exit.

## Second final-review BLOCK (agy) — fixed + re-verified
The re-review of the first fix drew a second BLOCK from agy: (1) `socket.end()` half-closes, so
later data could `write()` on an ended stream; (2) `process.umask()` mutates process-global state
across the async `listen()` boundary. Resolved:
- onConnection uses a `closing` flag + `socket.pause()` + `socket.end(payload, () =>
  socket.destroy())`; all writes route through `reply()` which no-ops when closing/destroyed/not
  writable — no write-after-end path remains.
- `umask` removed entirely; the daemon `chmod 0o700` the base dir `~/.browserplex` (protects the
  socket regardless of its own mode) plus `chmod 0o600` the socket. No global mutation.
Re-verified: base dir confirmed `drwx------` (0700), socket `0600`, oversized-line reject + daemon
survival, UTF-8 round-trip, clean SIGTERM — all PASS. Round-3 re-review: **agy PASS, Opus PASS,
Codex PASS** (one stale `umask` comment removed).

## Result
**PASS** — daemon hosts the live sessionManager over the unix socket, round-trips
session_create+navigate, isolates bad input (incl. oversized lines), preserves UTF-8, restricts
perms (dir 0700 + socket 0600), and shuts down cleanly. Both final-review BLOCKs resolved.
