# Changelog

All notable changes to **JS Live Preview** will be documented in this file.

## [1.0.2] - 2026-08-13

### Added
- 🌐 **External Browser Mode & Hot Reloading**: Standalone browser window support with Server-Sent Events (SSE) live reload.
- 🖥️ **Browser Console Synchronization**: Native DevTools `F12` console logging mirrored alongside VS Code console.
- ⌨️ **REPL Command History**: Up/Down Arrow key navigation in the console evaluator.
- 🛡️ **Path Resolution & Security**: Safe resolution for nested asset relative paths.

## [1.0.0] - 2026-08-13

### Added
- ⚡ **Side-by-Side Live Preview**: Instant HTML, CSS, and JS preview inside VS Code.
- 🖥️ **DevTools Console**: Intercepts `console.log`, `info`, `warn`, `error`, `dir`, and `table` with millisecond timestamps and auto-scroll.
- 📱 **Device Viewports**: Quick toggles for Desktop (100%), Tablet (768px), and Mobile (375px).
- ↔️ **Resizable Panel**: Drag-to-resize divider bar between preview and console.
- ⌨️ **Keyboard Shortcuts**: `Ctrl+Shift+Z` and `Ctrl+Shift+J` support.
- 🌐 **External Fetch Support**: Enable async network calls to external HTTPS APIs.
