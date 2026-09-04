



export type Disposer = () => void;
export type Subscriber<T> = (handler: (payload: T) => void) => Disposer;





export type HttpResponse =
  | {
      ok: true;
      status: number;
      statusText: string;
      headers: [string, string][];
      body: string;
      bytes: number;
      truncated: boolean;
      ms: number;
      url: string;
    }
  | { ok: false; error: string };

export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface FileRead {
  path: string;
  tooLarge: boolean;
  size: number;
  content: string;
  error?: string;
}



export type ServerState =
  | "present"
  | "installed"
  | "no-manager"
  | "failed"
  | "manual"
  | "none";

export interface ServerRecord {
  command: string;
  path: string;
  state: ServerState;

  manager?: string;

  detail?: string;
}


export interface ExtensionSettingsRecord {

  values: Record<string, string | number | boolean>;

  serverCommand: string;

  init: Record<string, string | number | boolean>;

  env: Record<string, string>;
}

export type RecentKind = "folder" | "file" | "workflow";

export interface Project {
  path: string;
  name: string;
  openedAt?: number;
  missing?: boolean;

  kind?: RecentKind;
}


export interface WorkflowFolder {
  path: string;

  name: string;
  missing?: boolean;
}


export interface Workflow {
  path: string;
  name: string;
  folders: WorkflowFolder[];
  settings: Record<string, unknown>;
}

export interface Recents {
  projects: Project[];
}

export interface SearchMatch {
  line: number;
  column: number;
  length: number;
  preview: string;
}

export interface SearchFile {
  path: string;
  relativePath: string;
  matches: SearchMatch[];
}

export interface SearchResult {
  files: SearchFile[];
  total: number;
  truncated: boolean;
  error?: string;
}

export interface GitFile {
  path: string;
  index: string;
  worktree: string;
  staged: boolean;
}

export interface GitStatus {
  available: boolean;
  branch?: string;
  files?: GitFile[];
  reason?: string;
}

export interface ProjectFile {
  path: string;
  relativePath: string;
}

export interface Diagnostic {
  from: number;
  to: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  code?: number;
}

export interface TerminalSession {
  id: number;
  shell: string;
  error?: string;
}

export interface TerminalData {
  id: number;
  text: string;
}

export interface TerminalExit {
  id: number;
  code: number;
}

export interface EngineStatus {
  running: boolean;
  port: number;
  url: string;
  root: string;
  requests: number;
  clients: number;
  accelerated?: boolean;
  uptime_ms?: number;
}

export interface SssfStatus {
  ok: boolean;
  degraded: boolean;
  lastError: string | null;
  counters: Record<string, number>;
  diagnostics: unknown[];
  capabilities: SssfCapability[];
  profile?: string | null;
  mode?: string | null;
  failMode?: string | null;
  projectRoot?: string | null;
  policyPath?: string | null;
  policyHash?: string | null;
  compiledAt?: number | null;
  stats?: { capabilities: number; rules: number } | null;
}


export interface SssfCapability {
  name: string;
  describe: string;
  rules: number;

  limit: string | null;
  audit: string;
}



export interface SssfRecord {
  v?: number;
  seq?: number;
  at?: string;
  subject?: "user" | "ai" | "system";
  capability?: string;
  decision?: "allow" | "deny";
  enforced?: boolean;
  mode?: string;
  reason?: string;

  rule?: number;
  channel?: string;
  tool?: string;
  target?: string | null;
  limited?: boolean;
  approval?: boolean;
  policy?: string;
  values?: Record<string, unknown>;

  p?: string;
  h?: string;

  malformed?: boolean;
  line?: string;
}


export interface SssfVerdict {
  ok: boolean;
  chained: boolean;
  records: number;

  brokenAt: number | null;
  reason?: string;
}



export interface BrowserEvent {

  tabId?: string;
  url?: string;
  title?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  loading?: boolean;

  favicon?: string;

  devtoolsToggle?: boolean;

  exitFullscreen?: boolean;

  download?: { url: string; path: string };
}


export interface OastInteraction {
  protocol?: string;
  "unique-id"?: string;
  "full-id"?: string;
  "raw-request"?: string;
  "raw-response"?: string;
  "remote-address"?: string;
  timestamp?: string;
  [key: string]: unknown;
}



export interface ProxyEntry {
  id: number;
  at: number;
  ms: number;
  method: string;
  url: string;
  host: string;
  scheme: "http" | "https";
  status: number;
  reqHeaders: [string, string][];
  reqBody: string;
  reqTruncated?: boolean;
  resHeaders: [string, string][];
  resBody: string;
  resTruncated?: boolean;
  error?: string;

  websocket?: boolean;
  frames?: ProxyWsFrame[];
}


export interface ProxyWsFrame {
  id: number;
  direction: "up" | "down";
  kind: "text" | "binary" | "close";
  at?: number;
  text?: string;
  bytes?: number;
}


export interface WsEvent {
  id: string;
  type: "open" | "message" | "close" | "error";
  data?: string;
  code?: number;
  reason?: string;
  binary?: boolean;
}


export interface SseEvent {
  id: string;
  type: "open" | "message" | "error" | "close";
  event?: string;
  data?: string;
  lastEventId?: string;
}


export interface GrpcService {
  name: string;
  methods: {
    name: string;
    requestStream: boolean;
    responseStream: boolean;
    requestType: string;
    responseType: string;
  }[];
}


export interface GrpcEvent {
  id: string;
  type: "data" | "end" | "error";
  data?: unknown;
  error?: string;
}

export interface GrpcCallArgs {
  loadId: string;
  target: string;
  service: string;
  method: string;
  message: unknown;
  metadata?: Record<string, string>;
  tls?: boolean;
}


export interface MacroStep {
  method: string;
  url: string;
  headers: [string, string][];
  body: string;
}


export interface MacroExtract {
  name: string;
  source: "body" | "header";
  pattern: string;
}


export interface MacroStepResult {
  ok: boolean;
  status?: number;
  ms?: number;
  error?: string;
}


