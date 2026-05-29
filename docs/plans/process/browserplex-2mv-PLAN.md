# Bead browserplex-2mv — PLAN

**Title:** Add 'electron' session type to drive Electron apps via Playwright
**Priority:** P0. **Gate level:** 2 (widens the `BrowserSession.browser` union + adds a new launch/
destroy path in core; affects every action via the shared `session.page`).

## Acceptance (from bead)
Drive Electron apps (renderer) through the existing session/action surface: a session lifecycle
test launches a tiny Electron fixture app and drives a renderer assertion via
`browser_evaluate`/`browser_snapshot`. All existing page-centric actions work unchanged because an
Electron window is the same Playwright `Page`.

## Key insight (validated)
`playwright._electron` is already present (no runtime dep added). `_electron.launch({ args, cwd, env })`
resolves the Electron binary from `cwd`'s `node_modules`, so browserplex drives the **target app's**
Electron (e.g. SpokeCut) — browserplex needs Electron only as a **devDependency for its own test**
(user-approved). Every action operates on `session.page`, so snapshot/click/type/evaluate/screenshot/
console/network work unchanged on an Electron window.

## Changes
1. **`src/core/types.ts`**
   - `BrowserType`: add `'electron'`.
   - `BrowserSession.browser`: widen to `Browser | BrowserContext | ElectronApplication`
     (import `type ElectronApplication` from playwright).
   - New `interface ElectronLaunchOptions { args?: string[]; cwd?: string; env?: Record<string,string> }`.
2. **`src/core/sessions.ts`**
   - Import `_electron` + `type ElectronApplication`.
   - `create(...)` / `createWithStorage(...)`: add a trailing optional `launch?: ElectronLaunchOptions`
     param, threaded through. (`storageState` is ignored for electron — documented caveat.)
   - New branch: `type === 'electron'` →
     `const app = await _electron.launch({ args: launch?.args ?? ['.'], cwd: launch?.cwd, env: launch?.env });
      page = await app.firstWindow(); context = app.context(); browser = app;` — `headless` ignored.
     Console/network listeners attach to `page` unchanged.
   - `destroy(...)`: guard for electron — `await (browser as ElectronApplication).close()` and **skip**
     `context.close()` (an Electron app closes via the app). Non-electron path unchanged.
3. **`src/core/actions.ts`** — `sessionCreate` gains optional `electronArgs?: string[]`, `cwd?: string`,
   `env?: Record<string,string>`; passes them to `sessionManager.create` only when relevant.
   (Naming: `electronArgs` rather than the bead's bare `args` — avoids colliding with the action's own
   `args` object and self-documents that it's electron-only. Flagging for gate review.)
4. **`src/mcp/server.ts`** — add `"electron"` to the `session_create` `type` z.enum; add optional
   `electronArgs: z.array(z.string()).optional()`, `cwd: z.string().optional()`,
   `env: z.record(z.string()).optional()` (described as electron-only). `storage_load`'s enum is left
   unchanged (loading stored web state into an Electron launch is nonsensical — the bead notes
   storageState doesn't apply to electron).
5. **Daemon path** — no change needed: the daemon dispatches `session_create` to
   `actions.sessionCreate` (bead .1/.2), so threading the params through the action covers it. The
   ergonomic CLI parsing of array/object flags (`electronArgs`/`env`) is bead .4; this bead exercises
   the MCP + direct-sessionManager paths.

## Test + fixture (user-approved: add electron devDep)
- `package.json`: add `electron` to `devDependencies`.
- `src/__tests__/fixtures/electron-app/` — minimal app: `package.json` (`{"main":"main.js"}`),
  `main.js` (creates a `BrowserWindow`, loads `index.html`), `index.html` (sets
  `window.__bpTest = "electron-ok"`, a heading, and a button for snapshot/click).
- `src/__tests__/electron.test.ts` — `describe.skipIf(!electronAvailable && !hasDisplay)`:
  `sessionManager.create('e','electron',false,{ args:[fixtureDir] })` → `firstWindow` →
  assert `browser_evaluate('window.__bpTest')==='electron-ok'` and a `browser_snapshot` shows the
  heading → `destroy('e')` cleanly. Skips gracefully where Electron can't open a window (headless CI
  without xvfb).

## Caveats to document (per bead; in DOCS/README later)
- Not headless: `_electron.launch` opens a real window; CI needs xvfb on Linux; `headless` is ignored.
- Native OS file dialogs aren't drivable — apps must expose test hooks (the `env` param enables them,
  e.g. SpokeCut's `SPOKECUT_SMOKE`).
- `navigate` is a no-op for a launched Electron app; `storageState` doesn't apply; `tabs` maps to
  BrowserWindows.
- MAIN-process `app.evaluate` access is out of scope for v1 (optional follow-up).

## Verification
- `npm run build` clean; existing 68 tests still pass.
- New electron test passes locally (macOS opens the fixture window) — real launch→firstWindow→
  evaluate→snapshot→destroy lifecycle. Confirm it **skips** cleanly when Electron/display is absent.
- Manual: `session_create type=electron electronArgs=[<app>] cwd=<app>` then `browser_evaluate` runs
  in the renderer (preload bridge live).
