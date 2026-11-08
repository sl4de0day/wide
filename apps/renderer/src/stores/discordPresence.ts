import { bridge, type DiscordActivity } from "@/lib/bridge";
import { useEditor } from "./editor";
import { useWorkspace } from "./workspace";
import { useExtensions } from "./extensions";

const WIDE_LOGO_URL = "https://raw.githubusercontent.com/sl4de0day/wide/main/assets/logo.png";

const I8 = "https://img.icons8.com/color/48/000000/";
const I8B = "https://img.icons8.com/color/48/";

const LANGUAGE_MAP: Record<string, { name: string; icon: string }> = {
  ts:         { name: "TypeScript",          icon: I8  + "typescript.png" },
  tsx:        { name: "TypeScript React",    icon: "https://img.icons8.com/office/48/react.png" },
  js:         { name: "JavaScript",          icon: I8  + "javascript--v1.png" },
  jsx:        { name: "JavaScript React",    icon: "https://img.icons8.com/office/48/react.png" },
  mjs:        { name: "JavaScript",          icon: I8  + "javascript--v1.png" },
  cjs:        { name: "JavaScript (Node)",   icon: I8  + "nodejs.png" },
  py:         { name: "Python",              icon: I8  + "python--v1.png" },
  rs:         { name: "Rust",               icon: "https://img.icons8.com/external-tal-revivo-color-tal-revivo/48/external-rust-is-a-multi-paradigm-system-programming-language-logo-color-tal-revivo.png" },
  go:         { name: "Go",                 icon: I8  + "golang.png" },
  c:          { name: "C",                  icon: I8  + "c-programming.png" },
  h:          { name: "C Header",            icon: I8  + "c-programming.png" },
  cpp:        { name: "C++",               icon: I8  + "c-plus-plus-logo.png" },
  cc:         { name: "C++",               icon: I8  + "c-plus-plus-logo.png" },
  cxx:        { name: "C++",               icon: I8  + "c-plus-plus-logo.png" },
  hpp:        { name: "C++ Header",          icon: I8  + "c-plus-plus-logo.png" },
  cs:         { name: "C#",                icon: I8  + "c-sharp-logo.png" },
  java:       { name: "Java",               icon: I8  + "java-coffee-cup-logo.png" },
  kt:         { name: "Kotlin",              icon: I8  + "kotlin.png" },
  kts:        { name: "Kotlin Script",       icon: I8  + "kotlin.png" },
  html:       { name: "HTML",               icon: I8  + "html-5--v1.png" },
  htm:        { name: "HTML",               icon: I8  + "html-5--v1.png" },
  css:        { name: "CSS",                icon: I8  + "css3.png" },
  scss:       { name: "SCSS",               icon: "https://img.icons8.com/color/48/sass.png" },
  sass:       { name: "Sass",               icon: "https://img.icons8.com/color/48/sass.png" },
  less:       { name: "Less",               icon: I8B + "source-code.png" },
  json:       { name: "JSON",               icon: I8B + "json.png" },
  jsonc:      { name: "JSON",               icon: I8B + "json.png" },
  md:         { name: "Markdown",            icon: "https://img.icons8.com/offices/48/markdown.png" },
  mdx:        { name: "MDX",                icon: "https://img.icons8.com/offices/48/markdown.png" },
  sql:        { name: "SQL",                icon: I8B + "sql.png" },
  php:        { name: "PHP",                icon: "https://img.icons8.com/offices/48/php-logo.png" },
  rb:         { name: "Ruby",               icon: I8  + "ruby-programming-language.png" },
  sh:         { name: "Shell Script",        icon: "https://img.icons8.com/color/48/console.png" },
  bash:       { name: "Bash Script",         icon: "https://img.icons8.com/color/48/console.png" },
  zsh:        { name: "Zsh Script",          icon: "https://img.icons8.com/color/48/console.png" },
  fish:       { name: "Fish Script",         icon: "https://img.icons8.com/color/48/console.png" },
  ps1:        { name: "PowerShell",          icon: "https://img.icons8.com/fluency/48/powershell.png" },
  psm1:       { name: "PowerShell Module",   icon: "https://img.icons8.com/fluency/48/powershell.png" },
  vue:        { name: "Vue",                icon: I8  + "vue-js.png" },
  svelte:     { name: "Svelte",              icon: I8  + "vue-js.png" },  // closest available PNG
  dart:       { name: "Dart",               icon: I8  + "dart.png" },
  swift:      { name: "Swift",               icon: I8  + "swift.png" },
  yaml:       { name: "YAML",               icon: I8B + "source-code.png" },
  yml:        { name: "YAML",               icon: I8B + "source-code.png" },
  toml:       { name: "TOML",               icon: I8  + "settings--v1.png" },
  ini:        { name: "INI Config",          icon: I8  + "settings--v1.png" },
  conf:       { name: "Config File",         icon: I8  + "settings--v1.png" },
  cfg:        { name: "Config File",         icon: I8  + "settings--v1.png" },
  lua:        { name: "Lua",                icon: I8  + "lua-language.png" },
  graphql:    { name: "GraphQL",             icon: I8B + "graphql.png" },
  gql:        { name: "GraphQL",             icon: I8B + "graphql.png" },
  ex:         { name: "Elixir",              icon: I8B + "source-code.png" },
  exs:        { name: "Elixir Script",       icon: I8B + "source-code.png" },
  erl:        { name: "Erlang",              icon: I8B + "source-code.png" },
  scala:      { name: "Scala",              icon: "https://img.icons8.com/dusk/48/scala.png" },
  hs:         { name: "Haskell",             icon: I8B + "source-code.png" },
  r:          { name: "R",                  icon: I8B + "source-code.png" },
  xml:        { name: "XML",                icon: I8B + "xml-file.png" },
  svg:        { name: "SVG",                icon: I8  + "image.png" },
  dockerfile: { name: "Dockerfile",          icon: I8  + "docker.png" },
  tf:         { name: "Terraform",           icon: I8B + "settings.png" },
  hcl:        { name: "HCL",                icon: I8B + "settings.png" },
  env:        { name: "Environment File",    icon: I8  + "settings--v1.png" },
  lock:       { name: "Lockfile",            icon: I8B + "settings.png" },
  txt:        { name: "Plain Text",          icon: I8B + "document.png" },
  log:        { name: "Log File",            icon: I8B + "document.png" },
  gitignore:  { name: "Git Ignore",          icon: I8B + "git.png" },
};