export interface MatchReplaceRule {
  id: string;
  enabled: boolean;
  target: "req-header" | "req-body" | "res-header" | "res-body";
  match: string;
  replace: string;
  regex: boolean;
}


export interface InterceptedRequest {
  id: number;
  method: string;
  host: string;
  scheme: string;
  url: string;
  headers: [string, string][];
  body: string;
}


export interface InterceptedResponse {
  id: number;
  status: number;
  statusText: string;
  host: string;
  url: string;
  headers: [string, string][];
  body: string;
  truncated?: boolean;
}


export interface CodeSpan {
  start: number;
  length: number;

  write?: boolean;
}


export interface CodeLocation extends CodeSpan {
  file: string;
}


export interface ProjectScanFinding {
  ruleId: string;
  cwe: string;
  severity: "error" | "warning" | "info";
  message: string;

  file: string;
  line: number;
  col: number;

  relatedFile?: string;
  relatedLine?: number;
}


export interface SignatureInfo {
  label: string;
  parameters: { label: string; documentation?: string }[];
  documentation?: string;
}


export interface SignatureHelp {
  signatures: SignatureInfo[] | null;
  activeSignature?: number;
  activeParameter?: number;
}


export interface EditsForFile {
  file: string;
  edits: { start: number; length: number; newText: string }[];
}



export interface OutlineNode {
  name: string;
  kind: string | number;
  offset: number;
  children: OutlineNode[];
}


export interface SymbolHit {
  name: string;
  kind: string | number;
  file: string;

  line: number;
  container: string;
}



export interface CodeAction {
  kind: string;
  title: string;
  files?: EditsForFile[];
  refactor?: string;
  action?: string;
}


export interface DebugFrame {
  id: string;
  name: string;
  url: string;
  line: number;
  column: number;
  scopes: { type: string; name: string; objectId?: string }[];
}


export interface RemoteConfig {

  enabled?: boolean;

  host?: string;

  remotePath?: string;

  node?: string;


  currentlyRemote?: boolean;
}


export interface DebugProperty {
  name: string;
  value: string;

  objectId: string | null;
}



export type DebugEvent =
  | { type: "paused"; reason: string; frames: DebugFrame[] }
  | { type: "resumed" }
  | { type: "console"; level: string; text: string }
  | { type: "output"; stream: "stdout" | "stderr"; text: string }
  | { type: "exited"; code: number }
  | { type: "closed" };

export type Ok<T = unknown> = { ok: boolean; error?: string } & Partial<T>;






export interface CodebergFile {
  path: string;

  index: string;

  work: string;

  from?: string;
}

export interface CodebergBranch {
  name: string;
  upstream: string;
  ahead: number;
  behind: number;
  detached: boolean;
}

export interface CodebergStatus {

  installed: boolean;

  available?: boolean;

  reason?: string;

  repository?: boolean;
  ok?: boolean;
  branch?: CodebergBranch;
  files?: CodebergFile[];
  remote?: string;

  codeberg?: boolean;
  identity?: { name: string; email: string };
  error?: string;
}

export interface CodebergCommit {
  hash: string;
  author: string;
  when: string;
  subject: string;
}


export interface PickedFile {
  path: string;
  name: string;
  dir: string;
  dirName: string;
}


export type AiEvent =
  | { id: string; type: "text"; text: string }
  | { id: string; type: "thinking"; text: string }
  | { id: string; type: "tool_start"; name: string; input: unknown }
  | { id: string; type: "tool_end"; name: string; result: string }
  | { id: string; type: "usage"; input: number; output: number; total: number }
  | { id: string; type: "error"; message: string }
  | { id: string; type: "done" }

  | { id: string; type: "open"; path: string; line: number }
  | { id: string; type: "edit"; root?: string; path: string; content: string };


export interface AiSessionMeta {
  id: string;

  title: string;
  createdAt: number;
  updatedAt: number;
  count: number;
}


export interface AiSession extends Omit<AiSessionMeta, "count"> {
  root: string;
  messages: AiMessage[];
}


export interface AiPullEvent {
  reference: string;
  status: string;
  total?: number;
  completed?: number;
  error?: string;
}


export interface AiSearchResult {
  source: "huggingface" | "ollama";
  id: string;
  name: string;
  downloads: number;
  likes: number;
  updated: string;
  gated: boolean;
}


export interface AiModelFile {
  path: string;
  size: number;
  quant: string;
  split: number;
  reference: string;

  fit?: "gpu" | "cpu" | "no" | "unknown";
}

export interface AiHardware {
  totalRam: number;
  vram: number;
  gpu: string;
}

export interface AiMessage {
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  [extra: string]: unknown;
}

export interface AiConfig {
  tab: "cloud" | "local";
  provider: string;
  cloudModel: Record<string, string>;
  localModel: string;
  allowWrites: boolean;
}

export interface HostApi {
  platform: string;


  openFolder(): Promise<Project | null>;
  openFile(): Promise<PickedFile | null>;
  openWorkflow(path: string): Promise<Workflow | { error: string }>;
  createWorkflow(
    path: string,
    folders: { path: string; name: string }[],
  ): Promise<Workflow | { error: string }>;
  setWorkflowFolders(
    path: string,
    folders: { path: string; name: string }[],
  ): Promise<Workflow | { error: string }>;
  forgetRecent(path: string): Promise<Recents>;
  recentProjects(): Promise<Recents>;
  addRecentProject(path: string, name: string, kind?: RecentKind): Promise<Recents>;
  openRecentProject(path: string): Promise<Project | { error: string }>;

  openRecentFile(path: string): Promise<{ path: string; name: string } | { error: string }>;

  workspaceOpenTarget(
    path: string,
  ): Promise<{ kind: "folder" | "file"; path: string; name: string; file?: string } | { error: string }>;

  onHostOpenPath: Subscriber<{ path: string }>;

  requestPendingOpenPath(): void;

  watchWorkspace(root: string): Promise<Ok>;
  onFsChanged: Subscriber<{ root: string }>;


