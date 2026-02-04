# Changelog

## [0.1.0] - 2026-02-04

### Added
- ARIA snapshot with refs for 10x token reduction in browser automation
- Named session storage for cross-instance cookie/auth sharing
- All Playwright MCP tools (click, type, navigate, screenshot, etc.)
- Firefox and WebKit (Safari engine) browser types
- Headless parameter for session creation
- Screenshot auto-resize for LLM image limits
- Unit and integration tests with vitest

### Fixed
- Sanitize domain filter in list() to match storage paths
- Sanitize domain/name inputs to prevent path traversal
- Zod defaults not applying via MCP SDK

### Changed
- Switch from camoufox to camoufox-js for ESM compatibility
