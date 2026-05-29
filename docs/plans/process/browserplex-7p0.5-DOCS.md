# Bead browserplex-7p0.5 — DOCS

**No shipped user-facing docs change in this bead.** Rationale:
- `bp serve` / `bp daemon status` / `bp daemon stop` are now in `bp --help`, but the README CLI
  section + installable `bp` bin are owned by bead **.7 (Docs + packaging)**. Documenting the
  lifecycle commands there (alongside install + the rest of the CLI) keeps the user-facing docs
  coherent rather than piecemeal.
- Idle-exit / stale-recovery are internal behaviors; the env knob `BROWSERPLEX_IDLE_MS` will be
  documented with the CLI in .7.
- The MCP server surface is unchanged.

Design recorded in `docs/plans/process/browserplex-7p0.5-PLAN.md`.