  readDir(path: string): Promise<DirEntry[]>;
  readFile(path: string): Promise<FileRead>;
  writeFile(path: string, content: string): Promise<{ path: string; error?: string }>;
  create(parentPath: string, name: string, kind: "file" | "folder"): Promise<{ path?: string; error?: string }>;
  rename(path: string, name: string): Promise<{ path?: string; error?: string }>;
  trash(path: string): Promise<{ path?: string; error?: string }>;
  move(sourcePath: string, targetDir: string): Promise<{ path?: string; error?: string }>;
  reveal(path: string): Promise<void>;


  searchInFiles(root: string, options: unknown): Promise<SearchResult>;

  listProjectFiles(root: string): Promise<{ files: { path: string; relativePath: string }[]; truncated?: boolean }>;

  replaceInFiles(
    root: string,
    options: unknown,
    replacement: string,
    exclude: string[],
  ): Promise<Ok<{ filesChanged?: number; replacements?: number; files?: string[] }>>;





  lspCapability(filePath: string): Promise<{ available: boolean; server?: string; command?: string }>;

  lspOpen(
    root: string,
    filePath: string,
    text: string,
  ): Promise<{ ok: true; server: string; command: string } | { ok: false; reason: string; detail?: string }>;
  lspChange(filePath: string, text: string): Promise<{ ok: boolean; reason?: string }>;
  lspClose(filePath: string): Promise<{ ok: boolean }>;
  lspCompletion(
    filePath: string,
    line: number,
    character: number,
  ): Promise<{ items: { label: string; kind: number | null; detail: string | null; sortText: string | null }[] }>;
  lspHover(filePath: string, line: number, character: number): Promise<{ text: string } | null>;


  lspDefinition(filePath: string, line: number, character: number): Promise<{ locations: CodeLocation[] }>;
  lspReferences(filePath: string, line: number, character: number): Promise<{ locations: CodeLocation[] }>;
  lspDocumentHighlights(filePath: string, line: number, character: number): Promise<{ spans: CodeSpan[] }>;
  lspSignatureHelp(filePath: string, line: number, character: number): Promise<SignatureHelp>;

  lspDocumentSymbol(filePath: string): Promise<{ symbols: OutlineNode[] }>;

  lspWorkspaceSymbol(filePath: string, query: string): Promise<{ items: SymbolHit[] }>;


  lspRename(
    filePath: string,
    line: number,
    character: number,
    newName: string,
  ): Promise<{ ok: boolean; files?: { file: string; edits: { start: number; length: number; newText: string }[] }[]; error?: string }>;
  lspStopAll(): Promise<{ ok: boolean }>;

  onLspDiagnostics: Subscriber<{ path: string; diagnostics: Diagnostic[]; server: string }>;



  lintFile(
    root: string,
    filePath: string,
    text: string,
  ): Promise<
    | { ok: true; diagnostics: Diagnostic[]; version?: string | null }
    | { ok: false; reason: string; detail?: string }
  >;

  formatText(
    filePath: string,
    text: string,
    root: string | null,
  ): Promise<
    | { ok: true; text: string; formatter: string }
    | { ok: false; error: string; unsupported?: boolean }
  >;

  httpSend(
    url: string,
    method: string,
    headers: [string, string][],
    body: string | null,
  ): Promise<HttpResponse>;
  projectTailwind(root: string): Promise<{
    usesTailwind: boolean;
    tokens: { name: string; value: string }[];
    filesScanned: number;
  }>;
  projectScripts(
    root: string,
  ): Promise<{
    scripts: { name: string; command: string; detail?: string | null; manifest?: string }[];
    packageName: string | null;
  }>;


  tsSync(root: string, file: string, content: string): Promise<{ ok: boolean }>;
  tsClose(file: string): Promise<{ ok: boolean }>;
  tsCompletions(root: string, file: string, position: number): Promise<{ entries: unknown[] }>;
  tsQuickInfo(root: string, file: string, position: number): Promise<unknown | null>;
  tsDiagnostics(root: string, file: string): Promise<{ diagnostics: Diagnostic[] }>;
  tsProjectDiagnostics(root: string): Promise<{ counts: Record<string, { errors: number; warnings: number }>; scanned: number }>;


  tsDefinition(root: string, file: string, position: number): Promise<{ span?: CodeSpan | null; locations: CodeLocation[] }>;
  tsReferences(root: string, file: string, position: number): Promise<{ locations: CodeLocation[] }>;

  tsSecurityScan(root: string): Promise<{ findings: ProjectScanFinding[] }>;

  securityScanProject(root: string): Promise<{ findings: ProjectScanFinding[] }>;


  securityRescanFile(root: string, file: string, content?: string): Promise<{ findings: ProjectScanFinding[] }>;
  tsDocumentHighlights(root: string, file: string, position: number): Promise<{ spans: CodeSpan[] }>;
  tsSignatureHelp(root: string, file: string, position: number): Promise<SignatureHelp>;

  tsNavigationTree(root: string, file: string): Promise<{ tree?: OutlineNode | null }>;

  tsNavigateTo(root: string, query: string): Promise<{ items: SymbolHit[] }>;


  tsRename(
    root: string,
    file: string,
    position: number,
  ): Promise<{
    canRename: boolean;
    displayName?: string;
    triggerSpan?: CodeSpan | null;
    locations?: (CodeLocation & { prefix?: string; suffix?: string })[];
    error?: string;
  }>;

  tsCodeActions(root: string, file: string, start: number, end: number, codes: number[]): Promise<{ actions: CodeAction[] }>;

  tsRefactorEdits(root: string, file: string, start: number, end: number, refactor: string, action: string): Promise<{ files: EditsForFile[]; error?: string }>;

  lspCodeActions(
    filePath: string,
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
    codes: number[],
  ): Promise<{ actions: CodeAction[] }>;


