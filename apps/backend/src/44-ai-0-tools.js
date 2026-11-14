const AI_MAX_TOOL_ROUNDS = 30;
const AI_MAX_TOOL_RESULT_BYTES = 100 * 1024;

const AI_TOOLS = [
  {
    name: "read_file",
    category: "workspace",
    description:
      "Read a file from the project workspace. Returns numbered lines so edits can reference exact text. Always read before editing.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root." },
        startLine: { type: "number", description: "Optional 1-based start line." },
        endLine: { type: "number", description: "Optional 1-based inclusive end line." },
      },
      required: ["path"],
    },
  },
  {
    name: "list_dir",
    category: "workspace",
    description:
      "List files and folders inside a workspace directory. Directories end with '/'.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Directory relative to the project root. Empty means the root itself.",
        },
      },
      required: [],
    },
  },
  {
    name: "search",
    category: "workspace",
    description:
      "Search the whole project for a string or regular expression. Returns matching files with line numbers and matching lines.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regular expression to find." },
        regex: { type: "boolean", description: "Treat the query as a regular expression." },
        caseSensitive: { type: "boolean" },
      },
      required: ["query"],
    },
  },
  {
    name: "find_relevant",
    category: "workspace",
    description:
      "Find the files most relevant to a description or set of terms, ranked across the whole project, each with a short snippet.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you are looking for, in words." },
      },
      required: ["query"],
    },
  },
  {
    name: "open_file",
    category: "workspace",
    description:
      "Open a file in the Wide editor so the user can view it. Does not return the file contents; use read_file to read contents.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root." },
        line: { type: "number", description: "Line to scroll to, 1-based." },
      },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    category: "workspace",
    description:
      "Create a new file or replace an existing file's entire contents directly in the project workspace on disk.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root (e.g. 'script.py' or 'src/utils.ts')." },
        content: { type: "string", description: "The complete contents to write to the file." },
      },
      required: ["path", "content"],
    },
  },
  {
    name: "edit_file",
    category: "workspace",
    description:
      "Make a targeted change to an existing file in the project workspace by replacing an exact snippet (find) with new text (replace). Read the file first.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the project root." },
        find: { type: "string", description: "Exact text in the file to replace." },
        replace: { type: "string", description: "Replacement text." },
      },
      required: ["path", "find", "replace"],
    },
  },
  {
    name: "create_dir",
    category: "workspace",
    description: "Create a new directory (and any parent directories) in the project workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path relative to the project root." },
      },
      required: ["path"],
    },
  },
  {
    name: "delete_file",
    category: "workspace",
    description: "Delete a file from the project workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the project root." },
      },
      required: ["path"],
    },
  },
  {
    name: "run_command",
    category: "workspace",
    description:
      "Run a shell command in the project root and return its combined output and exit code.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command line to run, e.g. 'npm test' or 'python script.py'." },
      },
      required: ["command"],
    },
  },
  {
    name: "git",
    category: "workspace",
    description:
      "Run a git command in the project and return its output. Allowed: status, diff, log, show, branch, rev-parse, remote, add, commit.",
    parameters: {
      type: "object",
      properties: {
        args: {
          type: "array",
          items: { type: "string" },
          description: 'git arguments as an array, e.g. ["status"] or ["diff"].',
        },
      },
      required: ["args"],
    },
  },
  {
    name: "transform_data",
    category: "security",
    description:
      "Transform, encode, decode, hash, or format data using Wide Decoder engine. Operations: base64_encode, base64_decode, hex_encode, hex_decode, url_encode, url_decode, jwt_decode, md5, sha1, sha256, sha512, rot13, gzip_compress, gzip_decompress, json_format.",
    parameters: {
      type: "object",
      properties: {
        operation: { type: "string", description: "Transformation operation name." },
        input: { type: "string", description: "Input text or data to transform." },
      },
      required: ["operation", "input"],
    },
  },
  {
    name: "open_tool_tab",
    category: "ui",
    description:
      "Open a built-in Wide tool panel/tab in the UI: pitcher, catcher, scanner, repeater, intruder, proxy, cyberchef, decoder, terminal, problems, findings, browser, explorer, search, git, tests, settings.",
    parameters: {
      type: "object",
      properties: {
        tab: { type: "string", description: "Target tool or panel name." },
        subtool: { type: "string", description: "Optional subtool for Catcher workbench." },
      },
      required: ["tab"],
    },
  },
  {
    name: "get_diagnostics",
    category: "workspace",
    description:
      "Inspect TypeScript compile errors and linter diagnostics for a specific file or the entire project.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional file path relative to project root." },
      },
      required: [],
    },
  },
  {
    name: "send_http_request",
    category: "security",
    description:
      "Send an HTTP or HTTPS request directly using Wide HTTP engine and inspect status, headers, timing, and body.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target HTTP or HTTPS URL." },
        method: { type: "string", description: "HTTP method, defaults to GET." },
        headers: { type: "object", description: "Optional key-value request headers." },
        body: { type: "string", description: "Optional request body." },
        insecure: { type: "boolean", description: "Allow invalid SSL certificates. Defaults to true." },
      },
      required: ["url"],
    },
  },
  {
    name: "run_security_scan",
    category: "security",
    description:
      "Run Wide security AST and taint analysis scanner on the project workspace or a specific file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Optional file path relative to project root." },
        minSeverity: { type: "string", description: "Minimum severity: info, warning, or error." },
      },
      required: [],
    },
  },
  {
    name: "check_dependencies",
    category: "security",
    description:
      "Audit project dependencies for known CVEs using Wide OSV advisory engine.",
    parameters: {
      type: "object",
      properties: {
        manifest: { type: "string", description: "Optional manifest file path." },
      },
      required: [],
    },
  },
  {
    name: "get_open_tabs",
    category: "ui",
    description:
      "Get the list of currently open tabs and active view in Wide.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "manage_catcher",
    category: "catcher",
    description:
      "Control Wide Catcher intercepting proxy: status, start, stop, get_traffic, set_intercept, set_response_intercept, set_scope, clear, ca_status, ca_trust.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "start", "stop", "get_traffic", "set_intercept", "set_response_intercept", "set_scope", "clear", "ca_status", "ca_trust"],
          description: "Catcher action to perform.",
        },
        intercept: { type: "boolean", description: "Whether to intercept requests or responses." },
        scope: { type: "array", items: { type: "string" }, description: "Host/URL scope patterns for Catcher." },
        limit: { type: "number", description: "Maximum number of traffic items to return (default 20)." },
      },
      required: ["action"],
    },
  },
  {
    name: "catcher_control",
    category: "catcher",
    description:
      "Full Catcher MITM proxy lifecycle & settings control: start/stop proxy on 127.0.0.1, toggle request/response interception, set host scope filter, clear captured history, or manage MITM CA trust.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "start", "stop", "set_intercept", "set_scope", "clear", "ca_status", "ca_trust", "ca_untrust"],
          description: "Control action to execute.",
        },
        intercept: { type: "boolean", description: "Enable/disable request interception." },
        interceptResponses: { type: "boolean", description: "Enable/disable response interception." },
        scope: { type: "array", items: { type: "string" }, description: "Array of host/substring scope patterns." },
      },
      required: ["action"],
    },
  },
  {
    name: "catcher_traffic_query",
    category: "catcher",
    description:
      "Query, filter, and inspect HTTP/HTTPS traffic captured by Catcher proxy, or fetch full headers and body for a specific request ID.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Specific proxy entry ID to inspect in full detail." },
        method: { type: "string", description: "Filter by HTTP method (GET, POST, etc.)." },
        host: { type: "string", description: "Filter by host substring." },
        statusMin: { type: "number", description: "Minimum HTTP response status code." },
        statusMax: { type: "number", description: "Maximum HTTP response status code." },
        search: { type: "string", description: "Substring search in URL, headers, or body." },
        limit: { type: "number", description: "Max entries returned (default 20, max 100)." },
        includeBodies: { type: "boolean", description: "Include truncated request/response bodies in summary." },
      },
      required: [],
    },
  },
  {
    name: "catcher_intercept_decide",
    category: "catcher",
    description:
      "List pending intercepted requests/responses held by Catcher, or forward, edit-and-forward, or drop held items.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "forward", "drop", "forward_all", "drop_all"],
          description: "Intercept queue decision.",
        },
        kind: {
          type: "string",
          enum: ["request", "response"],
          description: "Whether deciding a held request or response.",
        },
        id: { type: "number", description: "Pending intercept item ID for forward/drop." },
        edited: {
          type: "object",
          description: "Optional modified fields: method, path, status, headers, body.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "catcher_match_replace",
    category: "catcher",
    description:
      "Manage Catcher automatic Match & Replace traffic rewrite rules.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "set", "add", "clear"],
          description: "Rule action.",
        },
        rules: {
          type: "array",
          items: { type: "object" },
          description: "Rules with { id?, enabled, target: 'req-header'|'req-body'|'res-header'|'res-body', match, replace, regex? }.",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "catcher_send_to_repeater",
    category: "catcher",
    description:
      "Push a captured Catcher entry (by id) or an explicit HTTP request directly into Wide Repeater UI tab.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Optional captured Catcher traffic ID to clone." },
        method: { type: "string", description: "HTTP method if not cloning by id." },
        url: { type: "string", description: "Target URL if not cloning by id." },
        headers: { type: "object", description: "Optional request headers." },
        body: { type: "string", description: "Optional request body." },
        openUi: { type: "boolean", description: "Open Repeater workbench UI. Defaults to true." },
      },
      required: [],
    },
  },
  {
    name: "repeater_send",
    category: "catcher",
    description:
      "Execute a Repeater request (HTTP/1.1 or HTTP/2, optional session macro) and optionally mirror it to Catcher Repeater UI.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target URL." },
        method: { type: "string", description: "HTTP method, defaults to GET." },
        headers: { type: "object", description: "Request headers." },
        body: { type: "string", description: "Request body." },
        http2: { type: "boolean", description: "Use HTTP/2." },
        followRedirects: { type: "boolean", description: "Follow HTTP redirects." },
        useSessionMacro: { type: "boolean", description: "Apply configured Catcher session cookie/macro." },
        insecure: { type: "boolean", description: "Allow invalid TLS certificates. Defaults to true." },
        openUi: { type: "boolean", description: "Open request in Catcher Repeater UI." },
      },
      required: ["url"],
    },
  },
  {
    name: "catcher_send_to_intruder",
    category: "catcher",
    description:
      "Push a captured Catcher entry (by id) or explicit HTTP template into Wide Intruder UI.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "number", description: "Optional captured Catcher traffic ID." },
        method: { type: "string", description: "HTTP method." },
        url: { type: "string", description: "Target URL with optional §payload§ markers." },
        headers: { type: "object", description: "Request headers." },
        body: { type: "string", description: "Request body." },
        openUi: { type: "boolean", description: "Open Intruder UI. Defaults to true." },
      },
      required: [],
    },
  },
  {
    name: "intruder_attack",
    category: "catcher",
    description:
      "Execute an automated Intruder fuzzing/bruteforce run replacing §marker§ positions (or named template) with payloads and returning status/length diffs.",
    parameters: {
      type: "object",
      properties: {
        method: { type: "string", description: "HTTP method, defaults to GET." },
        url: { type: "string", description: "Target URL, optionally containing §marker§ markers." },
        headers: { type: "object", description: "Optional headers." },
        body: { type: "string", description: "Optional body, optionally containing §marker§ markers." },
        attackType: {
          type: "string",
          enum: ["sniper", "battering-ram", "pitchfork", "cluster-bomb"],
          description: "Intruder attack mode. Defaults to sniper.",
        },
        payloadSets: {
          type: "array",
          items: { type: "array", items: { type: "string" } },
          description: "Payload lists per position (up to 100 requests per run).",
        },
        concurrency: { type: "number", description: "Concurrent worker count (1-10, default 4)." },
        followRedirects: { type: "boolean", description: "Follow HTTP redirects." },
      },
      required: ["url", "payloadSets"],
    },
  },
  {
    name: "catcher_ws_send",
    category: "catcher",
    description:
      "List active Catcher-proxied WebSocket connections or inject a frame toward server or client.",
    parameters: {
      type: "object",
      properties: {
        connectionId: { type: "number", description: "Target WebSocket connection ID (omit to list live sockets)." },
        direction: { type: "string", enum: ["server", "client"], description: "Injection direction." },
        text: { type: "string", description: "Text payload frame to send." },
      },
      required: [],
    },
  },
  {
    name: "decision_score",
    category: "reasoning",
    description:
      "Score and select the optimal candidate among alternatives using multi-criteria weighted scoring.",
    parameters: {
      type: "object",
      properties: {
        candidates: { type: "array", items: { type: "object" }, description: "Array of candidate objects." },
        criteria: { type: "array", items: { type: "object" }, description: "Array of { field, weight }." },
        threshold: { type: "number", description: "Minimum acceptance threshold (defaults to 0.5)." },
      },
      required: ["candidates", "criteria"],
    },
  },
  {
    name: "decision_consensus",
    category: "reasoning",
    description: "Form a multi-agent consensus across discrete choices.",
    parameters: {
      type: "object",
      properties: {
        classesCount: { type: "number", description: "Number of discrete choices." },
        votes: { type: "array", items: { type: "object" }, description: "Array of { voterId, choice }." },
        minVotes: { type: "number", description: "Minimum required votes to settle." },
      },
      required: ["votes"],
    },
  },
  {
    name: "decision_claim",
    category: "reasoning",
    description: "Acquire or check an exclusive lease on a shared resource slot.",
    parameters: {
      type: "object",
      properties: {
        holderId: { type: "number", description: "Unique numeric identifier of holder." },
        bid: { type: "number", description: "Bid priority value." },
        lifetime: { type: "number", description: "Lease duration in seconds." },
        capacity: { type: "number", description: "Maximum concurrent allowed holders." },
      },
      required: ["holderId"],
    },
  },
  {
    name: "browser_open",
    category: "browser",
    description:
      "Launch Wide real Chromium browser, open the live side-by-side viewport panel immediately, and optionally navigate to a URL. Automatically routes through Catcher proxy when Catcher is active.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Optional initial http/https URL to open." },
        waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"], description: "Navigation wait mode." },
        clearSession: { type: "boolean", description: "Reset cookies/storage before opening." },
        bypassProxy: { type: "boolean", description: "Bypass Catcher proxy even if running." },
      },
      required: [],
    },
  },
  {
    name: "browser_navigate",
    category: "browser",
    description:
      "Navigate the real Chromium browser to an http/https URL, automatically opening the live browser viewport panel in Wide and returning page title plus interactive ARIA snapshot refs (@e1, @e2...).",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target http or https URL to navigate to." },
        waitUntil: { type: "string", enum: ["load", "domcontentloaded", "networkidle"], description: "Load state to wait for." },
      },
      required: ["url"],
    },
  },
  {
    name: "browser_snapshot",
    category: "browser",
    description:
      "Capture a compact ARIA + interactive element snapshot of the live page with deterministic refs (@e1, @e2...) usable directly with browser_click, browser_type, and browser_select.",
    parameters: {
      type: "object",
      properties: {
        interactiveOnly: { type: "boolean", description: "Return only interactive controls. Defaults to true." },
        selector: { type: "string", description: "Optional root CSS selector to scope snapshot." },
        maxNodes: { type: "number", description: "Max nodes to include (default 120)." },
      },
      required: [],
    },
  },
  {
    name: "browser_click",
    category: "browser",
    description:
      "Click an element in the live browser by @eN ref, element_id, CSS selector, visible text, or x/y coordinates.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref from browser_snapshot (e.g. '@e3')." },
        element_id: { type: "number", description: "Numeric element ref index (e.g. 3 for @e3)." },
        selector: { type: "string", description: "CSS selector." },
        text: { type: "string", description: "Visible element text." },
        x: { type: "number", description: "Viewport X coordinate." },
        y: { type: "number", description: "Viewport Y coordinate." },
        button: { type: "string", enum: ["left", "right", "middle"] },
        clickCount: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "browser_type",
    category: "browser",
    description:
      "Type text into an input or editable element identified by @eN ref, element_id, CSS selector, or visible label/placeholder.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref from browser_snapshot (e.g. '@e4')." },
        element_id: { type: "number", description: "Numeric element ref index." },
        selector: { type: "string", description: "CSS selector." },
        text: { type: "string", description: "Text to type." },
        clear: { type: "boolean", description: "Clear existing field value first. Defaults to true." },
        submit: { type: "boolean", description: "Press Enter after typing." },
      },
      required: ["text"],
    },
  },
  {
    name: "browser_press",
    category: "browser",
    description: "Press a keyboard key or shortcut in the live browser (e.g. 'Enter', 'Tab', 'Escape', 'Control+a').",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Key or shortcut name." },
      },
      required: ["key"],
    },
  },
  {
    name: "browser_hover",
    category: "browser",
    description: "Move pointer over an element in the live browser to trigger hover menus or tooltips.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref (@eN)." },
        selector: { type: "string", description: "CSS selector." },
        text: { type: "string", description: "Visible text." },
      },
      required: [],
    },
  },
  {
    name: "browser_select",
    category: "browser",
    description: "Select an option inside a <select> dropdown in the live browser.",
    parameters: {
      type: "object",
      properties: {
        ref: { type: "string", description: "Element ref (@eN)." },
        selector: { type: "string", description: "CSS selector." },
        value: { type: "string", description: "Option value attribute." },
        label: { type: "string", description: "Visible option label." },
      },
      required: [],
    },
  },
  {
    name: "browser_scroll",
    category: "browser",
    description: "Scroll the live browser page or bring an element into view.",
    parameters: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["down", "up", "left", "right"], description: "Scroll direction." },
        amount: { type: "number", description: "Pixel scroll distance (defaults to 600)." },
        ref: { type: "string", description: "Optional element ref (@eN) to scroll into view." },
        selector: { type: "string", description: "Optional CSS selector to scroll into view." },
      },
      required: [],
    },
  },
  {
    name: "browser_wait",
    category: "browser",
    description: "Wait for a selector, visible text, URL substring, or load state in the live browser.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Wait until CSS selector becomes visible." },
        text: { type: "string", description: "Wait until text appears on page." },
        url: { type: "string", description: "Wait until page URL contains substring." },
        loadState: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] },
        timeoutMs: { type: "number", description: "Timeout in milliseconds (default 10000, max 30000)." },
      },
      required: [],
    },
  },
  {
    name: "browser_extract",
    category: "browser",
    description:
      "Extract snapshot, visible text, links, inputs, DOM tree, HTML, cookies, or storage from the active page.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "Optional CSS selector to scope extraction." },
        mode: {
          type: "string",
          enum: ["snapshot", "text", "dom_tree", "links", "inputs", "html", "cookies", "storage"],
          description: "Extraction mode. Defaults to snapshot.",
        },
      },
      required: [],
    },
  },
  {
    name: "browser_console",
    category: "browser",
    description:
      "Read captured browser console messages, uncaught page errors, and failed network requests from the live session.",
    parameters: {
      type: "object",
      properties: {
        filter: { type: "string", enum: ["all", "errors", "warnings", "network"], description: "Event filter." },
        limit: { type: "number", description: "Max entries returned (default 40)." },
      },
      required: [],
    },
  },
  {
    name: "browser_cookies",
    category: "browser",
    description: "Inspect, set, or clear cookies in the active live Chromium browser context.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get", "set", "clear"], description: "Cookie operation. Defaults to get." },
        url: { type: "string", description: "Optional URL filter for get." },
        cookies: { type: "array", items: { type: "object" }, description: "Cookie objects for set." },
      },
      required: [],
    },
  },
  {
    name: "browser_eval",
    category: "browser",
    description: "Evaluate a JavaScript expression in the active browser page context and return the JSON result.",
    parameters: {
      type: "object",
      properties: {
        expression: { type: "string", description: "JavaScript expression or IIFE to evaluate inside the page." },
      },
      required: ["expression"],
    },
  },
  {
    name: "browser_screenshot",
    category: "browser",
    description: "Capture a real live screenshot of the active Chromium viewport and push it to Wide UI.",
    parameters: {
      type: "object",
      properties: {
        fullPage: { type: "boolean", description: "Capture full scrollable page instead of current viewport." },
      },
      required: [],
    },
  },
  {
    name: "browser_close",
    category: "browser",
    description: "Close the active live browser session and release Chromium resources.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "pitcher_send",
    category: "pitcher",
    description:
      "Send an HTTP request through Pitcher with {{var}} environment substitution, optional Vault credential injection (zero secret exposure), and live Pitcher UI sync.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Target URL (supports {{variable}} templates)." },
        method: { type: "string", description: "HTTP method, defaults to GET." },
        headers: { type: "object", description: "Request headers (values support {{variable}})." },
        body: { type: "string", description: "Request body (supports {{variable}})." },
        bodyBase64: { type: "boolean", description: "Treat body as base64-encoded binary." },
        vaultId: { type: "string", description: "Optional Vault credential ID from vault_list_refs to inject server-side." },
        vaultName: { type: "string", description: "Optional Vault credential name to inject server-side." },
        env: { type: "object", description: "Optional per-request variable overrides." },
        insecure: { type: "boolean", description: "Accept invalid TLS certificates. Defaults to true." },
        openUi: { type: "boolean", description: "Open Pitcher tab in Wide UI." },
      },
      required: ["url"],
    },
  },
  {
    name: "pitcher_env",
    category: "pitcher",
    description:
      "Inspect, create, select, or update Pitcher environments and variables (secret values are masked on read).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "get", "set", "unset", "create_env", "select_env"],
          description: "Pitcher environment operation.",
        },
        scope: { type: "string", enum: ["environment", "globals"], description: "Target variable scope." },
        envId: { type: "string", description: "Environment ID for select_env." },
        name: { type: "string", description: "Environment name for create_env/select_env." },
        key: { type: "string", description: "Variable key." },
        value: { type: "string", description: "Variable value for set." },
        secret: { type: "boolean", description: "Mark variable as secret so reads mask it." },
        select: { type: "boolean", description: "Select newly created environment as active." },
      },
      required: ["action"],
    },
  },
  {
    name: "oast_control",
    category: "oast",
    description:
      "Manage Wide out-of-band (OAST) listener: check status, start built-in HTTP callback server or Interactsh, stop, or mint a unique callback payload URL.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["status", "start_builtin", "start", "stop", "new_payload"],
          description: "OAST action.",
        },
        server: { type: "string", description: "Interactsh server URL for external OAST start." },
        token: { type: "string", description: "Optional Interactsh auth token." },
      },
      required: ["action"],
    },
  },
  {
    name: "oast_poll",
    category: "oast",
    description: "Poll captured OAST HTTP/DNS/SMTP out-of-band callback interactions.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max interactions to return (default 50, max 200)." },
        clear: { type: "boolean", description: "Clear recorded OAST interactions after polling." },
      },
      required: [],
    },
  },
  {
    name: "vault_list_refs",
    category: "vault",
    description:
      "List credential metadata/references stored in Wide Vault (id, name, kind, headerName, note). Plaintext secrets are never returned.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "findings_query",
    category: "security",
    description:
      "Query AST security scanner findings (triggering a scan if needed) and recorded manual findings, filtered by severity, ruleId, file, or text.",
    parameters: {
      type: "object",
      properties: {
        severity: { type: "string", description: "Filter by severity (error, warning, info, critical, high, medium, low)." },
        ruleId: { type: "string", description: "Filter by rule ID substring." },
        file: { type: "string", description: "Filter by file path substring." },
        query: { type: "string", description: "Filter by text match across finding fields." },
        scan: { type: "boolean", description: "Auto-run security scan if no cached scan exists (default true)." },
        limit: { type: "number", description: "Max findings to return (default 50)." },
      },
      required: [],
    },
  },
  {
    name: "findings_baseline",
    category: "security",
    description:
      "Set/clear the security scanner suppression baseline or export scan findings in SARIF 2.1.0 or JSON.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["set", "clear", "export"], description: "Baseline/export action." },
        format: { type: "string", enum: ["sarif", "json"], description: "Export format (default sarif)." },
        outPath: { type: "string", description: "Optional workspace relative path to write exported report." },
      },
      required: ["action"],
    },
  },
  {
    name: "terminal_session",
    category: "terminal",
    description:
      "Manage persistent interactive shell sessions (dev servers, watchers, REPLs, interactive prompts): start, write input, read output, list, or close.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "write", "read", "list", "close"],
          description: "Session lifecycle or I/O action.",
        },
        id: { type: "string", description: "Terminal session ID (e.g. term-1) for write/read/close." },
        shell: { type: "string", description: "Optional shell choice (cmd, powershell, pwsh, gitbash, wsl)." },
        cwd: { type: "string", description: "Working directory relative to workspace." },
        command: { type: "string", description: "Initial or line command to execute." },
        data: { type: "string", description: "Raw text input to write for `write`." },
        appendNewline: { type: "boolean", description: "Append newline automatically on write (default true)." },
        waitMs: { type: "number", description: "Milliseconds to wait for buffered output after start/write." },
        all: { type: "boolean", description: "For `read`, return full ring buffer instead of unread delta." },
      },
      required: ["action"],
    },
  },
  {
    name: "engine_control",
    category: "engine",
    description:
      "Control Wide built-in Engine static/dev preview server: check status, list servable entries, start, stop, or trigger live reload.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["status", "entries", "start", "stop", "reload"], description: "Engine action." },
        directory: { type: "string", description: "Optional subfolder relative to workspace for start." },
        path: { type: "string", description: "Optional changed path for reload." },
      },
      required: ["action"],
    },
  },
  {
    name: "lsp_navigate",
    category: "lsp",
    description:
      "Use language servers for symbol intelligence: go-to-definition, find references, hover docs, document/workspace symbols, completions, or code actions.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["definition", "references", "hover", "symbols", "workspace_symbols", "completion", "code_actions"],
          description: "LSP operation.",
        },
        path: { type: "string", description: "File path relative to workspace." },
        line: { type: "number", description: "1-based line number (unless zeroBased: true)." },
        character: { type: "number", description: "0-based column offset." },
        query: { type: "string", description: "Symbol search query for workspace_symbols." },
        zeroBased: { type: "boolean", description: "Interpret `line` as 0-based." },
      },
      required: ["action", "path"],
    },
  },
  {
    name: "debug_control",
    category: "debug",
    description:
      "Control Node/Python/Go/Ruby/Browser debugger: start, attach browser, set breakpoints, step, pause/resume, inspect properties, or evaluate expressions.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["start", "start_browser", "stop", "resume", "step_over", "step_into", "step_out", "pause", "evaluate", "properties", "set_breakpoint"],
          description: "Debugger command.",
        },
        file: { type: "string", description: "Target script or source file path." },
        line: { type: "number", description: "1-based breakpoint line." },
        breakpoints: { type: "array", items: { type: "object" }, description: "Initial breakpoints list." },
        expression: { type: "string", description: "Expression for evaluate." },
        callFrameId: { type: "string", description: "Optional callFrameId for evaluate." },
        objectId: { type: "string", description: "Remote objectId for properties." },
        enabled: { type: "boolean", description: "Enable/disable breakpoint." },
        condition: { type: "string", description: "Optional breakpoint condition." },
      },
      required: ["action"],
    },
  },
  {
    name: "wide_custom_tool_run",
    category: "tools",
    description:
      "List, execute, cancel, or scaffold user-defined Wide extension scripts in .wide/tools.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "run", "cancel", "scaffold"], description: "Custom tool operation." },
        toolId: { type: "string", description: "Tool manifest ID for run." },
        commandId: { type: "string", description: "Command ID inside tool.json (default 'run')." },
        input: { type: "string", description: "Optional input text passed to the tool." },
        runId: { type: "string", description: "Active runId to cancel." },
        name: { type: "string", description: "New tool name for scaffold." },
      },
      required: ["action"],
    },
  },
  {
    name: "run_tests",
    category: "test",
    description: "Discover test suites or run project unit/integration tests natively through Wide test runner.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["discover", "run"], description: "Discover or run tests." },
        framework: { type: "string", description: "Optional test framework override." },
        file: { type: "string", description: "Optional specific test file." },
        testName: { type: "string", description: "Optional specific test filter name." },
      },
      required: ["action"],
    },
  },
  {
    name: "ui_state_get",
    category: "ui",
    description:
      "Get live Wide IDE/App operational state: open tabs, active file, Catcher proxy state, Engine dev server state, OAST listener, Vault count, and Chromium browser session.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "db_list_connections",
    category: "database",
    description:
      "List configured database connections (ID, name, engine, environment, readOnly status). Never exposes credentials.",
    parameters: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "db_inspect_schema",
    category: "database",
    description:
      "Inspect tables, columns, primary/foreign keys, or Redis key prefixes for a configured database connection.",
    parameters: {
      type: "object",
      properties: {
        connectionId: { type: "string", description: "Database connection ID from db_list_connections." },
      },
      required: ["connectionId"],
    },
  },
  {
    name: "db_query_readonly",
    category: "database",
    description:
      "Run a strictly read-only SQL query (SELECT, WITH SELECT, SHOW, EXPLAIN) against a configured SQL database. Secret columns are redacted.",
    parameters: {
      type: "object",
      properties: {
        connectionId: { type: "string", description: "Database connection ID from db_list_connections." },
        sql: { type: "string", description: "Read-only SQL query to execute." },
        limit: { type: "number", description: "Optional max rows (default 100, max 200)." },
      },
      required: ["connectionId", "sql"],
    },
  },
];

