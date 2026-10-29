Wide 1.3291026 — Status bar proxy chip, auto theme tracking, quick scratchpad, inline encode/decode, copy as cURL/fetch/Python, JWT inspector tooltip, recent projects overlay, security vulnerability badges, and streamer mode.

## New Features

- **Status Bar Proxy Chip**: A compact live indicator in the bottom status bar shows the active Catcher proxy port and intercept state at a glance. Click to toggle intercept on or off without opening the proxy panel.
- **Auto System Theme Tracking**: Wide now follows your operating system's light/dark mode preference automatically. The IDE switches themes in real time when the system appearance changes, with the option to pin a fixed theme from Settings.
- **Quick Scratchpad (`wide://scratchpad`)**: A persistent multi-tab scratch space for notes, payloads, and throwaway code. Each tab supports the full CodeMirror editor with syntax highlighting and is saved automatically between sessions.
- **Inline Encode / Decode & Transform Modal**: Select any text in the editor or a request field and press `Ctrl+Shift+T` to open the Transform Modal. Instantly apply Base64, URL encoding, hex, JWT decode, SHA hashing, HTML entity encoding, and more without leaving context.
- **Copy as cURL / Fetch / Python Requests**: Right-click any intercepted request in Catcher, Pitcher, or the Repeater to copy a fully reconstructed shell command or code snippet—ready to paste into a terminal or script.
- **JWT Quick Inspector (CodeMirror Hover Tooltip)**: Hover over any JWT string in the code editor to see a decoded header and payload popup with expiry status, algorithm label, and a one-click copy button for each part.
- **Recent Projects Quick Menu (`Ctrl+R`)**: Press `Ctrl+R` from anywhere in the IDE to open a fuzzy-searchable overlay of recently opened folders and workspaces. Press `Enter` to switch immediately.
- **FileTree Security Vulnerability Badges**: Files with active security findings from the SSSF engine are marked with colored severity badges directly in the file explorer tree, making high-risk files visible without running a manual scan.
- **Streamer / Presentation Mode (`Ctrl+Alt+S`)**: Toggle a privacy mask that automatically redacts sensitive data—API keys, tokens, Bearer headers, AWS credentials, and JWTs—throughout the editor in real time. A persistent indicator in the status bar confirms the mode is active.

## Linux Packaging

Packages are provided for all major Linux distributions:

| Format | File |
|--------|------|
| AppImage | `Wide-1.3291026-x86_64.AppImage` |
| Debian / Ubuntu | `wide-ide_1.3291026_amd64.deb` |
| Fedora / RHEL | `wide-ide-1.3291026-1.x86_64.rpm` |
| Arch Linux | `wide-ide-1.3291026-1-x86_64.pkg.tar.zst` |
| Portable (tar.gz) | `wide-1.3291026-linux-x64.tar.gz` |
| Portable (tar.zst) | `wide-1.3291026-linux-x64.tar.zst` |

## Installation

**AppImage**
```bash
chmod +x Wide-1.3291026-x86_64.AppImage
./Wide-1.3291026-x86_64.AppImage
```

**Debian / Ubuntu**
```bash
sudo dpkg -i wide-ide_1.3291026_amd64.deb
```

**Fedora / RHEL**
```bash
sudo rpm -i wide-ide-1.3291026-1.x86_64.rpm
```

**Arch Linux**
```bash
sudo pacman -U wide-ide-1.3291026-1-x86_64.pkg.tar.zst
```

**Portable**
```bash
tar -xzf wide-1.3291026-linux-x64.tar.gz
cd wide-linux-x64
./wide-launcher.sh
```

## Verify

```
sha256sum -c SHA256SUMS
```

| File | SHA256 |
|------|--------|
| `Wide-1.3291026-x86_64.AppImage` | `d19269e4fcc49f727cace8d8d2bbe2267635f002cbd48f9f0eddcc620fd93ae5` |
| `wide-ide_1.3291026_amd64.deb` | `46ad612fa2af4b6f6e34bc4d8f2fcfe9318de03e6ae51c104f1dcdb533adc403` |
| `wide-ide-1.3291026-1.x86_64.rpm` | `2bfdc060bf43d758d43b973efc4950f2307f28b0076bcfe51cf43506d14637d6` |
| `wide-ide-1.3291026-1-x86_64.pkg.tar.zst` | `6b2ebf32b3b728d4ea13b3afcd0dbbe6039fe4a5021c2064725094c3b39cb930` |
| `wide-1.3291026-linux-x64.tar.gz` | `f641c0fd38d48a56deaaebaf944be8dd0a4a073a815885c77b1f3c88a1e524a6` |
| `wide-1.3291026-linux-x64.tar.zst` | `4bc0f19e1053ae9c7fbd3d5a79bdf5da8fe9e383fcb862059b812d03a03a0652` |