  terminalStart(options: { cols: number; rows: number; cwd?: string }): Promise<TerminalSession>;
  terminalWrite(id: number, data: string): Promise<unknown>;
  terminalResize(id: number, cols: number, rows: number): Promise<unknown>;
  terminalDispose(id: number): Promise<unknown>;
  onTerminalData: Subscriber<TerminalData>;
  onTerminalExit: Subscriber<TerminalExit>;


  setTitle(title: string): Promise<void>;



  browserNavigate(tabId: string, url: string): Promise<Ok<{ url?: string }>>;

  browserPlace(tabId: string, x: number, y: number, w: number, h: number, visible: boolean): void;

  browserActivate(tabId: string): void;
  browserBack(tabId: string): void;
  browserForward(tabId: string): void;
  browserReload(tabId: string): void;
  browserStop(tabId: string): void;

  browserClose(tabId: string): void;

  browserDevtools(open: boolean, activeUrl?: string): Promise<Ok<{ url?: string }>>;

  browserCdp(tabId: string, method: string, params?: Record<string, unknown>): Promise<Ok<{ result?: unknown }>>;

  devtoolsPlace(x: number, y: number, w: number, h: number, visible: boolean): void;

  browserFullscreen(on: boolean): void;
  onBrowserEvent: Subscriber<BrowserEvent>;

  oastStart(server: string, token: string): Promise<Ok<{ running?: boolean; domain?: string; server?: string }>>;
  oastStop(): Promise<Ok>;
  oastStatus(): Promise<Ok<{ installed?: boolean; running?: boolean; domain?: string; server?: string }>>;
  onOastInteraction: Subscriber<OastInteraction>;
  onOastStatus: Subscriber<{ running: boolean; domain: string; server: string }>;



  proxyStart(): Promise<Ok<{ port?: number; scope?: string[] }>>;
  proxyStop(): Promise<Ok>;
  proxyStatus(): Promise<
    Ok<{
      running?: boolean;
      port?: number;
      scope?: string[];
      intercepting?: boolean;
      interceptingResponses?: boolean;
      rules?: MatchReplaceRule[];
      held?: InterceptedRequest[];
      heldResponses?: InterceptedResponse[];
    }>
  >;

  proxyScope(scope?: string[]): Promise<Ok<{ scope?: string[] }>>;

  proxyTraffic(): Promise<Ok<{ entries?: ProxyEntry[] }>>;
  proxyClear(): Promise<Ok>;

  proxyCaCert(): Promise<Ok<{ pem?: string }>>;
  proxyCaCertPath(): Promise<Ok<{ path?: string }>>;

  proxyReplay(
    request: {
      method: string;
      url: string;
      headers: [string, string][];
      body: string;
    },
    options?: { followRedirects?: boolean },
  ): Promise<
    Ok<{
      status?: number;
      statusText?: string;
      headers?: [string, string][];
      body?: string;
      truncated?: boolean;
      ms?: number;
      bytes?: number;

      url?: string;

      redirects?: { status: number; url: string; location: string }[];
    }>
  >;

  onProxyTraffic: Subscriber<ProxyEntry[]>;
  onProxyWs: Subscriber<ProxyWsFrame[]>;

  wsConnect(id: string, url: string, protocols?: string[]): Promise<Ok<{ id: string }>>;
  wsSend(id: string, data: string): Promise<Ok<Record<string, never>>>;
  wsClose(id: string): Promise<Ok<Record<string, never>>>;
  onWsEvent: Subscriber<WsEvent>;

  sseOpen(id: string, url: string, headers?: Record<string, string>): Promise<Ok<{ id: string }>>;
  sseClose(id: string): Promise<Ok<Record<string, never>>>;
  onSseEvent: Subscriber<SseEvent>;

  grpcLoad(id: string, protoPath?: string, protoSource?: string): Promise<Ok<{ services: GrpcService[] }>>;
  grpcUnary(args: GrpcCallArgs): Promise<Ok<{ response: unknown; ms?: number }>>;
  grpcServerStream(args: GrpcCallArgs & { id: string }): Promise<Ok<{ id: string }>>;
  grpcCancel(id: string): Promise<Ok<Record<string, never>>>;
  onGrpcEvent: Subscriber<GrpcEvent>;

  proxyMatchReplace(rules: MatchReplaceRule[]): Promise<Ok<{ rules?: MatchReplaceRule[] }>>;


  proxySetIntercept(
    config: boolean | { request?: boolean; response?: boolean },
  ): Promise<Ok<{ intercepting?: boolean; interceptingResponses?: boolean }>>;

  proxyInterceptDecision(
    id: number,
    action: "forward" | "drop",
    edited?: { method?: string; headers?: [string, string][]; body?: string },
  ): Promise<Ok>;
  onProxyIntercept: Subscriber<InterceptedRequest>;

  proxyResponseDecision(
    id: number,
    action: "forward" | "drop",
    edited?: { status?: number; headers?: [string, string][]; body?: string },
  ): Promise<Ok>;
  onProxyInterceptResponse: Subscriber<InterceptedResponse>;

  proxyWsSend(id: number, direction: "up" | "down", text: string): Promise<Ok>;

  proxyRunMacro(macro: {
    steps: MacroStep[];
    extract?: MacroExtract[];
  }): Promise<Ok<{ cookies?: [string, string][]; tokens?: [string, string][]; results?: MacroStepResult[]; step?: number }>>;



  debugStart(
    cwd: string,
    file: string,
    breakpoints: { file: string; line: number; condition?: string }[],
  ): Promise<Ok<{ port?: number }>>;


  debugStartBrowser(breakpoints: { file: string; line: number; condition?: string }[], root?: string): Promise<Ok<{ port?: number; browser?: boolean }>>;
  debugStop(): Promise<Ok>;
  debugResume(): Promise<Ok>;
  debugStepOver(): Promise<Ok>;
  debugStepInto(): Promise<Ok>;
  debugStepOut(): Promise<Ok>;
  debugPause(): Promise<Ok>;
  debugPauseOnExceptions(state: "none" | "uncaught" | "all"): Promise<Ok>;

  debugProperties(objectId: string): Promise<{ properties: DebugProperty[] }>;


