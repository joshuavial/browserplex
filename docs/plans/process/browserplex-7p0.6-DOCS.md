# Bead browserplex-7p0.6 — DOCS

**No shipped user-facing docs change in this bead.** Rationale:
- Adds committed tests (no behavior change for users). The one new user-facing knob, the
  `BROWSERPLEX_DIR` env override (relocate the runtime dir: socket/pid/log + stored sessions), is
  documented alongside the rest of the CLI/daemon docs in bead **.7** — noted on .7.
- MCP server surface unchanged.

Test design recorded in `docs/plans/process/browserplex-7p0.6-PLAN.md`.
