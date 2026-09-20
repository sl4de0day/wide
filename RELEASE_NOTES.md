Wide 1.2 — Multi-directional grid splitting, multi-tab terminal, UI zoom lock, and stability upgrades.

## New Features & Security
- **Grid & Multi-Directional Window Splitting**: Split your workspace horizontally, vertically, or in flexible 2x2 grids (with 1x2, 2x1, 2x2, 1x3, and 3x1 presets). Drag-and-drop tabs seamlessly across panes, maintain independent scrolling per tab, and cycle active panes with `F6` and `Shift+F6`.
- **Multi-Tab Integrated Terminal Architecture**: The built-in terminal now supports multiple simultaneous shell tabs. Switch, split, and manage distinct sessions across PowerShell, Command Prompt, Git Bash, or WSL without interrupting long-running processes.
- **Intelligent Execution Button & Environment**: A contextual Run action automatically detects project entry points and scripts across `package.json`, Python, Rust (`Cargo.toml`), Go, Makefiles, and Dockerfiles, executing them in the terminal with the correct environment configured.
- **Opt-In Crash Reporting & Diagnostic Telemetry**: A privacy-first crash recovery dialog detects fatal backend issues from prior sessions, displays transparent error stack traces, and allows one-click submission only with explicit user approval—zero silent background tracking.

## Key Improvements & Fixes
- **Window Focus & Click-Through Optimization**: Re-engineered Win32 message flow (`WM_MOUSEACTIVATE`, `WM_SETFOCUS`) eliminates dead clicks and focus-stealing lag when switching between the code editor, terminal, DevTools, and embedded browser tabs.
- **UI Zoom Lock & Editor-Only Font Scaling**: Wide no longer zooms its entire shell like a website when pressing `Ctrl + Mouse Wheel`. The IDE frame, sidebars, and panels remain strictly locked, while wheel gestures inside code tabs smoothly scale editor font sizes.
- **Enhanced File Explorer & Context Menu**: Full-featured right-click operations in the explorer tree, including Cut, Copy, Paste, Rename, Delete with confirmation, Reveal in Explorer, and Copy Relative/Absolute Path shortcuts.
- **Comment Cleaner Directive Protection**: The automated comment-stripping engine now preserves vital compiler pragmas and security directives, including `wide-ignore[...]`, `wide-ignore-next-line[...]`, `eslint-disable-line`, and `@ts-ignore`.
- **Extension Marketplace Stability**: Hardened installation state machines eliminate double-click race conditions, provide real-time progress indicators, and ensure immediate UI synchronization upon installing or removing extensions.

## Verify
    certutil -hashfile Wide-Setup-1.220926.exe SHA256

Compare with `SHA256SUMS`.
