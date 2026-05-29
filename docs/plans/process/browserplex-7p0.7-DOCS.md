# Bead browserplex-7p0.7 — DOCS

**Shipped docs updated** (this IS the docs bead):
- `README.md`: fixed the stale `dist/index.js` local-dev MCP path → `dist/mcp/server.js`; added the
  "CLI (`bp`)" section (daemon model, command groups, examples) + a daemon-control/env table
  (`bp serve`, `bp daemon status|stop`, `BROWSERPLEX_IDLE_MS`, `BROWSERPLEX_DIR`); intro now notes the
  two front-ends (MCP server + `bp` CLI). Electron section (bead 2mv) retained.
- `CHANGELOG.md`: `0.4.0` entry + a "Known limitations" subsection (deferred lifecycle edges).
- MCP tool descriptions already document the electron `session_create` params inline (2mv).

All accumulated tracked notes on this bead are resolved: stale path fixed, `bp` bin added, CLI +
lifecycle + both env knobs documented, the two CLI-parse nits fixed, and the deferred lifecycle edges
recorded under CHANGELOG "Known limitations".
