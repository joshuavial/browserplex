# browserplex

> **Why this exists:** The standard Playwright MCP server doesn't support multiple concurrent users. When multiple AI agents try to use it simultaneously, they conflict over the single browser instance. Browserplex solves this by providing named sessions, allowing each agent to manage its own isolated browser session.

MCP server for managing multiple named browser sessions. Built on Playwright with support for Chromium, Firefox, WebKit (Safari), Camoufox (stealth Firefox), Electron, and agent-backed Tauri apps.

## Installation

```bash
npm install
npm run build
```

### Dependencies

The required runtime is just `@modelcontextprotocol/sdk`, `playwright`, and `zod`. Everything else is
loaded lazily so the install stays light:

| Dependency | Kind | Enables |
|------------|------|---------|
| `sharp` | optional (installed by default) | Auto-resizing screenshots to fit LLM image limits. Install with `--omit=optional` to skip it; `browser_take_screenshot` then returns the full-size PNG. |
| `camoufox-js` | install on demand (`npm i camoufox-js`) | The `camoufox` (stealth Firefox) session type. |
| (the target app's own Electron) | — | The `electron` session type — pass its binary via `executablePath`. |

WebKit/Firefox/Chromium binaries are fetched with `npx playwright install`.

browserplex ships two front-ends over one shared core:
- an **MCP server** (`browserplex` bin) for MCP hosts, and
- a **`bp` CLI** for shells/scripts (see [CLI (`bp`)](#cli-bp) below).

## Usage (MCP server)

### Via npx

```json
{
  "mcpServers": {
    "browserplex": {
      "type": "stdio",
      "command": "npx",
      "args": ["browserplex"]
    }
  }
}
```

### Local development

```json
{
  "mcpServers": {
    "browserplex": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/browserplex/dist/mcp/server.js"]
    }
  }
}
```

## CLI (`bp`)

The `bp` command drives the same browser sessions from a shell or script. Because a browser session
is a live, in-memory Playwright handle, `bp` is a thin client over a **background daemon** that holds
the sessions: the first `bp` command auto-spawns the daemon (a unix socket at `~/.browserplex/
daemon.sock`), and later commands — even from other terminals or scripts — reuse the same live
sessions. The daemon idle-exits once no sessions/clients remain.

```bash
npm install && npm run build      # or: npm i -g browserplex  (provides the `bp` bin)

bp session create web --browser chromium       # auto-spawns the daemon (headless by default; add --headed for a window)
bp navigate https://example.com -s web          # second process, same live session
bp snapshot -s web --interactive                 # refs (@e1 …) for clicks/types
bp click @e3 -s web
bp screenshot -s web -o shot.png                 # write the PNG to disk
echo 'document.title' | bp eval -s web           # JS from stdin (or: bp eval -s web "1+1")
bp console -s web --json                          # structured output for scripting
bp session destroy web
```

Command groups (run `bp --help`, or `bp <command> --help`, for the full list):
`bp session create|list|destroy`, `bp storage save|load|list|delete|lock|unlock`, and the browser
verbs `navigate back snapshot screenshot click type press hover drag select upload fill dialog wait
eval resize console network download tabs`. Global flags: `-s/--session <name>`, `--json`. Notables:
`screenshot -o <file>`, `fill --field 'sel=value'` (repeatable) or `--fields-json '[…]'`,
`eval` reads JS from the argument or stdin. For `electron` sessions, `bp electron-eval` runs JS in
the Electron **main** process (the script body receives the Electron module as `electron`).

### Daemon control & environment

| Command / env | Description |
|---------------|-------------|
| `bp serve` | Run the daemon in the foreground (logs to the terminal) |
| `bp daemon status` | Show whether the daemon is running, its pid, and active sessions |
| `bp daemon stop` | Stop the running daemon |
| `BROWSERPLEX_IDLE_MS` | Idle-exit grace period in ms (default `300000`; `0` disables idle-exit) |
| `BROWSERPLEX_DIR` | Relocate the runtime dir — daemon socket/pid/log + stored sessions (default `~/.browserplex`) |

## Browser Types

| Type | Engine | Use Case |
|------|--------|----------|
| `chromium` | Chrome/Edge | Default, fast, good DevTools |
| `firefox` | Firefox | Standard Firefox browser |
| `webkit` | Safari | Test Safari rendering, iOS compatibility |
| `camoufox` | Firefox | Stealth browsing, anti-detection |
| `electron` | Electron | Drive an Electron desktop app (renderer + preload bridge) |
| `tauri` | Tauri WKWebView | Drive a trusted debug/test Tauri app through its injected automation agent |

### Driving Electron apps

`session_create type="electron"` launches an Electron application via Playwright and attaches to its
first window — which is an ordinary Playwright `Page`, so every action (`browser_snapshot`,
`browser_click`, `browser_evaluate`, `browser_take_screenshot`, console/network, …) works unchanged.
Because `browser_evaluate` runs **in the renderer**, the app's preload bridge is live — you can drive
and assert the full app, not just the static shell.

```
session_create name="app" type="electron" \
  executablePath="/path/to/your-app/node_modules/.bin/electron" \
  electronArgs=["/path/to/your-app"] cwd="/path/to/your-app" env={"MY_TEST_MODE":"1"}
browser_evaluate session="app" script="window.myPreloadBridge !== undefined"
```

Electron-only `session_create` params:

| Param | Description |
|-------|-------------|
| `executablePath` | **Path to the Electron binary to launch** — this selects *which* Electron runs. Point it at your app's `node_modules/.bin/electron`. If omitted, Playwright falls back to `require('electron')` resolved from browserplex's own install (a dev-only dependency), so set this when driving your own app. |
| `electronArgs` | Args passed to the Electron launch (default `["."]`) — typically the target app path |
| `cwd` | Spawn working directory (does **not** select the Electron binary — that's `executablePath`) |
| `env` | Extra environment for the launched app (e.g. enabling a test-mode hook) |

> **Electron binary:** browserplex does not ship Electron as a runtime dependency (it's a
> devDependency used only for browserplex's own tests). To drive your app, set `executablePath` to
> that app's Electron binary so the launched runtime matches the app's Electron version.

Caveats:
- Not headless — a real window opens. On Linux CI, run under a virtual display (xvfb). The `headless`
  flag is ignored for `electron`.
- Native OS file dialogs can't be driven by Playwright; apps should expose test hooks (use `env`).
- `browser_navigate` is a no-op (the app loads its own URL); stored storage state does not apply;
  `browser_tabs` maps to the app's windows.

### Driving Tauri apps

`session_create type="tauri"` launches a trusted debug/test Tauri app and waits for the app's
automation agent to connect back to Browserplex over `TAURI_AUTOMATION_WS`. Browserplex sets
`TAURI_AUTOMATION=1` for the launched process. Release builds should not contain the agent.

No API keys are required or used for the Browserplex Tauri automation path.

CLI example against Xenota Concierge:

```bash
bp session create concierge \
  --browser tauri \
  --command pnpm \
  --arg tauri \
  --arg dev \
  --cwd /Users/jv/projects/xenota/.worktrees/epic-tauri-automation/xenon/concierge \
  --window-title "Xenota Concierge" \
  --window-owner xenota-concierge

bp wait "input[placeholder='morning-helper']" --session concierge
bp screenshot --session concierge --output /tmp/concierge.png
bp session destroy concierge
```

MCP `session_create` accepts the same launch shape: `type="tauri"`, `command`, `args`, `appPath`,
`cwd`, `env`, `windowTitle`, `windowOwner`, and `startupTimeoutMs`.

See [`docs/tauri.md`](docs/tauri.md) for the full command set and caveats. In brief:

- Tauri sessions are agent-backed, not Playwright WebKit sessions.
- `browser_snapshot` is text-only for Tauri and does not produce ARIA refs; use CSS selectors.
- `browser_evaluate`/`bp eval` runs arbitrary renderer JavaScript; use only with trusted debug/test apps.
- Screenshots render from inside the trusted webview first, avoiding macOS WKWebView black-window OS captures.

## Tools

### Session Management

| Tool | Description |
|------|-------------|
| `session_create` | Create a named browser session |
| `session_list` | List all active sessions |
| `session_destroy` | Close and cleanup a session |

### Navigation

| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_navigate_back` | Go back in browser history |
| `browser_snapshot` | Accessibility tree snapshot with element refs (@e1, @e2) for reliable clicks/types |
| `browser_take_screenshot` | Capture screenshot (auto-resized for LLM context; optional `savePath` writes the un-resized PNG to disk) |

### Interaction

| Tool | Description |
|------|-------------|
| `browser_click` | Click an element (CSS selector) |
| `browser_type` | Type text into an input field |
| `browser_press_key` | Press a keyboard key |
| `browser_hover` | Hover over an element |
| `browser_drag` | Drag and drop elements |
| `browser_select_option` | Select dropdown option by value, label, or index |
| `browser_file_upload` | Upload files to a file input |
| `browser_fill_form` | Fill multiple form fields at once |
| `browser_handle_dialog` | Handle JS dialogs (alert, confirm, prompt) |

### Utilities

| Tool | Description |
|------|-------------|
| `browser_wait_for` | Wait for element or page load |
| `browser_evaluate` | Execute JavaScript in page context |
| `browser_resize` | Resize browser viewport |
| `browser_console_messages` | Get console log messages |
| `browser_network_requests` | Get network requests |
| `browser_downloads` | List downloads captured by the session |
| `browser_save_download` | Save a captured download to an absolute path |
| `browser_tabs` | List, create, switch, or close tabs |

## Example Usage

```
# Create a headed WebKit (Safari) session (sessions are headless by default; opt in with headed=true)
session_create name="safari" type="webkit" headed=true

# Navigate to a page
browser_navigate session="safari" url="https://example.com"

# Get page content
browser_snapshot session="safari"

# Take a screenshot
browser_take_screenshot session="safari"

# Fill a form
browser_fill_form session="safari" fields=[{selector: "#email", value: "test@example.com"}, {selector: "#password", value: "secret"}]

# Click a button
browser_click session="safari" selector="button.submit"

# Check console for errors
browser_console_messages session="safari"

# Clean up
session_destroy name="safari"
```

## Features

- **Multiple concurrent sessions** - Run different browsers side-by-side
- **Named sessions** - Reference sessions by name across tool calls
- **Auto-resize screenshots** - Images automatically sized for LLM context limits
- **Structured snapshots** - Page content with semantic markup (headings, links, buttons)
- **Console/network capture** - Debug with captured console messages and network requests
- **Download capture** - Track downloads and save them with `bp download save`
- **Tab management** - Work with multiple tabs per session
- **Graceful cleanup** - Sessions automatically closed on server shutdown

## Development

```bash
npm run build      # Compile TypeScript
npm test           # Run tests
npm run test:watch # Watch mode
```

## License

MIT