  debugEvaluate(callFrameId: string | null, expression: string): Promise<{ value: string; objectId?: string | null; error?: string }>;

  debugSetBreakpoint(file: string, line: number, on: boolean, id?: string | null, condition?: string): Promise<Ok<{ id?: string | null }>>;
  onDebugEvent: Subscriber<DebugEvent>;


  toolScanRun(root: string, command: string): Promise<Ok<{ output?: string; code?: number; timedOut?: boolean }>>;



  remoteGet(): Promise<Ok<{ config?: RemoteConfig }>>;

  remoteSet(config: RemoteConfig): Promise<Ok<{ config?: RemoteConfig }>>;



  updateCheck(manifestUrl: string): Promise<
    Ok<{
      configured?: boolean;
      current?: string;
      latest?: string;
      url?: string;
      notes?: string;
      available?: boolean;
    }>
  >;

  updateOpen(url: string): Promise<Ok>;
  updateDownload(url: string): Promise<Ok<{ path?: string; bytes?: number }>>;
  updateInstall(path: string): Promise<Ok>;
  onUpdateProgress: Subscriber<{ phase: string; state: string; bytes?: number; error?: string }>;
  openExternal(url: string): Promise<Ok>;



  sssfStatus(): Promise<Ok<{ status?: SssfStatus }>>;

  sssfTail(count?: number): Promise<Ok<{ records?: SssfRecord[] }>>;

  sssfVerify(): Promise<Ok<{ result?: SssfVerdict }>>;

  sssfReload(): Promise<Ok<{ status?: SssfStatus }>>;
  onSssfChanged: Subscriber<SssfStatus>;

  perfSample(): Promise<{ available: boolean } & Record<string, number>>;


  engineEntries(root: string): Promise<{ entries: unknown[] }>;
  engineStart(root: string, directory?: string): Promise<Ok>;
  engineStop(): Promise<Ok>;
  engineStatus(): Promise<EngineStatus>;
  engineReload(path?: string): Promise<{ reloaded: number }>;
  onEngineConsole: Subscriber<unknown>;
  onEnginePicked: Subscriber<{ nodeId: number }>;
  onEngineStale: Subscriber<{ reason?: string }>;
  onEngineNavigated: Subscriber<{ url: string }>;


  toolsList(root: string): Promise<Ok<{ tools: unknown[]; problems: unknown[]; dirs: { project: string; user: string } }>>;
  toolsRun(root: string, toolId: string, commandId: string, payload: unknown): Promise<Ok>;
  toolsCancel(runId: string): Promise<{ ok: boolean; cancelled: boolean }>;
  toolsReveal(root: string, toolId: string): Promise<Ok>;
  toolsScaffold(root: string, name: string): Promise<Ok>;
  onToolEvent: Subscriber<unknown>;


  extensionsList(): Promise<{ installed: string[]; optional: string[] }>;
  extensionInstall(id: string): Promise<Ok<{ installed: string[] }>>;
  extensionRemove(id: string): Promise<Ok<{ installed: string[] }>>;


  extensionPrepare(id: string): Promise<Ok<{ server: ServerRecord | null; cancelled?: boolean }>>;

  extensionCancelPrepare(id: string): Promise<Ok<{ cancelled?: boolean }>>;
  extensionServers(): Promise<Ok<{ servers: Record<string, ServerRecord | null> }>>;

  extensionGetSettings(): Promise<Ok<{ settings?: Record<string, ExtensionSettingsRecord> }>>;

  extensionSetSettings(id: string, record: ExtensionSettingsRecord): Promise<Ok>;



  aiConfig(patch?: Partial<AiConfig>): Promise<Ok<{ config?: AiConfig }>>;
  aiKeyStatus(): Promise<Ok<{ configured?: Record<string, boolean> }>>;
  aiSetKey(provider: string, key: string): Promise<Ok<{ configured?: boolean }>>;
  aiVerifyKey(provider: string, key: string): Promise<Ok<{ models?: string[] }>>;
  aiSessions(root: string): Promise<Ok<{ sessions?: AiSessionMeta[] }>>;
  aiSession(id: string): Promise<Ok<{ session?: AiSession }>>;
  aiNewSession(root: string): Promise<Ok<{ session?: AiSession }>>;
  aiSaveSession(id: string, root: string, messages: AiMessage[]): Promise<Ok<{ session?: AiSessionMeta }>>;
  aiDeleteSession(id: string): Promise<Ok>;
  aiSend(request: {
    id: string;
    root: string;
    provider: string;
    model: string;
    messages: AiMessage[];
    system: string;
  }): Promise<Ok<{ answered?: boolean }>>;
  aiStop(id: string): Promise<Ok<{ stopped?: boolean }>>;

  aiComplete(prefix: string, suffix: string, language: string): Promise<Ok<{ text?: string }>>;


  aiCommitFile(root: string, path: string, content: string): Promise<Ok<{ path?: string }>>;
  aiSearch(query: string, limit?: number): Promise<Ok<{ results?: AiSearchResult[]; failed?: string[] }>>;
  aiFiles(source: string, id: string): Promise<Ok<{ files?: AiModelFile[] }>>;
  aiRecommended(): Promise<
    Ok<{ models?: { label: string; vendor: string; query: string; found: boolean; id?: string }[]; hardware?: AiHardware }>
  >;
  aiLocalStatus(): Promise<
    Ok<{
      running?: boolean;
      installed?: boolean;
      models?: { name: string; size: number; quantization: string; parameters: string }[];
      hardware?: AiHardware;
    }>
  >;
  aiLocalSetup(): Promise<Ok<{ state?: string }>>;
  aiLocalPull(reference: string): Promise<Ok<{ reference?: string }>>;
  aiLocalRemove(name: string): Promise<Ok>;



  aiClaudeCodeStatus(): Promise<Ok<{ installed?: boolean; path?: string; signedIn?: boolean }>>;
  aiClaudeCodeInstall(): Promise<Ok<{ path?: string }>>;
  aiClaudeCodeLogin(): Promise<Ok<{ started?: boolean }>>;
  onAiEvent: Subscriber<AiEvent>;
  onAiPull: Subscriber<AiPullEvent>;


