# Bead browserplex-7p0.1 — PLAN

**Title:** Extract shared core from MCP server
**Gate level:** 2 (defines the `src/core` module boundary + `ActionResult` contract every later
bead builds on — architectural, expensive to reverse). No-behaviour-change refactor, test-guarded.

## Acceptance (from bead)
No behaviour change; `npm run build` clean; existing vitest suites (sessions/storage/integration)
all pass; MCP server still exposes all 28 tools identically.

## Objective
Carve a framework-agnostic core out of `src/index.ts` so both the MCP server (this bead) and the
future `bp` daemon (bead .2) call the *same* action logic. This bead does **not** add the daemon
or CLI — only the extraction + MCP re-wiring.

## Target layout
```
src/core/
  sessions.ts   (git mv from src/ — already MCP-free, only import specifiers change)
  storage.ts    (git mv from src/)
  snapshot.ts   (git mv from src/ — already exports isRef/getLocatorFromRef/getEnhancedSnapshot)
  types.ts      (git mv from src/ — add ActionResult)
  locator.ts    NEW — getLocator() + toAIFriendlyError() moved out of index.ts (both are
                framework-agnostic and the CLI will want the AI-friendly messages too)
  actions.ts    NEW — one async fn per tool: (args) => Promise<ActionResult>
src/mcp/
  server.ts     (was src/index.ts) — McpServer bootstrap + 28 server.tool regs, each handler a
                thin wrapper: zod-validate -> call core action -> map ActionResult to MCP content
```

## The `ActionResult` contract (new, in `core/types.ts`)
```ts
export interface ActionResult {
  text: string;                                   // human summary == today's success() strings
  data?: unknown;                                 // structured payload (list/console/network/eval)
  image?: { base64: string; mimeType: string };   // screenshot only
}
```
- Actions **throw** `Error` on failure (selector errors thrown pre-mapped via `toAIFriendlyError`).
- The MCP adapter catches throws → `error(msg)`; success → maps `text`/`image` to MCP `content`
  (text block, image block, or both — preserving today's screenshot text+image behaviour).
- `data` is unused by the MCP adapter today (keeps output byte-identical) but is what the CLI's
  `--json` will surface in bead .3/.4. Populating it now for list-like actions is free and avoids
  re-touching every action later.

## Action inventory (28) and non-trivial return shapes
- **Plain text** (most): session_create/destroy, storage_save/load/delete/lock/unlock,
  navigate/back/click/type/press/hover/drag/select/upload/fill/dialog/wait/resize/press_key.
- **Mutates session state:** `snapshot` sets `s.refMap = snapshot.refs` then returns text+stats —
  keep the mutation inside the action (it owns the session object).
- **Image:** `take_screenshot` → `ActionResult.image` (+ optional "Saved to …" text when savePath);
  keep the absolute-path guard and sharp resize logic verbatim.
- **Structured data:** session_list, storage_list, console_messages, network_requests → set both
  `text` (today's formatted lines) and `data` (the raw array). `evaluate` → `text` (stringified)
  + `data` (raw result). `tabs` → text (+ data: tab list).

## Mechanics
1. `git mv` the 4 core files to `src/core/`; fix their relative `.js` import specifiers (they only
   import each other + playwright).
2. Add `core/types.ts: ActionResult`; add `core/locator.ts` (move `getLocator` + `toAIFriendlyError`
   from index.ts; `getLocator` depends on `isRef`/`getLocatorFromRef` already in snapshot.ts).
3. Write `core/actions.ts`: lift each handler **body** (the `try` block sans the MCP `success`/`error`
   wrapping) into a named exported fn that returns `ActionResult` / throws. Reuse the singleton
   `sessionManager` and `storageManager` exports unchanged.
4. Recreate `src/index.ts` as `src/mcp/server.ts`: keep all 28 `server.tool(name, desc, zodSchema,
   handler)` regs (descriptions/schemas verbatim so the MCP surface is byte-identical); each handler
   = `try { return toMcp(await actions.x(args)) } catch(e){ return error(e.message) }`. Keep the
   SIGINT/SIGTERM `destroyAll()` cleanup and the stdio transport bootstrap.
5. Update `package.json` `main`/`bin`(`browserplex`)/`types` from `dist/index.js` → `dist/mcp/server.js`.
   Update test imports that reference `../sessions.js` etc → `../core/…`.
6. `tsconfig.json` already compiles `src/**` — no change expected; verify.

## Risk / rollback
Pure restructure; git is the rollback. The three existing vitest suites are the regression net —
they import the core modules directly, so a broken extraction fails them immediately.

## Verification
- `npm run build` → clean tsc.
- `npm test` → sessions + storage + integration suites green (proves no behaviour change).
- Tool-parity check: grep `server.tool(` count in `src/mcp/server.ts` == 28; spot-run the MCP server
  (`node dist/mcp/server.js`) and confirm it boots on stdio without error.

## Out of scope (later beads)
Daemon/unix socket (.2), CLI (.3/.4), lifecycle (.5), new tests (.6), packaging/README (.7). No
`ActionResult.data` consumer ships in this bead — it's populated but only the CLI will read it.

---

## PLAN GATE (Level 2) — verdict + absorbed follow-ups
Seats: agy **PASS** (model: Gemini 3.1 Pro — L2 evidence ✓) · Claude Opus 4.8 **PASS_WITH_FOLLOWUPS**
· Codex 5.5 xhigh **PASS_WITH_FOLLOWUPS**. **Synthesis: PASS_WITH_FOLLOWUPS** — no blocks; architecture
sound. The following follow-ups are folded into Implement (verified against the code):

1. **All `dist/index.js` references must move to `dist/mcp/server.js`** — `package.json` `main`
   (L6), `bin.browserplex` (L9), **and `start` (L17)**; **`src/__tests__/integration.test.ts:8`**
   (`serverPath = '../../dist/index.js'`) — *acceptance-breaker if missed*.
2. **Test import paths:** `sessions.test.ts:2` (`../sessions.js`) and `storage.test.ts:5-6`
   (`../storage.js`, `../sessions.js`) → `../core/…`.
3. **Convert the 7 non-throwing validation `return error(...)` paths to `throw new Error(...)`** so
   they round-trip through the adapter with identical text + `isError:true`: L217 storage_lock
   failed-acquire (boolean-false today), L329 savePath-not-absolute, L505 select_option
   "Must provide value, label, or index", L730/L736/L740/L748 tabs (invalid index ×2, last-tab,
   unknown-action). All `return error((e).message)` and `toAIFriendlyError` catches already throw
   naturally once bodies move — only these literal-validation returns need converting.
4. **Screenshot ordering:** when `savePath` set, adapter emits the **text block before the image
   block** (`content[0]=text, content[1]=image`) — integration test asserts this.
5. **`browser_evaluate`:** keep `JSON.stringify(result, null, 2)` verbatim (preserves undefined-result
   formatting).
6. **Preserve the explicit `?? default` zod-default workarounds** inside the moved bodies (agy +
   Codex) — they travel with the body; do not drop them.
7. **`ActionResult.data` must be JSON-serializable** (Codex) — it's the daemon/CLI wire payload in
   later beads; only put plain objects/arrays/primitives in it.
8. **Tool parity beyond count** (Codex): not just `server.tool(` == 28 — spot-check a few tool
   names + zod schemas are byte-identical, and boot the server on stdio.
