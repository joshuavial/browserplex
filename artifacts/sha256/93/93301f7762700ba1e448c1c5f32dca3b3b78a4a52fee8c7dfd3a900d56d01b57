# Bead browserplex-7p0.2 — PLAN

**Title:** Daemon server + IPC protocol
**Gate level:** 2 (defines the IPC wire protocol every `bp` client will depend on — architectural,
expensive to reverse once shipped).

## Acceptance (from bead)
Daemon starts, accepts a socket connection, round-trips a `session_create` + `browser_navigate`
request against a live browser it holds, and shuts down cleanly.

## Objective
A long-lived background process that holds the live `sessionManager` (the same singleton from
`src/core/sessions.ts`) and exposes the core actions over a local unix-domain socket. This bead is
the **server + protocol only** — auto-spawn and the `bp` CLI are bead .3; lifecycle polish
(idle-exit, stale-pid recovery, `bp serve/status/stop`) is bead .5.

## New files
```
src/core/dispatch.ts   tool-name -> core action registry (framework-agnostic; daemon resolves
                       incoming {tool} against it). Exported for reuse + unit testing.
src/daemon/protocol.ts paths + request/response types + newline-JSON framing helpers
src/daemon/server.ts   net.createServer over the unix socket; dispatch; graceful shutdown
```

## Protocol (`src/daemon/protocol.ts`)
- Paths under the existing base dir `~/.browserplex/` (matches `storage.ts` `SESSIONS_DIR`):
  `SOCKET_PATH = ~/.browserplex/daemon.sock`, `PID_PATH = ~/.browserplex/daemon.pid`,
  `LOG_PATH = ~/.browserplex/daemon.log`.
- **Newline-delimited JSON**, one object per line.
  - Request: `{ id: number; tool: string; args?: Record<string, unknown> }`
  - Response: `{ id: number; ok: boolean; text?: string; data?: unknown; imageBase64?: string;
    mimeType?: string; error?: string }`
- Helpers: `encodeMessage(obj): string` (`JSON.stringify + "\n"`) and a `LineDecoder` that buffers
  socket chunks, splits on `\n`, and yields parsed objects (tolerates partial/multi-line chunks).
  `ActionResult.image` maps to `imageBase64` + `mimeType` on the wire (base64 is JSON-safe).

## Dispatch (`src/core/dispatch.ts`)
`export const actionDispatch: Record<string, (args: any) => Promise<ActionResult>>` mapping all 28
tool names (`session_create`…`browser_tabs`) to the `actions.*` functions. One-liner per tool; the
arg object passes straight through (action validates/defaults internally, as today). This is the
single source of "tool name → behaviour" shared by the daemon (and exercisable by tests in .6).

## Daemon (`src/daemon/server.ts`) — `#!/usr/bin/env node`
1. `await fs.mkdir(~/.browserplex, {recursive:true})`.
2. Best-effort `fs.unlink(SOCKET_PATH)` if a socket file is present (basic; full stale-pid recovery
   is .5) so `listen` doesn't `EADDRINUSE`.
3. `net.createServer((socket) => …)`: per connection attach a `LineDecoder`; for each decoded
   request resolve `actionDispatch[tool]` →
   - missing tool → `{ id, ok:false, error:"Unknown tool: <tool>" }`
   - else `try { const r = await fn(args); reply {id, ok:true, text:r.text, data:r.data,
     imageBase64:r.image?.base64, mimeType:r.image?.mimeType} } catch(e){ reply {id, ok:false,
     error:e.message} }`. Each reply written via `encodeMessage`. Malformed JSON line → error reply
     with `id:null` (best-effort), never crash the connection.
4. `server.listen(SOCKET_PATH)` → write `PID_PATH`, log "listening on <socket>".
5. **Graceful shutdown** (reuse pattern from the old MCP server): `SIGINT`/`SIGTERM` →
   `server.close()` → `sessionManager.destroyAll()` → unlink socket + pid → `process.exit(0)`.

## Concurrency note
Requests run on the single JS event loop and `await`; multiple in-flight requests against the *same*
session's page can interleave — identical to today's MCP server semantics (no new guarantee weakened).

## Out of scope (later beads)
Auto-spawn + `bp` CLI client (.3), full command surface (.4), idle-exit/stale-pid/`bp serve|status|
stop`/log-file wiring (.5), committed daemon+e2e tests (.6), packaging/README (.7).

## Verification
- `npm run build` clean; existing 68 tests still green (no core behaviour touched).
- **Round-trip script** (in /tmp, not committed — committed tests are .6): `node dist/daemon/server.js`
  (background) → connect a `net` client → send `session_create {name, type:"chromium", headless:true}`
  then `browser_navigate {session, url:"https://example.com"}`, assert both `ok:true` and the
  navigate text → send `SIGTERM` → assert process exits 0 and `daemon.sock` is gone.
- Unit-spot: `LineDecoder` handles a chunk containing two newline-joined messages and a split message
  across two chunks.
