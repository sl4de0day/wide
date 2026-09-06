import { SYSTEM_EXTENSIONS, type SystemExtension } from "./systemExtensions";




export interface MarketplaceExtension extends SystemExtension {

  kind: "language" | "tool";

  removable: boolean;

  provides: readonly string[];

  homepage: string;
}



const CODEBERG: MarketplaceExtension = {
  id: "codeberg",
  name: "Codeberg",
  version: "1.0.0",
  colour: "#2185D0",
  kind: "tool",
  removable: true,
  summary: "Version control on Codeberg",
  description:
    "Codeberg is a non-profit home for source code, built on Forgejo. This extension puts its everyday loop in the sidebar: see what you changed, stage what belongs together, write a message, push.\n\nSigning in uses an access token where a password would go, and Wide never keeps it: the token goes straight to Git's own credential manager. A repository has to exist on the site before your first push.",
  provides: [
    "Source control panel",
    "Branch in the title bar",
    "Stage, commit, push, pull",
    "Annotated tags",
  ],
  homepage: "https://codeberg.org",

  path:
    "M11.999.747A11.974 11.974 0 0 0 0 12.75c0 2.254.635 4.465 1.833 6.376L11.837 6.19c.072-.092.251-.092.323 0l4.178 5.402h-2.992l.065.239h3.113l.882 1.138h-3.674l.103.374h3.86l.777 1.003h-4.358l.135.483h4.593l.695.894h-5.038l.165.589h5.326l.609.785h-5.717l.182.65h6.038l.562.727h-6.397l.183.65h6.717A12.003 12.003 0 0 0 24 12.75 11.977 11.977 0 0 0 11.999.747zm3.654 19.104.182.65h5.326c.173-.204.353-.433.513-.65zm.385 1.377.18.65h3.563c.233-.198.485-.428.712-.65zm.383 1.377.182.648h1.203c.356-.204.685-.412 1.042-.648zz",


  fileExtensions: [],
  server: null,
};



const GITHUB: MarketplaceExtension = {
  id: "github",
  name: "GitHub",
  version: "1.0.0",
  colour: "#e6edf3",
  kind: "tool",
  removable: true,
  summary: "Version control on GitHub",
  description:
    "GitHub is where most of the world's open source lives. This extension puts its everyday loop in the sidebar: see what you changed, stage what belongs together, write a message, push.\n\nSigning in uses a personal access token where a password would go, and Wide never keeps it: the token goes straight to Git's own credential manager, stored against github.com. A repository has to exist on the site before your first push.",
  provides: [
    "Source control panel",
    "Branch in the title bar",
    "Stage, commit, push, pull",
    "Annotated tags",
  ],
  homepage: "https://github.com",

  path:
    "M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12",
  fileExtensions: [],
  server: null,
};



const COMMENT_CLEANER: MarketplaceExtension = {
  id: "comment-cleaner",
  name: "Comment Cleaner",
  version: "1.0.0",
  colour: "#7fc8a9",
  kind: "tool",
  removable: true,
  summary: "Strip comments without changing what the code does",
  description:
    "Removes the comments from a file and leaves everything else exactly as it was. There is a separate cleaner for each of the eighteen languages, because a comment is not the same thing in any two of them.\n\nIt scans rather than searches and replaces, so a hash inside a string survives, and comments that do something are kept: build directives, linter suppressions, licence banners. Nothing is written to disk, so one undo puts them all back.",
  provides: [
    "Clean button on the tab",
    "A cleaner for each of the 18 languages",
    "Keeps comments that change behaviour",
  ],
  homepage: "",

  path:
    "M13.8 1.2a1 1 0 0 1 1.4 0l7.6 7.6a1 1 0 0 1 0 1.4l-3.2 3.2-9-9 3.2-3.2zM9.9 5.1l9 9-1.6 1.6-9-9 1.6-1.6zM7.2 7.8l9 9-.8.8H5.6a2 2 0 0 1-2-2v-1.9L7.2 7.8zM2 19.5h20a1 1 0 1 1 0 2H2a1 1 0 1 1 0-2z",
  fileExtensions: [],
  server: null,
};



