# Bead browserplex-le1 — VERIFY (full CLI manual test + `bp prime`)

## `bp prime`
- New meta-command (handled before the dispatch table; **no daemon spawned**) printing a 130-line
  AI-agent primer: daemon model, the canonical loop, the **ref workflow + its gotchas** (refs are
  per-snapshot; re-snapshot after page changes; ref numbers differ with `--interactive`), output/
  `--json`, exit codes, handy specifics (screenshot `-o`, eval stdin, fill first-`=`, `--` literal),
  Electron driving, daemon control + env. The "Full command reference" is **generated from the spec
  table** so it can't go stale. Listed in `bp --help`.
- `npm run build` clean; `npm test` **91/91** (clean run; a 1-test blip in an earlier run was
  resource contention from a lingering manual-test daemon, not a regression — confirmed by re-run).

## Full manual test — every command against a real browser (isolated daemon dir, file:// test page)
All PASS unless noted:

**Lifecycle/sessions/storage:** daemon status (cold→warm), `session create` chromium/firefox,
`session list` (+`--json` structured), `session destroy`; `storage list/lock/unlock/save/list/delete`.

**Navigation/read:** `navigate`, `back`, `snapshot` (+`--interactive`, refs @e…), `screenshot -o`
(20 KB PNG written) and inline image info; `wait` (element + load); `console` (+`--clear`),
`network`, `eval` (+`--json` object), `resize`.

**Interaction:** `type` (+`--submit`), `select` by value/label/index, `click` (CSS and ref),
`hover`, `press`, `fill` (multi-field, first-`=` split preserved `g=h@x.com`), `upload` (file count
=1), `dialog accept` (confirm→true), `drag` (`dst`→"dropped"), `tabs` list/new/switch/close.

**Engines:** chromium ✓, firefox ✓, **electron via CLI flags** ✓ (`--executable-path`/`--electron-arg`
→ renderer eval `window.__bpTest`="electron-ok"). `webkit`/`camoufox` error cleanly with a "run
`npx playwright install`" message — missing browser binaries in this env, NOT a bp bug.

**Errors/exit codes:** unknown command → 2; missing required positional → 2 (+usage); extra
positional → 2; bad selector → AI-friendly message, exit 1; `--json` on failure carries `error`;
**stale ref after re-navigate** → clear "not found/timeout" error.

## Findings (no code bugs)
- The only two apparent anomalies during testing were **test-harness artifacts**, verified:
  (1) a `click @e1` that "didn't navigate" — `@e1` was the **heading** in a full snapshot (the link
  was `@e2`); clicking `@e2` navigates correctly. This is the per-snapshot ref gotcha — now
  prominently documented in `bp prime`.
  (2) an exit code read as 0 — captured through a `| head` pipe, not bp's exit.
- `webkit`/`camoufox` require their browser binaries (`npx playwright install`); `bp prime` notes this.

## Result
**PASS** — every `bp` command works against a real browser; `bp prime` gives an agent an accurate,
self-contained guide (with the ref gotcha that caused the one confusing test result called out).

## Review-gate BLOCK (agy + Opus) — fixed
Both seats BLOCKed the primer for an inaccuracy that would fail an agent first-try: it documented
`bp wait --selector "#done"`, but `wait` takes a POSITIONAL selector (only `snapshot` has `--selector`).
Fixed → `bp wait "#done" -s web` (verified it runs verbatim). Also clarified refs are printed
`[ref=e1]` and passed as `@e1`, softened the `-s` "REQUIRED" wording, and made the generated reference
show flag aliases (`-b/--browser`, `-o/--output`) + a note that `-s/--session`/`--json` apply to every
browser command. Re-review: **agy PASS, Opus PASS** — every primer example verified against the real
parser, generated reference matches `bp prime` output verbatim.
