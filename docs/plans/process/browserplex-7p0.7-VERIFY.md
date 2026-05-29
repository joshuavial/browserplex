# Bead browserplex-7p0.7 — VERIFY

## Build & suite
- `npm run build` → clean (version 0.4.0).
- `npm test` → **91/91 pass** (was 87; +4 CLI parsing/help tests), all 7 files green.

## Packaging
- `package.json`: two bins — `browserplex` → `dist/mcp/server.js`, **`bp` → `dist/cli/index.js`**;
  version **0.4.0**; `src/mcp/server.ts` version string bumped to match.
- `npm pack --dry-run` includes both bins and all dist subdirs (`dist/cli/index.js`,
  `dist/mcp/server.js`, `dist/daemon/server.js`, `dist/core/actions.js`, …). `files:["dist","README.md"]`
  (CHANGELOG intentionally not shipped in the tarball — available in the repo).

## CLI fixes (tracked from .4) — implemented + tested
- **`-h`/`--help` value-slot-aware:** removed the global `argv.includes('-h')` interception; help is
  set in `parseCommand` only for a `-h`/`--help` in flag position (before `--`, not a flag's value),
  short-circuiting **before** `buildArgs` (so `bp eval --help` doesn't read stdin). Verified:
  `bp navigate --help` shows usage (per-command help preserved); `bp eval -- -h` treats `-h` as the
  script (not help). New tests assert both, plus top-level `bp --help`.
- **`--field` + `--fields-json` conflict:** errors ("use either --field or --fields-json, not both"),
  exit 2. New test asserts it.

## Docs (shipped)
- README: fixed the stale `dist/index.js` → `dist/mcp/server.js` local-dev path; new **"CLI (`bp`)"**
  section (daemon model, command groups, examples) + a daemon-control/env table (`bp serve`,
  `bp daemon status|stop`, `BROWSERPLEX_IDLE_MS`, `BROWSERPLEX_DIR`); the electron section (from 2mv)
  remains.
- CHANGELOG: `0.4.0` entry (CLI + daemon + electron + env knobs; the MCP-entry move noted as internal
  with the `browserplex` bin/`npx` usage unchanged) + a **Known limitations** subsection capturing the
  deferred lifecycle edges (electron-not-headless/xvfb; abandoned connection suppresses idle-exit;
  non-socket-file/non-atomic stale recovery).

## Leak check
No leftover `/tmp/bp-*` temp dirs and no stray daemons from the suite (a stray daemon observed during
verification was from a manual smoke test in the real `~/.browserplex`, cleaned via `bp daemon stop`).

## Result
**PASS** — both bins package correctly, `bp` usage + lifecycle + env are documented, CHANGELOG
updated, and the two CLI-parse fixes are implemented and tested. Epic deliverable complete.