const AI_ASSISTANT: MarketplaceExtension = {
  id: "ai-assistant",
  name: "AI Assistant",
  version: "1.0.0",
  colour: "#c99bdb",
  kind: "tool",
  removable: true,
  summary: "Ask a model about your code, in the cloud or on this machine",
  description:
    "A chat panel that talks to a model about the project you have open. Cloud connects to Gemini, DeepSeek or Claude with a key you provide. Local runs the model on this machine through Ollama, which is installed for you if it is missing.\n\nWhichever you pick, the assistant gets the same five tools: list, read, search, open and rewrite. Each one goes through Wide's policy as the assistant rather than as you, and a rewrite lands in the editor instead of on the disk, so one undo takes it back.",
  provides: [
    "Chat panel in the sidebar",
    "Gemini, DeepSeek, Claude API, Claude Code",
    "Local models through Ollama",
    "Reads and edits the project, under policy",
  ],
  homepage: "",

  path:
    "M11 2.5a.6.6 0 0 1 1.14 0l1.62 4.36a3 3 0 0 0 1.78 1.78l4.36 1.62a.6.6 0 0 1 0 1.14l-4.36 1.62a3 3 0 0 0-1.78 1.78l-1.62 4.36a.6.6 0 0 1-1.14 0l-1.62-4.36a3 3 0 0 0-1.78-1.78L3.25 11.4a.6.6 0 0 1 0-1.14l4.35-1.62a3 3 0 0 0 1.78-1.78L11 2.5zM18.6 15.1a.4.4 0 0 1 .76 0l.7 1.9a1.4 1.4 0 0 0 .83.83l1.9.7a.4.4 0 0 1 0 .76l-1.9.7a1.4 1.4 0 0 0-.83.83l-.7 1.9a.4.4 0 0 1-.76 0l-.7-1.9a1.4 1.4 0 0 0-.83-.83l-1.9-.7a.4.4 0 0 1 0-.76l1.9-.7a1.4 1.4 0 0 0 .83-.83l.7-1.9z",
  fileExtensions: [],
  server: null,
};









const TRUFFLEHOG: MarketplaceExtension = {
  id: "trufflehog",
  name: "TruffleHog",
  version: "3",
  colour: "#8a63d2",
  kind: "tool",
  removable: true,
  summary: "Find secrets committed to a repository or its history",
  description:
    "Scans a codebase, its whole Git history and network responses for keys that were committed by accident: API tokens, AWS and GCP credentials, private keys. It uses both patterns and entropy, and can verify a found key against its provider so a match is a live secret rather than a guess.\n\nIn review it is the first pass over an unfamiliar repository, because a leaked credential in an old commit is still a leaked credential. It installs as a Go binary and runs from the terminal.",
  provides: ["Scans code, git history and responses", "Verifies a found key is live"],
  homepage: "",
  path:
    "M15 2a7 7 0 0 0-6.7 9.1L2 17.4V22h4.6l1-1v-2h2v-2h2l1.3-1.3A7 7 0 1 0 15 2zm2 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  fileExtensions: [],
  server: null,
};

const NUCLEI: MarketplaceExtension = {
  id: "nuclei",
  name: "Nuclei",
  version: "3",
  colour: "#e8543f",
  kind: "tool",
  removable: true,
  summary: "Template-driven vulnerability scanning, fast and community-fed",
  description:
    "Runs thousands of YAML templates against a target to find known vulnerabilities, misconfigurations and exposures. The templates are maintained by a large community and updated constantly, so a new disclosure becomes a check you can run the same week.\n\nIt is the workhorse of a modern web assessment: point it at a host or a list of them and it reports what matched and why. It installs as a Go binary.",
  provides: ["Thousands of maintained templates", "Scans one host or a list"],
  homepage: "",
  path:
    "M12 2 4 5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V5l-8-3z",
  fileExtensions: [],
  server: null,
};

const FFUF: MarketplaceExtension = {
  id: "ffuf",
  name: "ffuf",
  version: "2",
  colour: "#3fae5a",
  kind: "tool",
  removable: true,
  summary: "A very fast web fuzzer for paths, files and parameters",
  description:
    "Discovers hidden directories, files, virtual hosts and parameters by fuzzing a marked position in a request against a wordlist, at high speed. Filters on status, size and words separate a real find from the noise a wildcard route makes.\n\nIt is how the shape of an application that is not linked anywhere gets mapped. Written in Go, it installs as a single binary.",
  provides: ["Fuzzes paths, hosts and parameters", "Filters out the noise"],
  homepage: "",
  path:
    "M8 3c-1.7 0-3 1.3-3 3v3l-2 3 2 3v3c0 1.7 1.3 3 3 3v-2c-.6 0-1-.4-1-1v-3.5L5.5 12 7 9.5V6c0-.6.4-1 1-1V3zm8 0v2c.6 0 1 .4 1 1v3.5l1.5 2.5-1.5 2.5V18c0 .6-.4 1-1 1v2c1.7 0 3-1.3 3-3v-3l2-3-2-3V6c0-1.7-1.3-3-3-3z",
  fileExtensions: [],
  server: null,
};