const AI_WRITE_TOOLS = new Set([
  "write_file",
  "edit_file",
  "create_dir",
  "delete_file",
  "run_command",
  "catcher_intercept_decide",
  "catcher_match_replace",
  "intruder_attack",
  "browser_eval",
  "pitcher_env",
  "findings_baseline",
  "terminal_session",
  "engine_control",
  "debug_control",
  "wide_custom_tool_run",
  "run_tests",
]);

const AI_TOOL_NAME_ALIASES = {
  create_file: "write_file",
  save_file: "write_file",
  write_to_file: "write_file",
  overwrite_file: "write_file",
  new_file: "write_file",
  write: "write_file",
  modify_file: "edit_file",
  update_file: "edit_file",
  replace_in_file: "edit_file",
  str_replace: "edit_file",
  str_replace_editor: "edit_file",
  patch_file: "edit_file",
  edit: "edit_file",
  view_file: "read_file",
  cat: "read_file",
  get_file: "read_file",
  read: "read_file",
  list_files: "list_dir",
  ls: "list_dir",
  list: "list_dir",
  dir: "list_dir",
  list_directory: "list_dir",
  grep: "search",
  glob: "search",
  search_files: "search",
  find_in_files: "search",
  bash: "run_command",
  sh: "run_command",
  shell: "run_command",
  exec: "run_command",
  execute: "run_command",
  execute_command: "run_command",
  terminal: "run_command",
  cmd: "run_command",
  mkdir: "create_dir",
  make_dir: "create_dir",
  create_directory: "create_dir",
  rm: "delete_file",
  remove_file: "delete_file",
  unlink: "delete_file",
  open_tool: "open_tool_tab",
  open_tab: "open_tool_tab",
  switch_tab: "open_tool_tab",
  navigate_tool: "open_tool_tab",
  diagnostics: "get_diagnostics",
  check_diagnostics: "get_diagnostics",
  problems: "get_diagnostics",
  check_errors: "get_diagnostics",
  transform: "transform_data",
  decode: "transform_data",
  encode: "transform_data",
  jwt: "transform_data",
  hash: "transform_data",
  http_request: "send_http_request",
  http: "send_http_request",
  send_to_pitcher: "pitcher_send",
  send_request: "send_http_request",
  request: "send_http_request",
  fetch: "send_http_request",
  curl: "send_http_request",
  oast: "oast_control",
  vault_list: "vault_list_refs",
  list_findings: "findings_query",
  lsp: "lsp_navigate",
  debug: "debug_control",
  test_run: "run_tests",
  ui_state: "ui_state_get",
  get_ui_state: "ui_state_get",
  security_scan: "run_security_scan",
  sec_scan: "run_security_scan",
  scan_security: "run_security_scan",
  scan_project: "run_security_scan",
  vuln_scan: "run_security_scan",
  audit_dependencies: "check_dependencies",
  audit_deps: "check_dependencies",
  osv_scan: "check_dependencies",
  check_cve: "check_dependencies",
  cve_audit: "check_dependencies",
  list_open_tabs: "get_open_tabs",
  open_tabs: "get_open_tabs",
  get_tabs: "get_open_tabs",
  active_tabs: "get_open_tabs",
  catcher: "manage_catcher",
  catcher_proxy: "manage_catcher",
  proxy_control: "catcher_control",
  control_proxy: "catcher_control",
  get_proxy_traffic: "catcher_traffic_query",
  proxy_traffic: "catcher_traffic_query",
  catcher_traffic: "catcher_traffic_query",
  start_proxy: "catcher_control",
  stop_proxy: "catcher_control",
  proxy_status: "catcher_control",
  catcher_status: "catcher_control",
  open_browser: "browser_open",
  launch_browser: "browser_open",
  start_browser: "browser_open",
  navigate: "browser_navigate",
  goto: "browser_navigate",
  browse: "browser_navigate",
  snapshot: "browser_snapshot",
  page_snapshot: "browser_snapshot",
  click: "browser_click",
  click_element: "browser_click",
  type: "browser_type",
  type_text: "browser_type",
  fill: "browser_type",
  fill_input: "browser_type",
  press: "browser_press",
  press_key: "browser_press",
  hover: "browser_hover",
  select_option: "browser_select",
  scroll: "browser_scroll",
  wait_for: "browser_wait",
  extract: "browser_extract",
  extract_text: "browser_extract",
  browser_logs: "browser_console",
  cookies: "browser_cookies",
  screenshot: "browser_screenshot",
  capture_screen: "browser_screenshot",
  close_browser: "browser_close",
};

