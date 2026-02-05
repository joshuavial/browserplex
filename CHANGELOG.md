# Changelog

## [0.2.0] - 2026-02-05

### Added
- ARIA snapshot with refs for 10x token reduction in browser automation
- Named session storage for cross-instance cookie/auth sharing
- All Playwright MCP tools (click, type, navigate, screenshot, etc.)
- Firefox browser type

### Fixed
- Sanitize domain filter in list() to match storage paths
- Sanitize domain/name inputs to prevent path traversal

## [0.1.0] - 2026-01-31

Initial release.

### Added
- Browser Broker MCP server for multi-session browser management
- WebKit (Safari engine) browser type
- Headless parameter for session creation
- Screenshot auto-resize for LLM image limits
- Unit and integration tests with vitest

### Fixed
- Zod defaults not applying via MCP SDK

### Changed
- Switch from camoufox to camoufox-js for ESM compatibility
