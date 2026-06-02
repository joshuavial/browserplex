# Changelog

## [0.5.0] - 2026-06-02

### Changed
- **Consistent headless default ([#1]):** all browser types now default to **headless**. Previously
  only `chromium` was headless-by-default while `firefox`/`webkit` opened a window. Electron always
  opens a real window regardless.

### Added
- **`--headed` flag** (and MCP `headed` param) on `session create` / `storage load` — opt into a
  visible window for any browser type. `--headless` still works as the explicit headless opt-in.

## [0.4.0] - 2026-05-30

### Added
- **`bp` CLI** front-end (new `bp` bin) over a shared core, backed by a **background daemon** that
  holds live browser sessions across separate `bp` invocations (auto-spawned on first use; unix
  socket at `~/.browserplex/daemon.sock`). All 28 tools are reachable as ergonomic subcommands
  (`bp session …`, `bp navigate`, `bp screenshot -o`, `bp eval`, `bp fill --field`, …).
- **`electron` session type** — drive an Electron app's renderer through the existing action surface
  (`session_create type="electron"` with `executablePath`/`electronArgs`/`cwd`/`env`).
- Daemon lifecycle: idle-exit (`BROWSERPLEX_IDLE_MS`, `0` disables), stale-socket recovery, and
  `bp serve` / `bp daemon status` / `bp daemon stop`.
- `BROWSERPLEX_DIR` env to relocate the runtime dir (daemon socket/pid/log + stored sessions).
- `bp prime` — prints an AI-agent primer (daemon model, ref workflow + gotchas, command reference) so
  an agent can drive the CLI correctly without external docs.
- `electron_evaluate` — run JS in the Electron MAIN process (electron sessions only), e.g. to stub
  native dialogs.
- Daemon IPC, CLI e2e, and protocol unit tests.

### Changed
- **Minimal runtime footprint:** only `@modelcontextprotocol/sdk`, `playwright`, and `zod` are required
  runtime dependencies. `sharp` (screenshot auto-resize) is now an **optional** dependency — installed
  by default so auto-resize keeps working, loaded lazily, and skippable via `--omit=optional` (falls
  back to full-size screenshots). `camoufox-js` (stealth engine) and `electron` are dev-only and loaded
  lazily — install `camoufox-js` to use that engine; drive Electron apps via the target app's own binary.
- Internal refactor: framework-agnostic core under `src/core`; the MCP server moved to
  `dist/mcp/server.js` (the `browserplex` bin name and `npx browserplex` usage are unchanged). MCP
  tool surface is byte-identical.

### Known limitations
- The `electron` type opens a real window (not headless); Linux CI needs a virtual display (xvfb).
- An abandoned/open client connection suppresses the daemon's idle-exit until it closes.
- A non-socket file left at the socket path is not auto-recovered (a real dead-daemon leftover is a
  socket and is recovered); stale-socket recovery is best-effort/non-atomic (fine for single-user).

## [0.3.0] - 2026-05-06

### Added
- `savePath` option on `browser_take_screenshot` writes the original (un-resized) PNG to disk while still returning the resized image to the caller. Parent directory must exist; absolute paths only.

## [0.2.0] - 2026-02-05

### Added
- ARIA snapshot with refs for 10x token reduction in browser automation
- Named session storage for cross-instance cookie/auth sharing
- All Playwright MCP tools (click, type, navigate, screenshot, etc.)
- Firefox browser type

### Fixed
- Sanitize domain filter in list() to match storage paths
- Sanitize domain/name inputs to prevent path traversal

## [0.1.0] - 2026-01-31

Initial release.

### Added
- Browser Broker MCP server for multi-session browser management
- WebKit (Safari engine) browser type
- Headless parameter for session creation
- Screenshot auto-resize for LLM image limits
- Unit and integration tests with vitest

### Fixed
- Zod defaults not applying via MCP SDK

### Changed
- Switch from camoufox to camoufox-js for ESM compatibility