const KATANA: MarketplaceExtension = {
  id: "katana",
  name: "Katana",
  version: "1",
  colour: "#d98a2b",
  kind: "tool",
  removable: true,
  summary: "A next-generation crawler for links, forms and endpoints",
  description:
    "Crawls a target the way a browser would, following links, forms and the API calls a page makes, including the ones only reachable after JavaScript runs. What it returns is the real surface of an application rather than the one in its sitemap.\n\nIt feeds the rest of a toolchain: the URLs it finds are what a scanner or a fuzzer is then pointed at. It installs as a Go binary.",
  provides: ["Crawls links, forms and endpoints", "Sees what loads after JavaScript"],
  homepage: "",
  path:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15 15 0 0 0-1.3-3.6A8 8 0 0 1 18.9 8zM12 4c.8 0 1.8 1.5 2.4 4H9.6C10.2 5.5 11.2 4 12 4zM4.3 14a8 8 0 0 1 0-4h3.2a20 20 0 0 0 0 4H4.3zm.8 2h2.9a15 15 0 0 0 1.3 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.2-3.6A15 15 0 0 0 8 8zm4 12c-.8 0-1.8-1.5-2.4-4h4.8c-.6 2.5-1.6 4-2.4 4zm.5-6h-1a18 18 0 0 1 0-4h1a18 18 0 0 1 0 4zm2.2 5.6a15 15 0 0 0 1.3-3.6h2.9a8 8 0 0 1-4.2 3.6zM16.5 14a20 20 0 0 0 0-4h3.2a8 8 0 0 1 0 4h-3.2z",
  fileExtensions: [],
  server: null,
};

const HTTPX: MarketplaceExtension = {
  id: "httpx",
  name: "httpx",
  version: "1",
  colour: "#2b9fd9",
  kind: "tool",
  removable: true,
  summary: "Probe hosts fast: status, headers, titles and TLS",
  description:
    "Takes a list of hosts or URLs and tells you which are alive, with their status codes, response headers, page titles and TLS certificate details, at speed. It is how a list of thousands of subdomains becomes a short list of things worth looking at.\n\nIt is the ProjectDiscovery Go tool, not the Python HTTP library that shares the name. It installs from its Go module.",
  provides: ["Which hosts are alive, and how", "Status, headers, titles, TLS"],
  homepage: "",
  path:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-2.9a15 15 0 0 0-1.3-3.6A8 8 0 0 1 18.9 8zM12 4c.8 0 1.8 1.5 2.4 4H9.6C10.2 5.5 11.2 4 12 4zM4.3 14a8 8 0 0 1 0-4h3.2a20 20 0 0 0 0 4H4.3zm.8 2h2.9a15 15 0 0 0 1.3 3.6A8 8 0 0 1 5.1 16zM8 8H5.1a8 8 0 0 1 4.2-3.6A15 15 0 0 0 8 8zm4 12c-.8 0-1.8-1.5-2.4-4h4.8c-.6 2.5-1.6 4-2.4 4zm.5-6h-1a18 18 0 0 1 0-4h1a18 18 0 0 1 0 4zm2.2 5.6a15 15 0 0 0 1.3-3.6h2.9a8 8 0 0 1-4.2 3.6zM16.5 14a20 20 0 0 0 0-4h3.2a8 8 0 0 1 0 4h-3.2z",
  fileExtensions: [],
  server: null,
};

const DALFOX: MarketplaceExtension = {
  id: "dalfox",
  name: "dalfox",
  version: "2",
  colour: "#c0392b",
  kind: "tool",
  removable: true,
  summary: "Analyse and verify XSS on a parameter",
  description:
    "Tests parameters for cross-site scripting and, rather than only reporting a reflection, verifies it with a payload so a finding is one that actually fires. It reasons about the context an input lands in, which is what separates a real XSS from an echoed string.\n\nIt is a focused tool for one of the most common web bugs. Written in Go, it installs as a single binary.",
  provides: ["Verifies XSS with a payload", "Reasons about the injection context"],
  homepage: "",
  path:
    "M12 2 4 5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V5l-8-3z",
  fileExtensions: [],
  server: null,
};

