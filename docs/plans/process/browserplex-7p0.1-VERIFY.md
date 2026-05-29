# Bead browserplex-7p0.1 — VERIFY

Objective evidence that the core extraction is behaviour-preserving (vitest + the live MCP
server produced these results, not opinion).

## Build
`rm -rf dist && npm run build` → **clean** (tsc, no errors). dist layout now:
`dist/core/{sessions,storage,snapshot,types,locator,actions}.js` + `dist/mcp/server.js`.

## Tests — `npm test`
**68/68 passed** across 3 suites:
- `sessions.test.ts` (13) — SessionManager via `../core/sessions.js`.
- `storage.test.ts` (12) — StorageManager via `../core/storage.js`.
- `integration.test.ts` (43) — spawns the **real MCP server** from `dist/mcp/server.js` and drives
  tools end-to-end (create/navigate/click/hover/type/wait/back, error paths). This is the strongest
  no-regression signal: the rewired server behaves identically through the MCP transport.

## Tool parity (beyond count — per Codex follow-up)
- `grep -c 'server.tool(' src/mcp/server.ts` = **28**.
- Booted `node dist/mcp/server.js` over stdio, sent `initialize` + `tools/list`: server advertised
  **exactly 28 tools**, names identical to the original set (session_*, storage_*, browser_*).

## Follow-ups from the PLAN gate — confirmed applied
- All `dist/index.js` refs moved → `dist/mcp/server.js` (package.json main/bin/start/types,
  integration.test.ts:8). Test imports → `../core/…`. ✓ (build + integration suite prove it)
- 7 non-throwing validation `return error()` paths converted to `throw new Error(...)` in
  actions.ts (storageLock, screenshot savePath, selectOption, tabs ×4). ✓
- Screenshot text-before-image ordering preserved via `toMcp` (text block only when savePath
  set, then image). ✓ — integration suite's screenshot path unaffected.
- `browser_evaluate` keeps `JSON.stringify(result, null, 2)` verbatim. ✓
- `?? default` zod-default workarounds preserved in every moved body. ✓
- `ActionResult.data` documented as JSON-serializable; only plain values placed in it. ✓

## Result
**PASS** — no behaviour change, acceptance criteria met (build clean, all existing suites green,
28 tools exposed identically).
