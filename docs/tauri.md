# Tauri Sessions

Browserplex can launch and drive Tauri apps that embed the Xenota Concierge automation agent protocol.

This is not Playwright WebKit control. A `tauri` session is agent-backed:

- Browserplex starts a loopback WebSocket controller.
- Browserplex launches the app with `TAURI_AUTOMATION=1` and `TAURI_AUTOMATION_WS=ws://127.0.0.1:<port>/automation`.
- The app's debug/test build injects an in-webview agent.
- Browserplex waits for hello protocol `xenota.concierge.automation.v0`.
- Browserplex routes supported actions over the agent protocol.

The WebSocket controller is implemented with Node `net`/`crypto` primitives instead of a `ws` dependency so Browserplex does not add a new runtime package for the small server-side frame subset it needs. This is deliberately scoped to the Concierge automation protocol and is not a general WebSocket implementation.

## Launch

Run a dev command:

```bash
bp session create concierge \
  --browser tauri \
  --command pnpm \
  --arg tauri \
  --arg dev \
  --cwd /path/to/xenon/concierge \
  --window-title "Xenota Concierge" \
  --window-owner xenota-concierge
```

Run a debug binary:

```bash
bp session create concierge \
  --browser tauri \
  --app-path /path/to/xenon/concierge/src-tauri/target/debug/xenota-concierge \
  --cwd /path/to/xenon/concierge \
  --window-title "Xenota Concierge" \
  --window-owner xenota-concierge
```

Extra app environment can be passed with repeatable `--env KEY=VALUE`.

## Supported Actions

Supported for `tauri` sessions:

- `bp wait <selector>`
- `bp click <selector>`
- `bp type <selector> <text>`
- `bp eval <expression>`
- `bp snapshot`
- `bp screenshot --output /absolute/path.png`
- `bp session destroy <name>`

Unsupported Playwright-only actions return explicit errors for `tauri` sessions.

`bp snapshot` is a text/DOM summary in this version. It does not produce ARIA refs such as `@e1`, so follow-up `click` and `type` calls must use CSS selectors.

`bp click` and `bp type` auto-wait for the selector (up to `--timeout`, default 5s) before acting, so you do not need a separate `bp wait` when a control mounts asynchronously (e.g. a modal opening). The click is dispatched synchronously, so once the command returns the click has fired. The automation agent also reconnects if its controller socket drops, so a transient disconnect does not leave the session permanently stale.

## Screenshots

Tauri screenshots render from inside the trusted webview first. Browserplex injects its locally
bundled `html2canvas` browser build through the automation agent, renders the current viewport to a
canvas, receives a PNG data URL, and writes that PNG when `--output`/`savePath` is set.

This path avoids macOS WKWebView black-window captures from `screencapture`. If canvas export is not
available in the webview, Browserplex falls back to the Concierge debug automation command that uses
native `WKWebView.takeSnapshot` and returns a PNG over the same trusted loopback channel.

## Eval Safety

`bp eval` maps to the agent protocol's `eval` command and runs arbitrary JavaScript in the Tauri renderer. Use it only with trusted debug/test apps. The Concierge hook is debug-build, env-gated, and loopback-only; release Concierge builds do not contain the automation agent.