const SUBFINDER: MarketplaceExtension = {
  id: "subfinder",
  name: "Subfinder",
  version: "2",
  colour: "#16a085",
  kind: "tool",
  removable: true,
  summary: "Find subdomains from passive sources, fast",
  description:
    "Collects subdomains of a target from passive sources: DNS records, certificate transparency logs and public datasets, without touching the target itself. A wide net cast quietly is where an assessment of an unfamiliar organisation begins.\n\nIts output pairs naturally with a prober like httpx to find which of the names are live. It installs as a Go binary.",
  provides: ["Passive: it never touches the target", "DNS and certificate logs"],
  homepage: "",
  path:
    "M6 3a3 3 0 0 0-1 5.8V11a3 3 0 0 0 3 3h3v2.2a3 3 0 1 0 2 0V14h3a3 3 0 0 0 3-3V8.8A3 3 0 1 0 17 8.8V11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8.8A3 3 0 0 0 6 3z",
  fileExtensions: [],
  server: null,
};

const INTERACTSH: MarketplaceExtension = {
  id: "interactsh",
  name: "Interactsh (OAST)",
  version: "1",
  colour: "#9b59b6",
  kind: "tool",
  removable: true,
  summary: "Out-of-band listener for blind vulnerabilities — Collaborator",
  description:
    "The listener behind Catcher's Collaborator. Some flaws show nothing in the response but make the server reach out elsewhere — a blind SSRF, a blind XXE, an out-of-band SQL injection. This provisions projectdiscovery's interactsh-client, which Catcher points at YOUR OWN interactsh server (self-hosted only) and whose interactions stream into the Collaborator tab and confirm the scanner's blind findings.\n\nInstalls as a Go binary; you supply your server and token in the Collaborator tab.",
  provides: ["Catches DNS/HTTP/SMTP callbacks from the target", "Self-hosted: your server, your data"],
  homepage: "",
  path:
    "M12 2a1 1 0 0 0-1 1v1.06A8 8 0 0 0 4.06 11H3a1 1 0 1 0 0 2h1.06A8 8 0 0 0 11 19.94V21a1 1 0 1 0 2 0v-1.06A8 8 0 0 0 19.94 13H21a1 1 0 1 0 0-2h-1.06A8 8 0 0 0 13 4.06V3a1 1 0 0 0-1-1zm0 5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  fileExtensions: [],
  server: null,
};

const SQLMAP: MarketplaceExtension = {
  id: "sqlmap",
  name: "SQLMap",
  version: "1",
  colour: "#d94f4f",
  kind: "tool",
  removable: true,
  summary: "Detect and exploit SQL injection, automatically",
  description:
    "The standard tool for finding SQL injection and then showing what it exposes: enumerating databases, reading tables, and confirming the reach of a flaw across many database dialects and injection techniques. Confirming an injection is one thing; sqlmap is how you assess what it is worth.\n\nIt is a Python program and installs through pip. Point it only at systems you are authorised to test.",
  provides: ["Finds and confirms SQL injection", "Enumerates what the flaw exposes"],
  homepage: "",
  path:
    "M12 2 4 5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V5l-8-3z",
  fileExtensions: [],
  server: null,
};

const SECLISTS: MarketplaceExtension = {
  id: "seclists",
  name: "SecLists",
  version: "2",
  colour: "#5d6d7e",
  kind: "tool",
  removable: true,
  summary: "The wordlists security work runs on",
  description:
    "A single collection of the lists the rest of these tools take as input: usernames, passwords, common directories and files, fuzzing payloads for XSS and SQL injection, and more. It is not a program; it is the raw material a fuzzer or a scanner is pointed at.\n\nInstalling it clones the collection onto the machine so the paths are there when a tool asks for a wordlist. It is data only, fetched with a shallow git clone.",
  provides: ["Usernames, passwords, payloads", "Data for the other tools"],
  homepage: "",
  path:
    "M4 5h3v3H4V5zm5 .5h11v2H9v-2zM4 10.5h3v3H4v-3zm5 .5h11v2H9v-2zM4 16h3v3H4v-3zm5 .5h11v2H9v-2z",
  fileExtensions: [],
  server: null,
};

const COMMIX: MarketplaceExtension = {
  id: "commix",
  name: "Commix",
  version: "3",
  colour: "#b7472a",
  kind: "tool",
  removable: true,
  summary: "Detect and exploit command injection",
  description:
    "Automates finding and exploiting command injection, where user input reaches a shell on the server. It works through the ways such a flaw hides: blind timing, out-of-band signals, and the shells and platforms an application might be running on.\n\nIt is a Python program with no package to install, so it is fetched by cloning its repository. Use it only against systems you are authorised to test.",
  provides: ["Finds command injection", "Works blind and out-of-band"],
  homepage: "",
  path:
    "M12 2 4 5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V5l-8-3z",
  fileExtensions: [],
  server: null,
};