const AI_KNOWN_TOOL_NAMES = new Set(AI_TOOLS.map((t) => t.name));

const AI_DESTRUCTIVE_COMMAND_PATTERNS = [
  { pattern: /\brm\s+-[a-zA-Z]*[rf][a-zA-Z]*\s+(?:\/|~|\$HOME|\.\.|[A-Za-z]:\\)/i, reason: "Recursive deletion targeting root, home, or parent path" },
  { pattern: /\b(?:Remove-Item|ri|rm|del|erase)\b[^\n]*(?:-Recurse|-Force|\/s\b|\/q\b)[^\n]*(?:[A-Za-z]:\\|~|\.\.)/i, reason: "Recursive file deletion outside current working directory" },
  { pattern: /\b(?:rmdir|rd)\s+\/s\b[^\n]*(?:[A-Za-z]:\\|~|\.\.)/i, reason: "Recursive directory removal outside workspace" },
  { pattern: /\b(?:mkfs(?:\.[a-z0-9]+)?|format\s+[a-z]:|diskpart|dd\s+if=|bcdedit|cipher\s+\/w)/i, reason: "Disk formatting or low-level storage write command" },
  { pattern: /\b(?:shutdown|reboot|halt|poweroff|Stop-Computer|Restart-Computer)\b/i, reason: "System power or shutdown command" },
  { pattern: /\breg\s+delete\b/i, reason: "Windows Registry key deletion" },
  { pattern: /\bgit\s+(?:push\s+(?:--force|-f)\b|reset\s+--hard\b|clean\s+-[a-zA-Z]*f)/i, reason: "Destructive Git history or working tree reset/force-push" },
  { pattern: /\bnpm\s+unpublish\b/i, reason: "Irreversible npm package unpublish" },
];

