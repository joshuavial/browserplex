# Bead browserplex-7p0.4 — PLAN

**Title:** Full bp command surface (28 tools)
**Gate level:** 1 (low-risk, easily-reversible CLI frontend over the existing daemon/actions; no
architecture/persistence; fully testable). agy + Opus seats.

## Acceptance (from bead)
Every tool is reachable from `bp` with correct arg mapping; help lists all commands; `screenshot`
writes a PNG; `fill` and `eval` parse their inputs.

## Objective
Replace bead .3's generic `bp <tool> --flag value` plumbing with an **ergonomic, per-command**
surface (grouped subcommands, positional args, typed flags, special cases), still talking to the
daemon via the existing `DaemonClient`. Also expose the `electron` `session_create` params added in
`browserplex-2mv`, and resolve the carried `evaluate`-undefined follow-up.

## Design — a declarative command table
`src/cli/commands.ts`: one `CommandSpec` per tool, consumed by a small hand-rolled parser (no new
deps — consistent with the project). A spec declares:
```ts
interface CommandSpec {
  path: string[];          // e.g. ['session','create'] or ['navigate']
  tool: string;            // dispatch tool name
  positionals?: { key: string; required?: boolean }[];  // ordered -> args[key]
  flags?: Record<string, { key?: string; type: 'string'|'number'|'boolean'|'string[]'|'keyval[]'; alias?: string; desc: string }>;
  summary: string;
}
```
- Tool names map to friendlier commands: `session create|list|destroy`, `storage save|load|list|
  delete|lock|unlock`, and the `browser_*` verbs drop the prefix: `navigate, back, snapshot,
  screenshot, click, type, press, hover, drag, select, upload, fill, dialog, wait, eval, resize,
  console, network, tabs`.
- Global flags (all commands): `-s/--session <name>` → `args.session`; `--json`; `-h/--help`.
- Parser: match the longest `path` prefix in argv; remaining tokens fill positionals in order; `--k v`
  / `-alias v` fill flags by `type` (`boolean` = bare; `string[]`/`keyval[]` = repeatable); unknown
  flag or missing required positional → friendly per-command usage + exit 2.

## Per-command specifics
- **`session create <name>`**: `-b/--browser` → `type` (chromium|firefox|webkit|camoufox|electron);
  `--headless` (bool); electron-only: `--executable-path`, `--electron-arg <a>` (repeatable →
  `electronArgs`), `--cwd`, `--env k=v` (repeatable → `env` object).
- **`navigate <url>`**, **`back`**, **`press <key>`**, **`resize <width> <height>`** (numbers).
- **`snapshot`**: `--interactive`, `--compact`, `--max-depth <n>`, `--selector <css>`.
- **`screenshot`**: `-o/--output <file>` → `savePath` (daemon writes the PNG locally); `--full-page`;
  `--max-dimension <n>`. Default (no `-o`) prints image byte info; with `-o` prints "Saved to <path>".
- **`click|hover <selector>`**, **`drag <source> <target>`**, **`type <selector> <text>` `--submit`**,
  all with `--timeout <ms>`.
- **`select <selector>`**: `--value|--label|--index`. **`upload <selector>`**: `--file <p>` (repeatable
  → `files`). **`fill`**: `--field selector=value` (repeatable → `fields:[{selector,value}]`) or
  `--fields-json '[...]'`. **`dialog <accept|dismiss>`**: `--prompt-text`.
- **`wait`**: optional `<selector>` positional; `--state`, `--timeout`. **`eval [script]`**: script
  from the positional OR stdin when omitted/`-`. **`console|network`**: `--clear`. **`tabs [action]`**:
  positional list|new|switch|close; `--index`, `--url`.

## Output rendering (shared)
- `--json` → print `JSON.stringify({ok,text,data,imageBase64?,mimeType?})` (omit internal `id`).
- else: `ok:false` → `Error: <error>` on stderr, exit 1; image (no `-o`) → byte/mime info; otherwise
  print `text`, falling back to pretty `data` when `text` is empty.
- **Carried follow-up (.1):** `eval` of an `undefined` result yields `text === undefined`. Handle it:
  human mode prints `undefined`; `--json` emits `{"ok":true,"text":null,"data":null}` (not a literal
  `undefined` token / missing key surprise). Centralize in the renderer so every command is safe.

## Files
- New `src/cli/commands.ts` (spec table + parser + renderer + help).
- Rewrite `src/cli/index.ts` to dispatch via the table (keep `DaemonClient` usage + exit-code
  semantics from .3); keep validating against `TOOL_NAMES`.

## Out of scope
`bp` bin entry + packaging (.7); lifecycle commands `serve|status|stop` (.5). Array/object flags over
the wire already work (daemon takes JSON args); this bead builds them CLI-side.

## Verification
- `npm run build` clean; existing 71 tests green.
- Script (in /tmp, separate `bp` processes): `session create app -b chromium --headless` → `navigate
  app https://example.com` (positional) → `snapshot app --interactive` → `screenshot app -o
  /tmp/bp.png` (assert file exists + "Saved") → `eval app "1+1"` (=2) and `eval app` with stdin →
  `fill`/`select`/`tabs`/`console --json` → `session destroy app`. Assert arg mapping + exit codes.
- `bp --help` lists all commands grouped; `bp eval app "(function(){})()"` (undefined result) prints
  cleanly and `--json` emits `text:null` (the carried follow-up).
- Spot-check `session create app -b electron --executable-path X --electron-arg Y --env K=V` builds
  the right request (electron launch not required to validate parsing).