  stripComments(
    root: string,
    path: string,
    text: string,
  ): Promise<Ok<{ text?: string; removed?: number; language?: string; reason?: string }>>;
  commentLanguage(path: string): Promise<Ok<{ language?: string | null }>>;

  codebergStatus(root: string): Promise<CodebergStatus>;
  codebergStage(root: string, paths: string[]): Promise<Ok>;
  codebergUnstage(root: string, paths: string[]): Promise<Ok>;
  codebergCommit(root: string, message: string, amend?: boolean): Promise<Ok<{ head?: string; reason?: string }>>;
  codebergPush(root: string, withTags?: boolean): Promise<Ok<{ branch?: string; reason?: string; tagsFailed?: string }>>;
  codebergPull(root: string): Promise<Ok<{ output?: string; reason?: string }>>;
  codebergInit(root: string, branch: string): Promise<Ok<{ branch?: string }>>;
  codebergSetRemote(root: string, url: string): Promise<Ok<{ remote?: string; reason?: string }>>;
  codebergIdentity(
    root: string,
    name?: string,
    email?: string,
  ): Promise<Ok<{ identity?: { name: string; email: string } }>>;

  codebergSignIn(username: string, token: string, host?: string): Promise<Ok<{ username?: string; helperAdded?: boolean }>>;
  codebergSignOut(username: string, host?: string): Promise<Ok>;
  codebergSignedIn(host?: string): Promise<Ok<{ signedIn?: boolean; username?: string }>>;
  codebergLog(root: string, limit?: number): Promise<Ok<{ commits?: CodebergCommit[] }>>;
  codebergTag(
    root: string,
    name: string,
    message: string,
    push?: boolean,
  ): Promise<Ok<{ tag?: string; pushed?: boolean; pushFailed?: string }>>;
  codebergDiff(root: string, path: string, staged?: boolean): Promise<Ok<{ diff?: string; reason?: string }>>;
  codebergBranches(root: string): Promise<Ok<{ branches?: GitBranch[]; reason?: string }>>;
  codebergSwitch(root: string, name: string, create?: boolean): Promise<Ok<{ branch?: string; reason?: string }>>;
  codebergDiscard(root: string, paths: string[]): Promise<Ok<{ reason?: string }>>;


}


export interface GitBranch {
  name: string;
  current: boolean;
}





let warned = false;
function warn() {
  if (warned) return;
  warned = true;
  console.warn("[bridge] window.api is missing — running without a host; calls resolve empty.");
}

const noSub =
  <T,>(): Subscriber<T> =>
  () =>
  () => {};