const ARJUN: MarketplaceExtension = {
  id: "arjun",
  name: "Arjun",
  version: "2",
  colour: "#8e44ad",
  kind: "tool",
  removable: true,
  summary: "Discover hidden HTTP parameters",
  description:
    "Finds query, body and JSON parameters an endpoint accepts but does not document, by sending candidates and watching how the response changes. A parameter nobody mentions is often the one that was never hardened.\n\nWhat it finds is what you then test with the rest of the toolkit. It is a Python program and installs through pip.",
  provides: ["Finds undocumented parameters", "Query, body and JSON"],
  homepage: "",
  path:
    "M8 3c-1.7 0-3 1.3-3 3v3l-2 3 2 3v3c0 1.7 1.3 3 3 3v-2c-.6 0-1-.4-1-1v-3.5L5.5 12 7 9.5V6c0-.6.4-1 1-1V3zm8 0v2c.6 0 1 .4 1 1v3.5l1.5 2.5-1.5 2.5V18c0 .6-.4 1-1 1v2c1.7 0 3-1.3 3-3v-3l2-3-2-3V6c0-1.7-1.3-3-3-3z",
  fileExtensions: [],
  server: null,
};

const SUBLIST3R: MarketplaceExtension = {
  id: "sublist3r",
  name: "Sublist3r",
  version: "1",
  colour: "#1f9e89",
  kind: "tool",
  removable: true,
  summary: "Enumerate subdomains from search engines and OSINT",
  description:
    "Gathers a target's subdomains from search engines and open-source intelligence sources, a classic first step in mapping how much of an organisation faces the internet. It covers different ground from a certificate-log tool, so the two together find more than either alone.\n\nIt is a Python program fetched by cloning its repository, since its published package is old.",
  provides: ["Search engines and OSINT", "Complements certificate-log tools"],
  homepage: "",
  path:
    "M6 3a3 3 0 0 0-1 5.8V11a3 3 0 0 0 3 3h3v2.2a3 3 0 1 0 2 0V14h3a3 3 0 0 0 3-3V8.8A3 3 0 1 0 17 8.8V11a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V8.8A3 3 0 0 0 6 3z",
  fileExtensions: [],
  server: null,
};

const SECRETFINDER: MarketplaceExtension = {
  id: "secretfinder",
  name: "SecretFinder",
  version: "1",
  colour: "#7d5fff",
  kind: "tool",
  removable: true,
  summary: "Pull endpoints and keys out of a site's JavaScript",
  description:
    "Reads the minified JavaScript a site loads and extracts what is hidden in it: API endpoints, parameters, tokens and comments that were never meant to be read. The client-side bundle is where a modern application accidentally documents its own back end.\n\nIt is a Python program with no package, fetched by cloning its repository.",
  provides: ["Reads a site's minified JavaScript", "Finds endpoints, keys and comments"],
  homepage: "",
  path:
    "M15 2a7 7 0 0 0-6.7 9.1L2 17.4V22h4.6l1-1v-2h2v-2h2l1.3-1.3A7 7 0 1 0 15 2zm2 5a2 2 0 1 1-4 0 2 2 0 0 1 4 0z",
  fileExtensions: [],
  server: null,
};

const JWT_TOOL: MarketplaceExtension = {
  id: "jwt-tool",
  name: "jwt_tool",
  version: "2",
  colour: "#e67e22",
  kind: "tool",
  removable: true,
  summary: "Analyse and attack JSON Web Tokens",
  description:
    "Takes a JWT apart to test the ways one is commonly weak: signatures that can be brute-forced, the none-algorithm downgrade, and claims that can be manipulated because the server trusts them. Authentication that rests on a token is only as strong as how the token is checked.\n\nIt is a Python program with no package, fetched by cloning its repository.",
  provides: ["Brute-forces and manipulates tokens", "Tests the none-algorithm flaw"],
  homepage: "",
  path:
    "M10.2 0v6.456L12 8.928l1.8-2.472V0zm3.6 6.456v3.072l2.904-.96L20.52 3.36l-2.928-2.136zm2.904 2.112l-1.8 2.496 2.928.936 6.144-1.992-1.128-3.432zM17.832 12l-2.928.936 1.8 2.496 6.144 1.992 1.128-3.432zm-1.128 3.432l-2.904-.96v3.072l3.792 5.232 2.928-2.136zM13.8 17.544L12 15.072l-1.8 2.472V24h3.6zm-3.6 0v-3.072l-2.904.96L3.48 20.64l2.928 2.136zm-2.904-2.112l1.8-2.496L6.168 12 .024 13.992l1.128 3.432zM6.168 12l2.928-.936-1.8-2.496-6.144-1.992-1.128 3.432zm1.128-3.432l2.904.96V6.456L6.408 1.224 3.48 3.36Z",
  fileExtensions: [],
  server: null,
};

