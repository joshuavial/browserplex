# Bead browserplex-7p0.1 — DOCS

**No shipped user-facing docs change in this bead.** Rationale:

- This is an internal refactor (extract `src/core`, rewire the MCP server as a thin adapter).
  The MCP server's external surface is **byte-identical** (same 28 tools, same schemas, same
  output), so README usage instructions remain accurate as-is.
- `package.json` `main`/`bin`/`start` now point at `dist/mcp/server.js`, but the user-facing
  invocation (`npx browserplex`, `node dist/...`) and the `browserplex` bin name are unchanged.
- README/CHANGELOG updates for the new `bp` CLI are explicitly scoped to **bead .7 (Docs +
  packaging)** per `docs/plans/bp-cli.md`, after the CLI actually exists.

Process docs for this bead live under `docs/plans/process/browserplex-7p0.1-{PLAN,VERIFY,DOCS}.md`
(plans/sketches, not shipped docs).