function getLanguageInfo(filePath: string): { name: string; icon: string } {
  const base = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (base === "dockerfile") return LANGUAGE_MAP.dockerfile;

  const ext = base.split(".").pop() ?? "";
  return LANGUAGE_MAP[ext] ?? {
    name: ext ? `${ext.toUpperCase()} File` : "Source Code",
    icon: "https://cdn.jsdelivr.net/gh/devicons/devicon/icons/devicon/devicon-original.svg",
  };
}

let sessionStartTimestamp = Math.floor(Date.now() / 1000);
let lastWorkspace: string | null = null;

export function subscribeDiscordPresence(): () => void {
  const updatePresence = () => {
    const installed = useExtensions.getState().installed.has("discord-presence");
    if (!installed) {
      void bridge.discordClear();
      return;
    }

    const workspace = useWorkspace.getState();
    const editor = useEditor.getState();
    const activeTab = editor.tabs.find((tab) => tab.path === editor.activePath) ?? null;

    const rootName = workspace.rootName || (workspace.root ? workspace.root.split(/[\\/]/).pop() : null);

    if (rootName && rootName !== lastWorkspace) {
      lastWorkspace = rootName;
      sessionStartTimestamp = Math.floor(Date.now() / 1000);
    }

    let details = "Idling in Workspace";
    let smallImage: string | undefined;
    let smallText: string | undefined;

    if (activeTab) {
      if (activeTab.kind === "file") {
        details = `Editing ${activeTab.name}`;
        const lang = getLanguageInfo(activeTab.path || activeTab.name);
        smallImage = lang.icon;
        smallText = lang.name;
      } else if (activeTab.kind === "ai-chat") {
        details = "Chatting with AI Assistant";
        smallText = "AI Assistant";
      } else if (activeTab.kind === "browser") {
        details = "Browsing Web Targets";
        smallText = "Security Browser";
      } else if (activeTab.kind === "catcher") {
        details = "Analyzing HTTP Traffic (Catcher)";
        smallText = "HTTP Catcher";
      } else if (activeTab.kind === "pitcher") {
        details = "Crafting HTTP Requests (Pitcher)";
        smallText = "HTTP Pitcher";
      } else if (activeTab.kind === "cyberchef") {
        details = "Transforming Data (CyberChef)";
        smallText = "CyberChef";
      } else if (activeTab.kind === "settings") {
        details = "Configuring Settings";
        smallText = "Settings";
      } else if (activeTab.kind === "diff") {
        details = `Comparing: ${activeTab.name}`;
        smallText = "Diff Viewer";
      } else if (activeTab.kind === "markdown-preview") {
        details = `Previewing: ${activeTab.name}`;
        smallText = "Markdown Preview";
      } else if (activeTab.kind === "scratchpad") {
        details = "Taking Notes (Scratchpad)";
        smallText = "Scratchpad";
      } else if (activeTab.kind === "media") {
        details = `Viewing Media: ${activeTab.name}`;
        smallText = "Media Viewer";
      } else {
        details = `Viewing ${activeTab.name}`;
        smallText = activeTab.name;
      }
    } else if (!rootName) {
      details = "Idling";
    }

    const state = rootName ? `Workspace: ${rootName}` : "No Workspace Open";

    const activity: DiscordActivity = {
      details,
      state,
      startTimestamp: sessionStartTimestamp,
      largeImage: WIDE_LOGO_URL,
      largeText: "Wide — Security-first IDE",
      smallImage,
      smallText,
    };

    void bridge.discordSetActivity(activity);
  };

  const unsubExtensions = useExtensions.subscribe((state, prevState) => {
    const wasInstalled = prevState.installed.has("discord-presence");
    const isInstalled = state.installed.has("discord-presence");
    if (wasInstalled !== isInstalled) {
      updatePresence();
    }
  });

  const unsubWorkspace = useWorkspace.subscribe(() => {
    updatePresence();
  });

  const unsubEditor = useEditor.subscribe(() => {
    updatePresence();
  });

  updatePresence();

  return () => {
    unsubExtensions();
    unsubWorkspace();
    unsubEditor();
    void bridge.discordClear();
  };
}