const CURLCONVERTER: MarketplaceExtension = {
  id: "curlconverter",
  name: "curlconverter",
  version: "1",
  colour: "#4a9ed8",
  kind: "tool",
  removable: true,
  summary: "Turn a cURL command into code",
  description:
    "Converts a cURL command, the kind you copy out of a browser's network tab, into a working request in Python, JavaScript, Go, Rust and more. It is the fastest way to move from a request you captured to a script you can run and change.\n\nIt installs as a Node command. Its logic is also a natural fit for a future paste-and-convert action inside Wide.",
  provides: ["cURL to Python, JS, Go, Rust", "Installs as a Node command"],
  homepage: "",
  path:
    "M.803 14.8169c0-.5342.433-.9665.9665-.9665.5335 0 .9665.4323.9665.9665 0 .5335-.433.9657-.9665.9657-.5335 0-.9666-.4322-.9666-.9657m2.736 0c0-.1963-.0532-.376-.1119-.5525-.2344-.7024-.876-1.2169-1.6575-1.2169-.1249 0-.2344.0465-.3524.0708C.6149 13.2865 0 13.9646 0 14.817c0 .9764.7923 1.7694 1.7695 1.7694.9772 0 1.7694-.793 1.7694-1.7694m-1.7694-7.149c.5335 0 .9665.433.9665.9665 0 .5335-.433.9665-.9665.9665-.5343 0-.9666-.433-.9666-.9665 0-.5335.4323-.9665.9666-.9665m0 2.7359c.9772 0 1.7694-.7923 1.7694-1.7694 0-.1956-.0532-.376-.1119-.5525-.2344-.7024-.8767-1.2169-1.6575-1.2169-.1249 0-.2344.0465-.3524.0716C.6149 7.104 0 7.782 0 8.6344c0 .9771.7923 1.7694 1.7695 1.7694m13.221-5.694c-.5342 0-.9665-.433-.9665-.9664a.966.966 0 01.9666-.9665c.5335 0 .9658.4322.9658.9665 0 .5334-.4323.9664-.9658.9664m-9.6 16.5133c-.5335 0-.9666-.433-.9666-.9665 0-.5342.433-.9665.9666-.9665a.966.966 0 01.9665.9665c0 .5335-.4323.9665-.9665.9665m9.6-19.2491c-.978 0-1.7695.7922-1.7695 1.7694 0 .2085.0525.4025.1187.5882L5.039 18.5581c-.803.1681-1.4179.8462-1.4179 1.6985 0 .9772.7923 1.7694 1.7695 1.7694.9772 0 1.7694-.7922 1.7694-1.7694 0-.1963-.0525-.3759-.111-.5525l8.3427-14.2728c.7778-.1865 1.3683-.8531 1.3683-1.688 0-.977-.793-1.7693-1.7694-1.7693m7.24 2.7359c-.5343 0-.9666-.433-.9666-.9665a.966.966 0 01.9665-.9665c.5335 0 .9666.4322.9666.9665 0 .5334-.433.9665-.9666.9665M12.6313 21.223c-.5343 0-.9665-.433-.9665-.9665a.966.966 0 01.9665-.9665c.5335 0 .9658.4323.9658.9665 0 .5335-.4323.9665-.9658.9665M22.2305 1.974c-.9772 0-1.7694.7922-1.7694 1.7694 0 .2085.0525.4025.1187.5882l-8.3009 14.2265c-.8021.1681-1.417.8462-1.417 1.6985 0 .9772.7922 1.7694 1.7694 1.7694.9764 0 1.7687-.7922 1.7687-1.7694 0-.1963-.0525-.3759-.1111-.5525l8.3427-14.2728C23.4094 5.2448 24 4.5782 24 3.7433c0-.977-.7923-1.7693-1.7695-1.7693",
  fileExtensions: [],
  server: null,
};