const fallback = {
  platform: "web",

  openFolder: async () => (warn(), null),
  openFile: async () => (warn(), null),
  openWorkflow: async () => (warn(), { error: "No bridge" }),
  createWorkflow: async () => (warn(), { error: "No bridge" }),
  setWorkflowFolders: async () => (warn(), { error: "No bridge" }),
  forgetRecent: async () => (warn(), { projects: [] }),
  recentProjects: async () => (warn(), { projects: [] }),
  addRecentProject: async () => (warn(), { projects: [] }),
  openRecentProject: async () => (warn(), { error: "No bridge" }),
  openRecentFile: async () => (warn(), { error: "No bridge" }),
  workspaceOpenTarget: async () => (warn(), { error: "No bridge" }),
  onHostOpenPath: noSub<{ path: string }>(),
  requestPendingOpenPath: () => warn(),
  watchWorkspace: async () => (warn(), { ok: false, error: "No bridge" }),
  onFsChanged: noSub<{ root: string }>(),

  readDir: async () => (warn(), []),
  readFile: async () => (warn(), { path: "", tooLarge: false, size: 0, content: "", error: "No bridge" }),
  writeFile: async () => (warn(), { path: "", error: "No bridge" }),
  create: async () => (warn(), { error: "No bridge" }),
  rename: async () => (warn(), { error: "No bridge" }),
  trash: async () => (warn(), { error: "No bridge" }),
  move: async () => (warn(), { error: "No bridge" }),
  reveal: async () => (warn(), undefined),

  searchInFiles: async () => (warn(), { files: [], total: 0, truncated: false }),
  listProjectFiles: async () => (warn(), { files: [] }),
  replaceInFiles: async () => (warn(), { ok: false, error: "No bridge" }),
  lspCapability: async () => (warn(), { available: false }),
  lspOpen: async () => (warn(), { ok: false as const, reason: "no-host" }),
  lspChange: async () => (warn(), { ok: false }),
  lspClose: async () => (warn(), { ok: false }),
  lspCompletion: async () => (warn(), { items: [] }),
  lspHover: async () => (warn(), null),
  lspDefinition: async () => (warn(), { locations: [] }),
  lspDocumentHighlights: async () => (warn(), { spans: [] }),
  lspSignatureHelp: async () => (warn(), { signatures: null }),
  lspReferences: async () => (warn(), { locations: [] }),
  lspDocumentSymbol: async () => (warn(), { symbols: [] }),
  lspWorkspaceSymbol: async () => (warn(), { items: [] }),
  lspRename: async () => (warn(), { ok: false, error: "No bridge" }),
  lspStopAll: async () => (warn(), { ok: false }),
  onLspDiagnostics: noSub<{ path: string; diagnostics: Diagnostic[]; server: string }>(),
  lintFile: async () => (warn(), { ok: false as const, reason: "no-host" }),
  formatText: async () => (warn(), { ok: false as const, error: "No host." }),
  httpSend: async () => (warn(), { ok: false, error: "No host." }),
  projectTailwind: async () => (warn(), { usesTailwind: false, tokens: [], filesScanned: 0 }),
  projectScripts: async () => (warn(), { scripts: [], packageName: null }),

  tsSync: async () => (warn(), { ok: false }),
  tsClose: async () => (warn(), { ok: false }),
  tsCompletions: async () => (warn(), { entries: [] }),
  tsQuickInfo: async () => (warn(), null),
  tsDefinition: async () => (warn(), { locations: [] }),
  tsReferences: async () => (warn(), { locations: [] }),
  tsSecurityScan: async () => (warn(), { findings: [] }),
  securityScanProject: async () => (warn(), { findings: [] }),
  securityRescanFile: async () => (warn(), { findings: [] }),
  tsDocumentHighlights: async () => (warn(), { spans: [] }),
  tsSignatureHelp: async () => (warn(), { signatures: null }),
  tsNavigationTree: async () => (warn(), { tree: null }),
  tsNavigateTo: async () => (warn(), { items: [] }),
  tsRename: async () => (warn(), { canRename: false, error: "No bridge" }),
  tsCodeActions: async () => (warn(), { actions: [] }),
  tsRefactorEdits: async () => (warn(), { files: [] }),
  lspCodeActions: async () => (warn(), { actions: [] }),
  tsDiagnostics: async () => (warn(), { diagnostics: [] }),
  tsProjectDiagnostics: async () => (warn(), { counts: {}, scanned: 0 }),

  terminalStart: async () => (warn(), { id: 0, shell: "", error: "No bridge" }),
  terminalWrite: async () => (warn(), { error: "No bridge" }),
  terminalResize: async () => (warn(), { error: "No bridge" }),
  terminalDispose: async () => (warn(), {}),
  onTerminalData: noSub<TerminalData>(),
  onTerminalExit: noSub<TerminalExit>(),

  setTitle: async () => (warn(), undefined),

  browserNavigate: async () => (warn(), { ok: false, error: "No bridge" }),
  browserPlace: () => warn(),
  browserActivate: () => warn(),
  browserBack: () => warn(),
  browserForward: () => warn(),
  browserReload: () => warn(),
  browserStop: () => warn(),
  browserClose: () => warn(),
  browserDevtools: async () => (warn(), { ok: false, error: "No bridge" }),
  browserCdp: async () => (warn(), { ok: false, error: "No bridge" }),
  oastStart: async () => (warn(), { ok: false, error: "No bridge" }),
  oastStop: async () => (warn(), { ok: false, error: "No bridge" }),
  oastStatus: async () => (warn(), { ok: false, error: "No bridge" }),
  onOastInteraction: noSub<OastInteraction>(),
  onOastStatus: noSub<{ running: boolean; domain: string; server: string }>(),
  devtoolsPlace: () => warn(),
  browserFullscreen: () => warn(),
  onBrowserEvent: noSub<BrowserEvent>(),
  proxyStart: async () => (warn(), { ok: false, error: "No bridge" }),
  proxyStop: async () => (warn(), { ok: false, error: "No bridge" }),
  proxyStatus: async () => (warn(), { ok: false, error: "No bridge" }),
  proxyScope: async () => (warn(), { ok: false, error: "No bridge" }),
  proxyTraffic: async () => (warn(), { ok: false, error: "No bridge" }),
  proxyClear: async () => (warn(), { ok: false, error: "No bridge" }),
  proxyCaCert: async () => (warn(), { ok: false, error: "No bridge" }),
  proxyCaCertPath: async () => (warn(), { ok: false, error: "No bridge" }),
  proxyReplay: async () => (warn(), { ok: false, error: "No bridge" }),
  onProxyTraffic: noSub<ProxyEntry[]>(),
  onProxyWs: noSub<ProxyWsFrame[]>(),
  wsConnect: async () => (warn(), { ok: false, error: "No bridge" }),
  wsSend: async () => (warn(), { ok: false, error: "No bridge" }),
  wsClose: async () => (warn(), { ok: false, error: "No bridge" }),
  onWsEvent: noSub<WsEvent>(),
  sseOpen: async () => (warn(), { ok: false, error: "No bridge" }),
  sseClose: async () => (warn(), { ok: false, error: "No bridge" }),
  onSseEvent: noSub<SseEvent>(),
  grpcLoad: async () => (warn(), { ok: false, error: "No bridge" }),
  grpcUnary: async () => (warn(), { ok: false, error: "No bridge" }),
  grpcServerStream: async () => (warn(), { ok: false, error: "No bridge" }),
  grpcCancel: async () => (warn(), { ok: false, error: "No bridge" }),
  onGrpcEvent: noSub<GrpcEvent>(),
  proxyMatchReplace: async () => (warn(), { ok: false, error: "No bridge" }),
  proxySetIntercept: async () => (warn(), { ok: false, error: "No bridge" }),
  proxyInterceptDecision: async () => (warn(), { ok: false, error: "No bridge" }),
  onProxyIntercept: noSub<InterceptedRequest>(),
  proxyResponseDecision: async () => (warn(), { ok: false, error: "No bridge" }),
  onProxyInterceptResponse: noSub<InterceptedResponse>(),
  proxyWsSend: async () => (warn(), { ok: false, error: "No bridge" }),
  proxyRunMacro: async () => (warn(), { ok: false, error: "No bridge" }),
  debugStart: async () => (warn(), { ok: false, error: "No bridge" }),
  debugStartBrowser: async () => (warn(), { ok: false, error: "No bridge" }),
  debugStop: async () => (warn(), { ok: false, error: "No bridge" }),
  debugResume: async () => (warn(), { ok: false, error: "No bridge" }),
  debugStepOver: async () => (warn(), { ok: false, error: "No bridge" }),
  debugStepInto: async () => (warn(), { ok: false, error: "No bridge" }),
  debugStepOut: async () => (warn(), { ok: false, error: "No bridge" }),
  debugPause: async () => (warn(), { ok: false, error: "No bridge" }),
  debugPauseOnExceptions: async () => (warn(), { ok: false, error: "No bridge" }),
  debugProperties: async () => (warn(), { properties: [] }),
  debugEvaluate: async () => (warn(), { value: "" }),
  debugSetBreakpoint: async () => (warn(), { ok: false, error: "No bridge" }),
  remoteGet: async () => (warn(), { ok: false, error: "No bridge" }),
  remoteSet: async () => (warn(), { ok: false, error: "No bridge" }),
  updateCheck: async () => (warn(), { ok: false, error: "No bridge" }),
  updateOpen: async () => (warn(), { ok: false, error: "No bridge" }),
  updateDownload: async () => (warn(), { ok: false, error: "No bridge" }),
  updateInstall: async () => (warn(), { ok: false, error: "No bridge" }),
  onUpdateProgress: noSub<{ phase: string; state: string; bytes?: number; error?: string }>(),
  openExternal: async () => (warn(), { ok: false, error: "No bridge" }),
  onDebugEvent: noSub<DebugEvent>(),
  toolScanRun: async () => (warn(), { ok: false, error: "No bridge" }),
  sssfStatus: async () => (warn(), { ok: false, error: "No bridge" }),
  sssfTail: async () => (warn(), { ok: false, error: "No bridge" }),
  sssfVerify: async () => (warn(), { ok: false, error: "No bridge" }),
  sssfReload: async () => (warn(), { ok: false, error: "No bridge" }),
  onSssfChanged: noSub<SssfStatus>(),

  perfSample: async () => (warn(), { available: false }),

  engineEntries: async () => (warn(), { entries: [] }),
  engineStart: async () => (warn(), { ok: false, error: "No bridge" }),
  engineStop: async () => (warn(), { ok: false }),
  engineStatus: async () => (warn(), { running: false, port: 0, url: "", root: "", requests: 0, clients: 0, accelerated: false }),
  engineReload: async () => (warn(), { reloaded: 0 }),
  onEngineConsole: noSub<unknown>(),
  onEnginePicked: noSub<never>(),
  onEngineStale: noSub<never>(),
  onEngineNavigated: noSub<never>(),

  toolsList: async () => (warn(), { ok: false, error: "No bridge", tools: [], problems: [], dirs: { project: "", user: "" } }),
  toolsRun: async () => (warn(), { ok: false, error: "No bridge" }),
  toolsCancel: async () => (warn(), { ok: false, cancelled: false }),
  toolsReveal: async () => (warn(), { ok: false, error: "No bridge" }),
  toolsScaffold: async () => (warn(), { ok: false, error: "No bridge" }),
  onToolEvent: noSub<unknown>(),

  extensionsList: async () => (warn(), { installed: [], optional: [] }),
  extensionInstall: async () => (warn(), { ok: false, error: "No bridge", installed: [] }),
  extensionRemove: async () => (warn(), { ok: false, error: "No bridge", installed: [] }),
  extensionPrepare: async () => (warn(), { ok: false, error: "No bridge", server: null }),
  extensionCancelPrepare: async () => (warn(), { ok: false, error: "No bridge" }),
  extensionServers: async () => (warn(), { ok: false, error: "No bridge", servers: {} }),
  extensionGetSettings: async () => (warn(), { ok: false, error: "No bridge", settings: {} }),
  extensionSetSettings: async () => (warn(), { ok: false, error: "No bridge" }),

  aiConfig: async () => (warn(), { ok: false, error: "No bridge" }),
  aiKeyStatus: async () => (warn(), { ok: false, error: "No bridge" }),
  aiSetKey: async () => (warn(), { ok: false, error: "No bridge" }),
  aiVerifyKey: async () => (warn(), { ok: false, error: "No bridge" }),
  aiSessions: async () => (warn(), { ok: false, error: "No bridge" }),
  aiSession: async () => (warn(), { ok: false, error: "No bridge" }),
  aiNewSession: async () => (warn(), { ok: false, error: "No bridge" }),
  aiSaveSession: async () => (warn(), { ok: false, error: "No bridge" }),
  aiDeleteSession: async () => (warn(), { ok: false, error: "No bridge" }),
  aiSend: async () => (warn(), { ok: false, error: "No bridge" }),
  aiComplete: async () => (warn(), { ok: false, error: "No bridge" }),
  aiStop: async () => (warn(), { ok: false, error: "No bridge" }),
  aiCommitFile: async () => (warn(), { ok: false, error: "No bridge" }),
  aiSearch: async () => (warn(), { ok: false, error: "No bridge" }),
  aiFiles: async () => (warn(), { ok: false, error: "No bridge" }),
  aiRecommended: async () => (warn(), { ok: false, error: "No bridge" }),
  aiLocalStatus: async () => (warn(), { ok: false, error: "No bridge" }),
  aiLocalSetup: async () => (warn(), { ok: false, error: "No bridge" }),
  aiLocalPull: async () => (warn(), { ok: false, error: "No bridge" }),
  aiLocalRemove: async () => (warn(), { ok: false, error: "No bridge" }),
  aiClaudeCodeStatus: async () => (warn(), { ok: false, error: "No bridge" }),
  aiClaudeCodeInstall: async () => (warn(), { ok: false, error: "No bridge" }),
  aiClaudeCodeLogin: async () => (warn(), { ok: false, error: "No bridge" }),
  onAiEvent: noSub<AiEvent>(),
  onAiPull: noSub<AiPullEvent>(),

  stripComments: async () => (warn(), { ok: false, error: "No bridge" }),
  commentLanguage: async () => (warn(), { ok: false, error: "No bridge" }),

  codebergStatus: async () => (warn(), { installed: false }),
  codebergStage: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergUnstage: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergCommit: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergPush: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergPull: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergInit: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergSetRemote: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergIdentity: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergSignIn: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergSignOut: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergSignedIn: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergLog: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergTag: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergDiff: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergBranches: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergSwitch: async () => (warn(), { ok: false, error: "No bridge" }),
  codebergDiscard: async () => (warn(), { ok: false, error: "No bridge" }),

} as unknown as HostApi;

declare global {

  var api: HostApi | undefined;
}


export const bridge: HostApi = globalThis.api ?? fallback;


export const hasBridge = Boolean(globalThis.api);
