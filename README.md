<p align="center">
  <img src="assets/banner.png" alt="Wide" width="720">
</p>

<p align="center">
  <a href="https://github.com/sl4de0day/wide/releases/latest">Download</a> ·
  <a href="#building-from-source">Build</a> ·
  <a href="LICENSE">License</a>
</p>

---

**Wide is an IDE that unifies web development and web security in a single ecosystem. It detects vulnerabilities in real time as you code, enabling secure development from line one, while providing built-in tools to execute full-scale, professional web penetration tests. Whether you are a web pentester, bug bounty hunter, or web developer, Wide is the only tool you need.**

Wide is a native Windows application: a C++/WebView2 host, a React renderer, and a Node backend sidecar. No Electron.

## Features

- **Editor.** A fast multi-language code editor built on CodeMirror 6, with structure and symbol navigation, an integrated terminal, source control, and a debugger.
- **Real-time security analysis.** An inspection engine flags likely vulnerabilities as you type — injection, XSS sinks, weak crypto, hardcoded secrets, and cross-file taint flow — each with a fix on hover.
- **Catcher.** A built-in web-security workbench: intercepting proxy, target site map, repeater, intruder, active scanner, OAST collaborator, and sequencer.
- **Pitcher.** A complete API client: collections and environments, Bearer / Basic / API-key / OAuth 2.0 / Digest / AWS SigV4 auth, `pm.*` scripting and tests, a collection runner, and REST, GraphQL, WebSocket, SSE, and gRPC.
- **Pentest browser.** A built-in WebView2 browser wired into Catcher for proxying and inspection.
- **Extensions.** Language servers and security tools installed from a built-in marketplace.

## Installation

Download the latest `Wide-Setup-*.exe` from the [Releases](https://github.com/sl4de0day/wide/releases/latest) page and run it. Wide installs per user, so no administrator rights are required, and it updates itself automatically from GitHub Releases — you never download a new installer by hand.

The [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) is required; the installer provisions it if it is missing.

## Building from source

Requirements:

- Windows (x64)
- Node.js 18 or newer
- Visual Studio 2022 with the "Desktop development with C++" workload
- CMake 3.21 or newer
- Internet access at configure time (the C++ host fetches the WebView2 SDK, WIL, and nlohmann/json)

```
npm run setup
npm run package
```

The packaged application is written to `dist/wide`. To produce the installer, install [Inno Setup](https://jrsoftware.org/isinfo.php) and run:

```
iscc installer/wide.iss
```

## Note

Wide includes a man-in-the-middle proxy and generates a local certificate authority for HTTPS interception. The binaries are not code-signed, so Windows SmartScreen or antivirus software may warn on first run.

## License

Wide is free software licensed under the [GNU General Public License v3](LICENSE).

Copyright (C) 2026 sl4de.