const RETIREJS: MarketplaceExtension = {
  id: "retirejs",
  name: "Retire.js",
  version: "3",
  colour: "#e74c3c",
  kind: "tool",
  removable: true,
  summary: "Flag JavaScript libraries with known vulnerabilities",
  description:
    "Scans the client-side JavaScript and npm dependencies a project uses and reports the ones with known CVEs and the versions that were never patched. An application inherits the vulnerabilities of every library it ships, and this is how you see them.\n\nIt installs as a Node command and runs over a project or a URL.",
  provides: ["Known CVEs in JS libraries", "Scans a project or a URL"],
  homepage: "",
  path:
    "M12 2 3 6.5v11L12 22l9-4.5v-11L12 2zm0 2.3 6.5 3.2L12 10.7 5.5 7.5 12 4.3zM5 9.2l6 3v7.3l-6-3V9.2zm14 0v7.3l-6 3v-7.3l6-3z",
  fileExtensions: [],
  server: null,
};





const CYBERCHEF: MarketplaceExtension = {
  id: "cyberchef",
  name: "CyberChef",
  version: "10",
  colour: "#f6a821",
  kind: "tool",
  removable: true,
  summary: "The cyber Swiss-army knife for encoding, encryption and analysis",
  description:
    "A workbench of over three hundred operations you chain into a recipe: decode Base64 and URL encoding, decrypt AES and RC4, parse JWTs, unpack gzip, run regular expressions, diff, and defang. It is where a captured token or a suspicious blob gets taken apart.\n\nWide opens the standalone build in its own tab. The download is fetched once when you install it, so nothing leaves your machine while you work.",
  provides: ["Over 300 chainable operations", "Opens in its own tab", "Runs fully offline"],
  homepage: "https://gchq.github.io/CyberChef",
  path:
    "M10 2h4v2h-1v3.6l5.7 9.9A2 2 0 0 1 17 20H7a2 2 0 0 1-1.7-2.5L11 7.6V4h-1V2zm2 8-2.6 4.5h5.2L12 10z",
  fileExtensions: [],
  server: null,
};

const WAPPALYZER: MarketplaceExtension = {
  id: "wappalyzer",
  name: "Wappalyzer",
  version: "1",
  colour: "#4608ad",
  kind: "tool",
  removable: true,
  summary: "Identify the technologies a website is built with",
  description:
    "Fingerprints frameworks, servers, analytics, CMSs and libraries from a page's headers, cookies, markup and scripts. Knowing a target runs a particular CMS or framework version points straight at the checks worth running next.\n\nWide detects live in its own browser as you navigate, and passively over everything the Catcher proxy has already captured. The open webappanalyzer ruleset is downloaded when you install it.",
  provides: ["Live detection in the browser", "Passive detection over proxy traffic", "Versions and categories"],
  homepage: "https://www.wappalyzer.com",
  path:
    "M12 3 3 7.5 12 12l9-4.5L12 3zm-7 7 7 3.5 7-3.5v4L12 18l-7-4v-4z",
  fileExtensions: [],
  server: null,
};

const JS_MINER: MarketplaceExtension = {
  id: "js-miner",
  name: "JS Miner",
  version: "1",
  colour: "#d4a017",
  kind: "tool",
  removable: true,
  summary: "Mine captured JavaScript for endpoints, secrets and dependencies",
  description:
    "Reads the JavaScript the Catcher proxy has captured and pulls out what a review cares about: hidden API endpoints and paths, leaked keys and tokens, and the third-party libraries and their versions.\n\nBundles routinely ship more of an application's surface than the site ever links to. This turns that surface into a list you can act on, with no extra requests sent.",
  provides: ["Endpoints and paths from bundles", "Leaked keys and tokens", "Libraries and versions"],
  homepage: "",
  path:
    "M14 2 7 9l-2-2-3 3 8 8 3-3-2-2 7-7-4-4zm0 2.8L17.2 8 12 13.2 8.8 10 14 4.8zM7 11.8 12.2 17 11 18.2 5.8 13 7 11.8z",
  fileExtensions: [],
  server: null,
};

const SELECTOR_TEST: MarketplaceExtension = {
  id: "selector-test",
  name: "Selector Test",
  version: "1",
  colour: "#3fae5a",
  kind: "tool",
  removable: true,
  summary: "Try CSS and XPath selectors against the live page and highlight matches",
  description:
    "Type a CSS or XPath selector and see how many elements it matches in Wide's browser, with each match outlined on the page and listed with its tag and text. It is the fast way to build the selector a scraper or an automation step will rely on.\n\nEverything runs against the page already open in the browser, so there is nothing to install or send.",
  provides: ["CSS and XPath against the live page", "Highlights every match", "Lists tag, text and attributes"],
  homepage: "",
  path:
    "M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 2.5a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm0 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  fileExtensions: [],
  server: null,
};

