# Bead browserplex-7p0.7 — PLAN

**Title:** Docs + packaging (epic-completing bead)
**Gate level:** 1 (packaging + docs + two tiny CLI-parse fixes; low-risk, reversible). agy + Opus.

## Acceptance (from bead)
`npm pack` includes both bins; README documents `bp` usage; CHANGELOG updated.

## Scope — packaging
- `package.json`:
  - Add `bp` bin: `"bin": { "browserplex": "./dist/mcp/server.js", "bp": "./dist/cli/index.js" }`.
  - Verify `files: ["dist", "README.md"]` ships everything (`dist/cli`, `dist/daemon`, `dist/core`,
    `dist/mcp`) — confirm via `npm pack --dry-run`.
  - Bump version to **0.4.0** (substantial new surface: CLI, daemon, electron). Update the MCP
    server `version` string in `src/mcp/server.ts` to match.
  - Ensure both bins are executable (they already start with `#!/usr/bin/env node`).

## Scope — docs (README)
- **Fix stale paths:** the local-dev MCP config + `main`/start references must point at
  `dist/mcp/server.js` (the entry moved in bead .1), not `dist/index.js`.
- **New "CLI (`bp`)" section:** install/build, the auto-spawn daemon model (one background daemon
  holds live sessions; `bp` is a thin client), and a command reference grouped like `bp --help`:
  `session create|list|destroy`, `storage …`, the browser verbs, and notables (`screenshot -o`,
  `fill --field`, `eval` arg/stdin, `-s/--session`, `--json`).
- **Daemon lifecycle:** `bp serve` / `bp daemon status` / `bp daemon stop`; env knobs
  `BROWSERPLEX_IDLE_MS` (idle-exit grace; `0` disables) and `BROWSERPLEX_DIR` (relocate the runtime
  dir: socket/pid/log + stored sessions; default `~/.browserplex`).
- Electron section already added in bead 2mv — leave as is.

## Scope — CHANGELOG
- Add a `0.4.0` entry: `bp` CLI + background daemon over a shared core; `electron` session type;
  `BROWSERPLEX_IDLE_MS`/`BROWSERPLEX_DIR`; note the MCP server moved to `dist/mcp/server.js`
  (internal; the `browserplex` bin name + `npx browserplex` usage are unchanged).

## Scope — the two tiny CLI-parse fixes (tracked from .4)
1. **`-h`/`--help` value-slot-aware (corrected per gate BLOCK):** the rule is NOT "index relative to
   the command path" — a help flag legitimately comes AFTER the command path (`bp type --help`,
   `bp session create --help`), so that would regress per-command help. Instead:
   - **Remove the global `argv.includes('-h'|'--help')` interception** in `index.ts`.
   - **Integrate help into `parseCommand`:** a `-h`/`--help` token encountered **in flag position**
     (before any `--`, and not being consumed as a flag's value) sets `parsed.help`; `index.ts` then
     prints `usageFor(matchedSpec)` and exits 0.
   - Top-level `bp` (no command) / `bp -h` / `bp --help` (no command matched) → `topUsage()`.
   - A `-h` after `--` or in a positional value slot is NOT help (e.g. `bp eval -- '-h'` evaluates the
     literal). This is value-slot-aware and preserves `bp <cmd> --help`.
2. **`--field` + `--fields-json` conflict:** error clearly if BOTH are supplied (today the
   `--fields-json` string silently overwrites the `--field`-built array at commands.ts buildArgs).

## Tests (per gate non-blocking)
Add CLI help/parse coverage to `cli-e2e.test.ts` so fix #1 can't silently re-break:
- `bp --help` and `bp <cmd> --help` (e.g. `bp navigate --help`) BOTH print usage, exit 0;
- the both-flags conflict (`bp fill --field a=b --fields-json '[]'`) errors (exit 2).

## Explicitly NOT doing (documented as known limitations, acceptable for a single-user daemon)
- Reaping truly-abandoned idle connections (a blanket socket timeout would kill long ops) — leave;
  note that an abandoned client connection suppresses idle-exit.
- `ENOTSOCK` recovery when a non-socket file sits at the socket path (a real dead-daemon leftover is
  a socket → already recovered).
- Non-atomic stale-socket unlink (fine for single-user autospawn).
**Single destination (per gate):** these go in a **CHANGELOG "Known limitations"** subsection (README
has no such section), so the note isn't dropped.

## Files
- `package.json` (bin, version, verify files); `src/mcp/server.ts` (version string); `README.md`
  (paths + CLI + lifecycle + env); `CHANGELOG.md`; `src/cli/index.ts` + `src/cli/commands.ts` (the two
  parse fixes).

## Verification
- `npm run build` clean; `npm test` 87/87 still green (the two parse fixes shouldn't regress; add/keep
  coverage via the existing cli-e2e where cheap).
- `npm pack --dry-run` lists both `dist/cli/index.js` and `dist/mcp/server.js` and the tarball
  includes `dist/{core,daemon,mcp,cli}`.
- Smoke: `node dist/cli/index.js --help` shows commands incl. serve/daemon; `node dist/cli/index.js
  type sel -h` no longer wrongly prints top help (fix #1); `bp fill --field a=b --fields-json '[]'`
  errors (fix #2). Boot `node dist/mcp/server.js` over stdio (28 tools) unaffected.
- Epic close: confirm all of `browserplex-7p0.1..7` are closed → the bp-CLI milestone is reachable
  and testable by the user.