function aiAssessCommandRisk(command) {
  const cmd = String(command ?? "").trim();
  if (!cmd) return { destructive: false, reason: "" };
  for (const rule of AI_DESTRUCTIVE_COMMAND_PATTERNS) {
    if (rule.pattern.test(cmd)) {
      return { destructive: true, reason: rule.reason };
    }
  }
  return { destructive: false, reason: "" };
}

function aiGetToolCatalog(allowWrites = true) {
  const own = allowWrites ? AI_TOOLS : AI_TOOLS.filter((tool) => !AI_WRITE_TOOLS.has(tool.name));
  const extra = typeof mcpToolSpecs === "function" ? mcpToolSpecs() : [];
  return [...own, ...extra].map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  }));
}

const aiPendingPermissions = new Map();

function aiRequestPermission(send, { title, detail, command = "", tool = "" }) {
  if (typeof send !== "function") return Promise.resolve({ allowed: false, reason: "Interactive confirmation unavailable." });
  const requestId = `perm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (aiPendingPermissions.delete(requestId)) {
        resolve({ allowed: false, reason: "Confirmation timed out after 5 minutes." });
      }
    }, 5 * 60 * 1000);
    timer.unref?.();

    aiPendingPermissions.set(requestId, {
      resolve: (decision) => {
        clearTimeout(timer);
        aiPendingPermissions.delete(requestId);
        resolve(decision);
      },
    });

    try {
      send({
        type: "permission_request",
        requestId,
        title: String(title || "Critical action requires confirmation"),
        detail: String(detail || ""),
        command: String(command || ""),
        tool: String(tool || ""),
      });
    } catch {
      clearTimeout(timer);
      aiPendingPermissions.delete(requestId);
      resolve({ allowed: false, reason: "Could not deliver confirmation prompt to UI." });
    }
  });
}

function aiResolvePermission(requestId, allowed, reason = "") {
  const entry = aiPendingPermissions.get(String(requestId || ""));
  if (!entry) return false;
  entry.resolve({ allowed: Boolean(allowed), reason: String(reason || "") });
  return true;
}