const DEBUG_MARK =
  "M12 4a4 4 0 0 1 4 4v1h2a1 1 0 1 1 0 2h-2v2h2a1 1 0 1 1 0 2h-2v1a4 4 0 0 1-8 0v-1H6a1 1 0 1 1 0-2h2v-2H6a1 1 0 1 1 0-2h2V8a4 4 0 0 1 4-4z";

const PYTHON_DEBUGGER: MarketplaceExtension = {
  id: "python-debugger",
  name: "Python Debugger",
  version: "1",
  colour: "#ffd343",
  kind: "tool",
  removable: true,
  summary: "Breakpoints and stepping for Python, powered by debugpy",
  description:
    "Debug a .py file the way you already debug JavaScript in Wide: set breakpoints in the gutter, press Debug, and the program stops there so you can step over/into/out, read the call stack and every variable live, and evaluate expressions in the console — no more print statements.\n\nIt runs Python under debugpy over the Debug Adapter Protocol, installed for you with pip. Installs automatically when you add the Python language extension, and needs that extension to be present.",
  provides: ["Breakpoints, stepping and live variables in .py files", "Runs Python under debugpy (DAP)"],
  homepage: "",
  path: DEBUG_MARK,
  fileExtensions: [],
  server: null,
};

const GO_DEBUGGER: MarketplaceExtension = {
  id: "go-debugger",
  name: "Go Debugger",
  version: "1",
  colour: "#00add8",
  kind: "tool",
  removable: true,
  summary: "Breakpoints and stepping for Go, powered by Delve",
  description:
    "Debug a .go file from the Debug panel: breakpoints, step over/into/out, the call stack, live variables and expression evaluation — through Delve's native DAP mode.\n\nInstalled for you with `go install`. Installs automatically when you add the Go language extension, and needs that extension to be present.",
  provides: ["Breakpoints, stepping and live variables in .go files", "Runs Go under Delve (dlv dap)"],
  homepage: "",
  path: DEBUG_MARK,
  fileExtensions: [],
  server: null,
};

const RUBY_DEBUGGER: MarketplaceExtension = {
  id: "ruby-debugger",
  name: "Ruby Debugger",
  version: "1",
  colour: "#cc342d",
  kind: "tool",
  removable: true,
  summary: "Breakpoints and stepping for Ruby, powered by the debug gem",
  description:
    "Debug a .rb file from the Debug panel: breakpoints, stepping, the call stack, live variables and expression evaluation — through Ruby's debug gem (rdbg) in DAP mode.\n\nInstalled for you with `gem install debug`. Installs automatically when you add the Ruby language extension, and needs that extension to be present.",
  provides: ["Breakpoints, stepping and live variables in .rb files", "Runs Ruby under the debug gem (rdbg)"],
  homepage: "",
  path: DEBUG_MARK,
  fileExtensions: [],
  server: null,
};

const LANGUAGES: readonly MarketplaceExtension[] = SYSTEM_EXTENSIONS.map((language) => ({
  ...language,
  kind: "language" as const,
  removable: true,
  provides: ["Syntax highlighting", "Outline and structure", "Language server, installed for you"],
  homepage: "",
}));


export const CATALOGUE: readonly MarketplaceExtension[] = [
  AI_ASSISTANT,
  TRUFFLEHOG,
  NUCLEI,
  FFUF,
  KATANA,
  HTTPX,
  DALFOX,
  SUBFINDER,
  INTERACTSH,
  SQLMAP,
  SECLISTS,
  COMMIX,
  ARJUN,
  SUBLIST3R,
  SECRETFINDER,
  JWT_TOOL,
  CURLCONVERTER,
  RETIREJS,
  CYBERCHEF,
  WAPPALYZER,
  JS_MINER,
  SELECTOR_TEST,
  PYTHON_DEBUGGER,
  GO_DEBUGGER,
  RUBY_DEBUGGER,
  CODEBERG,
  GITHUB,
  COMMENT_CLEANER,
  ...LANGUAGES,
];

export const extensionById = (id: string): MarketplaceExtension | null =>
  CATALOGUE.find((extension) => extension.id === id) ?? null;



const OWNER_BY_SUFFIX = new Map<string, string>();
for (const entry of CATALOGUE) {
  for (const suffix of entry.fileExtensions) {
    if (!OWNER_BY_SUFFIX.has(suffix)) OWNER_BY_SUFFIX.set(suffix, entry.id);
  }
}


export function languageExtensionFor(path: string): string | null {
  const name = path.toLowerCase().replace(/^.*[\\/]/, "");
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return OWNER_BY_SUFFIX.get(name.slice(dot + 1)) ?? null;
}
