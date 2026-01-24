# browserplex

MCP server for managing multiple named browser sessions. Built on Playwright with support for Chromium, WebKit (Safari), and Camoufox (stealth Firefox).

## Installation

```bash
npm install
npm run build
```

## Claude Code Configuration

Add to your Claude settings (`~/.claude/.claude.json` or project settings):

```json
{
  "mcpServers": {
    "browserplex": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/browserplex/dist/index.js"]
    }
  }
}
```

## Browser Types

| Type | Engine | Use Case |
|------|--------|----------|
| `chromium` | Chrome/Edge | Default, fast, good DevTools |
| `firefox` | Firefox | Standard Firefox browser |
| `webkit` | Safari | Test Safari rendering, iOS compatibility |
| `camoufox` | Firefox | Stealth browsing, anti-detection |

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
| `browser_snapshot` | Get page title, URL, and visible text content |
| `browser_take_screenshot` | Capture screenshot (auto-resized for LLM context) |

### Interaction

| Tool | Description |
|------|-------------|
| `browser_click` | Click an element (CSS selector) |
| `browser_type` | Type text into an input field |
| `browser_press_key` | Press a keyboard key |
| `browser_hover` | Hover over an element |

### Utilities

| Tool | Description |
|------|-------------|
| `browser_wait_for` | Wait for element or page load |
| `browser_evaluate` | Execute JavaScript in page context |

## Example Usage

```
# Create a headed WebKit (Safari) session
session_create name="safari" type="webkit" headless=false

# Navigate to a page
browser_navigate session="safari" url="https://example.com"

# Get page content
browser_snapshot session="safari"

# Take a screenshot
browser_take_screenshot session="safari"

# Click a button
browser_click session="safari" selector="button.submit"

# Clean up
session_destroy name="safari"
```

## Features

- **Multiple concurrent sessions** - Run different browsers side-by-side
- **Named sessions** - Reference sessions by name across tool calls
- **Auto-resize screenshots** - Images automatically sized for LLM context limits
- **Structured snapshots** - Page content with semantic markup (headings, links, buttons)
- **Graceful cleanup** - Sessions automatically closed on server shutdown

## Development

```bash
npm run build      # Compile TypeScript
npm test           # Run tests
npm run test:watch # Watch mode
```
