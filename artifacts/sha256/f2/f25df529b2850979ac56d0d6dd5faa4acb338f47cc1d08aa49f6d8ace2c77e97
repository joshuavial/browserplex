# Bead browserplex-7p0.4 — VERIFY

## Build & regression
- `npm run build` → clean. New `dist/cli/commands.js`; rewritten `dist/cli/index.js`.
- `npm test` → **71/71 pass** (CLI is not unit-tested directly; committed CLI e2e is bead .6).

## Command-surface script — `/tmp/verify-d4.mjs`, RESULT: PASS (18 checks)
Each `bp` invocation is a separate process. All PASS:
- ✓ `bp --help` lists all grouped commands; `bp screenshot --help` shows `-o/--output`.
- ✓ `session create app -b chromium --headless` (positional name + flags; auto-spawns daemon).
- ✓ `navigate https://example.com -s app` (positional url).
- ✓ `snapshot -s app --interactive` (renders the page).
- ✓ `screenshot -s app -o /tmp/bp-d4-shot.png` → file written + "Saved screenshot to …".
- ✓ `eval -s app 1+1` → `2` (positional); `eval -s app` + stdin `40+2` → `42`.
- ✓ **carried .1 follow-up:** `eval` of an undefined result prints `undefined`; `--json` emits
  `{"ok":true,"text":null,"data":null}` (no bare `undefined`).
- ✓ `fill --field "#q=a=b=c"` splits on the **first** `=` → value `a=b=c` preserved (verified via
  eval; string results are JSON-quoted, matching MCP).
- ✓ `console -s app --json` → structured `{ok,text,data}`.
- ✓ error/exit codes: unknown command → 2; missing required positional → 2; **excess positionals →
  2** (new guard); a failed daemon op → 1.
- ✓ electron flags parse + reach the daemon: `session create … -b electron --executable-path …
  --electron-arg … --env K=V` sends a launch that fails as expected (proves parsing+forwarding).

## PLAN-gate follow-ups — confirmed applied
- All 6 `storage` commands mapped (load: name+domain positionals, `--storage-name`, `-b/--browser`,
  `--headless`). ✓
- `--field`/`--env` split on the **first** `=` (selectors/values may contain `=`). ✓
- `--` end-of-options + leading-dash/negative-number handling: `isFlag` excludes `-`, `-<digit>`, and
  anything after `--`; eval/type text with leading `-` works via `--`. ✓
- `screenshot -o` resolved to an absolute path CLI-side (daemon rejects non-absolute `savePath`). ✓
- Added guard: too many positionals → friendly error (caught a real footgun where extra positionals
  were silently ignored). ✓

## Result
**PASS** — every tool reachable via ergonomic `bp` commands with correct arg mapping; help, screenshot
file output, fill, and eval (arg + stdin) all work; robust parsing + exit codes.
