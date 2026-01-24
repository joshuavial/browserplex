# browserplex

MCP server for managing multiple named browser sessions. Built on Playwright with support for Chromium, Firefox, WebKit (Safari), and Camoufox (stealth Firefox).

## Installation

```bash
npm install
npm run build
```

## Usage

### Via npx (after publishing)

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
| `browser_navigate_back` | Go back in browser history |
| `browser_snapshot` | Get page title, URL, and visible text content |
| `browser_take_screenshot` | Capture screenshot (auto-resized for LLM context) |

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
| `browser_tabs` | List, create, switch, or close tabs |

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
