# Bead browserplex-2mv — DOCS

**Shipped docs updated** (this is a user-facing feature, verified):
- `README.md`: added `electron` to the Browser Types table; new "Driving Electron apps" section
  documenting the renderer/preload-bridge win, the electron-only `session_create` params
  (`electronArgs`/`cwd`/`env`), and the caveats (not headless / xvfb on Linux CI; native dialogs
  need test hooks; navigate no-op; storageState N/A; tabs map to windows).
- MCP tool descriptions for `session_create` already carry the electron param docs (in
  `src/mcp/server.ts`), so MCP clients see them inline.

Out of scope / tracked elsewhere: the README's install section still references the old
`dist/index.js` path (the MCP entry moved to `dist/mcp/server.js` in bead .1). That belongs to bead
.7 (Docs + packaging), which already owns the README/packaging rewrite — noted on .7.
