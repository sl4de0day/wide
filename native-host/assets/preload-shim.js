




(function () {
  "use strict";
  if (window.__wideBridge) return;
  window.__wideBridge = true;

  const wv = window.chrome && window.chrome.webview;
  const pending = new Map();
  let nextId = 1;
  const subscribers = new Map();

  function failPending(reason) {
    const waiting = Array.prototype.slice.call(pending.values());
    pending.clear();
    waiting.forEach(function (p) {
      try { p.reject(new Error(reason)); } catch (e) {}
    });
  }

  function invoke(channel) {
    const args = Array.prototype.slice.call(arguments, 1);
    const replyId = nextId++;
    return new Promise(function (resolve, reject) {
      pending.set(replyId, { resolve: resolve, reject: reject });
      try {
        wv.postMessage({ type: "invoke", channel: channel, replyId: replyId, args: args });
      } catch (e) {
        pending.delete(replyId);
        reject(e);
      }
    });
  }




  function hostCmd(cmd, extra) {
    try {
      var message = { type: "host-cmd", cmd: cmd };
      if (extra) for (var k in extra) if (extra.hasOwnProperty(k)) message[k] = extra[k];
      wv.postMessage(message);
    } catch (e) {}
  }

  const subscribe = function (channel) {
    return function (handler) {
      let set = subscribers.get(channel);
      if (!set) { set = new Set(); subscribers.set(channel, set); }
      set.add(handler);
      return function () { set.delete(handler); };
    };
  };

  if (wv && wv.addEventListener) {
    wv.addEventListener("message", function (e) {
      const msg = e.data;
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "reply") {
        const p = pending.get(msg.replyId);
        if (!p) return;
        pending.delete(msg.replyId);
        if (msg.error) p.reject(new Error(msg.error));
        else p.resolve(msg.result);
      } else if (msg.type === "event") {
        if (msg.channel === "host:backend") failPending("The backend stopped.");
        const set = subscribers.get(msg.channel);
        if (set) set.forEach(function (h) { try { h(msg.payload); } catch (err) { console.error(err); } });
      }
    });
  }

  const api = {
    platform: "win32",
    openFolder: function () { return invoke("dialog:openFolder"); },
    openFile: function () { return invoke("dialog:openFile"); },
    openWorkflow: function (path) { return invoke("workflow:open", path); },
    createWorkflow: function (path, folders) { return invoke("workflow:create", path, folders); },
    setWorkflowFolders: function (path, folders) { return invoke("workflow:setFolders", path, folders); },
    forgetRecent: function (path) { return invoke("workspace:forgetRecent", path); },
    recentProjects: function () { return invoke("workspace:recents"); },
    addRecentProject: function (path, name, kind) { return invoke("workspace:addRecent", path, name, kind); },
    openRecentProject: function (path) { return invoke("workspace:openRecent", path); },
    openRecentFile: function (path) { return invoke("workspace:openRecentFile", path); },
    workspaceOpenTarget: function (path) { return invoke("workspace:openTarget", path); },
    onHostOpenPath: subscribe("host:openPath"),
    onBackendState: subscribe("host:backend"),
    onBackendFault: subscribe("backend:fault"),
    requestPendingOpenPath: function () { hostCmd("consume-open-path"); },
    watchWorkspace: function (root) { return invoke("workspace:watch", root); },
    onFsChanged: subscribe("fs:changed"),
    readDir: function (path) { return invoke("fs:readDir", path); },
    readFile: function (path) { return invoke("fs:readFile", path); },
    readBinary: function (path) { return invoke("fs:readBinary", path); },
    writeFile: function (path, content) { return invoke("fs:writeFile", path, content); },
    create: function (parentPath, name, kind) { return invoke("fs:create", parentPath, name, kind); },
    rename: function (path, name) { return invoke("fs:rename", path, name); },
    trash: function (path) { return invoke("fs:trash", path); },
    move: function (sourcePath, targetDir) { return invoke("fs:move", sourcePath, targetDir); },
    reveal: function (path) { return invoke("fs:reveal", path); },
    searchInFiles: function (root, options) { return invoke("search:inFiles", root, options); },
    listProjectFiles: function (root) { return invoke("search:files", root); },
    replaceInFiles: function (root, options, replacement, exclude) { return invoke("search:replace", root, options, replacement, exclude); },
    lspCapability: function (filePath) { return invoke("lsp:capability", filePath); },
    lspOpen: function (root, filePath, text) { return invoke("lsp:open", root, filePath, text); },
    lspChange: function (filePath, text) { return invoke("lsp:change", filePath, text); },
    lspClose: function (filePath) { return invoke("lsp:close", filePath); },
    lspCompletion: function (filePath, line, character) { return invoke("lsp:completion", filePath, line, character); },
    lspHover: function (filePath, line, character) { return invoke("lsp:hover", filePath, line, character); },
    lspDefinition: function (filePath, line, character) { return invoke("lsp:definition", filePath, line, character); },
    lspReferences: function (filePath, line, character) { return invoke("lsp:references", filePath, line, character); },
    lspDocumentHighlights: function (filePath, line, character) { return invoke("lsp:documentHighlight", filePath, line, character); },
    lspSignatureHelp: function (filePath, line, character) { return invoke("lsp:signatureHelp", filePath, line, character); },
    lspDocumentSymbol: function (filePath) { return invoke("lsp:documentSymbol", filePath); },
    lspWorkspaceSymbol: function (filePath, query) { return invoke("lsp:workspaceSymbol", filePath, query); },
    lspRename: function (filePath, line, character, newName) { return invoke("lsp:rename", filePath, line, character, newName); },
    lspCodeActions: function (filePath, startLine, startChar, endLine, endChar, codes) { return invoke("lsp:codeActions", filePath, startLine, startChar, endLine, endChar, codes); },
    lspStopAll: function () { return invoke("lsp:stopAll"); },
    lintFile: function (root, filePath, text) { return invoke("lint:file", root, filePath, text); },
    formatText: function (filePath, text, root) { return invoke("format:text", filePath, text, root); },
    httpSend: function (url, method, headers, body, options) { return invoke("http:send", url, method, headers, body, options); },
    projectTailwind: function (root) { return invoke("project:tailwind", root); },
    projectScripts: function (root) { return invoke("project:scripts", root); },
    tsSync: function (root, file, content) { return invoke("ts:sync", root, file, content); },
    tsClose: function (file) { return invoke("ts:close", file); },
    tsCompletions: function (root, file, position) { return invoke("ts:completions", root, file, position); },
    tsDetails: function (root, file, position, name, source, data) { return invoke("ts:details", root, file, position, name, source, data); },
    tsQuickInfo: function (root, file, position) { return invoke("ts:quickInfo", root, file, position); },
    tsDiagnostics: function (root, file) { return invoke("ts:diagnostics", root, file); },
    tsProjectDiagnostics: function (root) { return invoke("ts:projectDiagnostics", root); },
    tsDefinition: function (root, file, position) { return invoke("ts:definition", root, file, position); },
    tsReferences: function (root, file, position) { return invoke("ts:references", root, file, position); },
    tsSecurityScan: function (root) { return invoke("ts:securityScan", root); },
    securityScanProject: function (root) { return invoke("security:scanProject", root); },
    securityRescanFile: function (root, file, content) { return invoke("security:rescanFile", root, file, content); },
    securityExport: function (root, format) { return invoke("security:export", root, format); },
    securityBaseline: function (root, action) { return invoke("security:baseline", root, action); },
    tsDocumentHighlights: function (root, file, position) { return invoke("ts:documentHighlights", root, file, position); },
    tsSignatureHelp: function (root, file, position) { return invoke("ts:signatureHelp", root, file, position); },
    tsNavigationTree: function (root, file) { return invoke("ts:navigationTree", root, file); },
    tsNavigateTo: function (root, query) { return invoke("ts:navigateTo", root, query); },
    tsRename: function (root, file, position) { return invoke("ts:rename", root, file, position); },
    tsCodeActions: function (root, file, start, end, codes) { return invoke("ts:codeActions", root, file, start, end, codes); },
    tsRefactorEdits: function (root, file, start, end, refactor, action) { return invoke("ts:refactorEdits", root, file, start, end, refactor, action); },
    terminalStart: function (options) { return invoke("terminal:start", options); },
    terminalWrite: function (id, data) { return invoke("terminal:write", id, data); },
    terminalResize: function (id, cols, rows) { return invoke("terminal:resize", id, cols, rows); },
    terminalDispose: function (id) { return invoke("terminal:dispose", id); },
    onTerminalData: subscribe("terminal:data"),
    onTerminalExit: subscribe("terminal:exit"),
    setTitle: function (title) { return invoke("window:setTitle", title); },




    browserNavigate: function (tabId, url) { return invoke("browser:navigate", url, tabId); },
    browserPlace: function (tabId, x, y, w, h, visible) { hostCmd("browser-place", { tabId: tabId, x: x, y: y, w: w, h: h, visible: visible }); },
    browserActivate: function (tabId) { hostCmd("browser-activate", { tabId: tabId }); },
    browserBack: function (tabId) { hostCmd("browser-back", { tabId: tabId }); },
    browserForward: function (tabId) { hostCmd("browser-forward", { tabId: tabId }); },
    browserReload: function (tabId) { hostCmd("browser-reload", { tabId: tabId }); },
    browserStop: function (tabId) { hostCmd("browser-stop", { tabId: tabId }); },
    browserClose: function (tabId) { hostCmd("browser-close", { tabId: tabId }); },
    browserDevtools: function (open, activeUrl, tabId) { return invoke("browser:devtools", open, activeUrl, tabId); },
    browserCdp: function (tabId, method, params) { return invoke("browser:cdp", tabId, method, params); },
    securityTestRule: function (pattern, flags, sample) { return invoke("security:testRule", pattern, flags, sample); },
    webtoolsCyberchef: function () { return invoke("webtools:cyberchef"); },
    webtoolsWappalyzer: function () { return invoke("webtools:wappalyzer"); },
    oastStart: function (server, token) { return invoke("oast:start", server, token); },
    oastStartBuiltin: function () { return invoke("oast:startBuiltin"); },
    oastStop: function () { return invoke("oast:stop"); },
    oastStatus: function () { return invoke("oast:status"); },
    onOastInteraction: subscribe("oast:interaction"),
    onOastStatus: subscribe("oast:status"),
    devtoolsPlace: function (x, y, w, h, visible) { hostCmd("devtools-place", { x: x, y: y, w: w, h: h, visible: visible }); },
    browserFullscreen: function (on) { hostCmd("browser-fullscreen", { on: on }); },
    onBrowserEvent: subscribe("browser:event"),


    proxyStart: function () { return invoke("proxy:start"); },
    proxyStop: function () { return invoke("proxy:stop"); },
    proxyStatus: function () { return invoke("proxy:status"); },
    proxyScope: function (scope) { return invoke("proxy:scope", scope); },
    proxyTraffic: function () { return invoke("proxy:traffic"); },
    proxyClear: function () { return invoke("proxy:clear"); },
    proxyCaCert: function () { return invoke("proxy:caCert"); },
    proxyCaCertPath: function () { return invoke("proxy:caCertPath"); },
    proxyReplay: function (request, options) { return invoke("proxy:replay", request, options); },
    onProxyTraffic: subscribe("proxy:traffic"),
    onProxyWs: subscribe("proxy:ws"),
    proxyMatchReplace: function (rules) { return invoke("proxy:matchReplace", rules); },
    catcherAutosaveWrite: function (root, json) { return invoke("catcher:autosaveWrite", root, json); },
    catcherAutosaveRead: function (root) { return invoke("catcher:autosaveRead", root); },
    proxySetIntercept: function (config) { return invoke("proxy:setIntercept", config); },
    proxyInterceptDecision: function (id, action, edited) { return invoke("proxy:interceptDecision", id, action, edited); },
    onProxyIntercept: subscribe("proxy:intercept"),
    proxyResponseDecision: function (id, action, edited) { return invoke("proxy:responseDecision", id, action, edited); },
    onProxyInterceptResponse: subscribe("proxy:interceptResponse"),
    proxyWsSend: function (id, direction, text) { return invoke("proxy:wsSend", id, direction, text); },
    proxyRunMacro: function (macro) { return invoke("proxy:runMacro", macro); },
    proxySetSessionMacro: function (macro) { return invoke("proxy:setSessionMacro", macro); },
    proxyRefreshSession: function () { return invoke("proxy:refreshSession"); },
    proxySessionStatus: function () { return invoke("proxy:sessionStatus"); },


    wsConnect: function (id, url, protocols) { return invoke("ws:connect", { id: id, url: url, protocols: protocols }); },
    wsSend: function (id, data) { return invoke("ws:send", { id: id, data: data }); },
    wsClose: function (id) { return invoke("ws:close", { id: id }); },
    onWsEvent: subscribe("ws:event"),
    sseOpen: function (id, url, headers) { return invoke("sse:open", { id: id, url: url, headers: headers }); },
    sseClose: function (id) { return invoke("sse:close", { id: id }); },
    onSseEvent: subscribe("sse:event"),
    grpcLoad: function (id, protoPath, protoSource) { return invoke("grpc:load", { id: id, protoPath: protoPath, protoSource: protoSource }); },
    grpcUnary: function (args) { return invoke("grpc:unary", args); },
    grpcServerStream: function (args) { return invoke("grpc:serverStream", args); },
    grpcCancel: function (id) { return invoke("grpc:cancel", { id: id }); },
    onGrpcEvent: subscribe("grpc:event"),


    debugStart: function (cwd, file, breakpoints) { return invoke("debug:start", cwd, file, breakpoints); },
    debugStartBrowser: function (breakpoints, root) { return invoke("debug:startBrowser", breakpoints, root); },
    debugStop: function () { return invoke("debug:stop"); },
    debugResume: function () { return invoke("debug:resume"); },
    debugStepOver: function () { return invoke("debug:stepOver"); },
    debugStepInto: function () { return invoke("debug:stepInto"); },
    debugStepOut: function () { return invoke("debug:stepOut"); },
    debugPause: function () { return invoke("debug:pause"); },
    debugPauseOnExceptions: function (state) { return invoke("debug:pauseOnExceptions", state); },
    debugProperties: function (objectId) { return invoke("debug:properties", objectId); },
    debugEvaluate: function (callFrameId, expression) { return invoke("debug:evaluate", callFrameId, expression); },
    debugSetBreakpoint: function (file, line, on, id, condition) { return invoke("debug:setBreakpoint", file, line, on, id, condition); },
    remoteList: function () { return invoke("remote:list"); },
    remoteSave: function (profile) { return invoke("remote:save", profile); },
    remoteRemove: function (id) { return invoke("remote:remove", id); },
    remoteTest: function (profile) { return invoke("remote:test", profile); },
    remoteExec: function (profile, command) { return invoke("remote:exec", profile, command); },
    remoteListDir: function (profile, dir) { return invoke("remote:listDir", profile, dir); },
    remoteReadFile: function (profile, filePath) { return invoke("remote:readFile", profile, filePath); },
    remoteWriteFile: function (profile, filePath, content) { return invoke("remote:writeFile", profile, filePath, content); },
    remoteMkdir: function (profile, dir) { return invoke("remote:mkdir", profile, dir); },
    remoteNewFile: function (profile, filePath) { return invoke("remote:newFile", profile, filePath); },
    remoteDelete: function (profile, target) { return invoke("remote:delete", profile, target); },
    remoteRename: function (profile, from, to) { return invoke("remote:rename", profile, from, to); },
    remoteGrep: function (profile, dir, query) { return invoke("remote:grep", profile, dir, query); },
    dockerList: function () { return invoke("docker:list"); },
    dockerExec: function (id, command) { return invoke("docker:exec", id, command); },
    testDiscover: function (root) { return invoke("test:discover", root); },
    testRun: function (root, framework, target) { return invoke("test:run", root, framework, target); },
    osvInfo: function (root) { return invoke("osv:info", root); },
    osvRefresh: function (root, dumpPath) { return invoke("osv:refresh", root, dumpPath); },
    updateCheck: function (manifestUrl) { return invoke("update:check", manifestUrl); },
    updateOpen: function (url) { return invoke("update:open", url); },
    updateDownload: function (info) { return invoke("update:download", info); },
    updateInstall: function (info) { return invoke("update:install", info); },
    onUpdateProgress: subscribe("update:progress"),
    installLanguage: function () { return invoke("app:installLanguage"); },
    openExternal: function (url) { return invoke("shell:openExternal", url); },
    onDebugEvent: subscribe("debug:event"),
    toolScanRun: function (root, command) { return invoke("toolscan:run", root, command); },

    sssfStatus: function () { return invoke("sssf:status"); },
    sssfTail: function (count) { return invoke("sssf:tail", count); },
    sssfVerify: function () { return invoke("sssf:verify"); },
    sssfReload: function () { return invoke("sssf:reload"); },
    onSssfChanged: subscribe("sssf:changed"),
    perfSample: function () { return invoke("perf:sample"); },
    engineEntries: function (root) { return invoke("engine:entries", root); },
    engineStart: function (root, directory) { return invoke("engine:start", root, directory); },
    engineStop: function () { return invoke("engine:stop"); },
    engineStatus: function () { return invoke("engine:status"); },
    engineReload: function (path) { return invoke("engine:reload", path); },
    onEngineConsole: subscribe("engine:console"),
    onLspDiagnostics: subscribe("lsp:diagnostics"),
    onEnginePicked: subscribe("engine:picked"),
    onEngineStale: subscribe("engine:stale"),
    onEngineNavigated: subscribe("engine:navigated"),
    toolsList: function (root) { return invoke("tools:list", root); },
    toolsRun: function (root, toolId, commandId, payload) { return invoke("tools:run", root, toolId, commandId, payload); },
    toolsCancel: function (runId) { return invoke("tools:cancel", runId); },
    toolsReveal: function (root, toolId) { return invoke("tools:reveal", root, toolId); },
    toolsScaffold: function (root, name) { return invoke("tools:scaffold", root, name); },
    onToolEvent: subscribe("tools:event"),


    extensionsList: function () { return invoke("extensions:list"); },
    extensionInstall: function (id) { return invoke("extensions:install", id); },
    extensionRemove: function (id) { return invoke("extensions:remove", id); },
    extensionPrepare: function (id) { return invoke("extensions:prepare", id); },
    extensionCancelPrepare: function (id) { return invoke("extensions:cancelPrepare", id); },
    extensionServers: function () { return invoke("extensions:servers"); },
    extensionGetSettings: function () { return invoke("extensions:getSettings"); },
    extensionSetSettings: function (id, record) { return invoke("extensions:setSettings", id, record); },



    aiConfig: function (patch) { return invoke("ai:config", patch); },
    aiKeyStatus: function () { return invoke("ai:keyStatus"); },
    aiSetKey: function (provider, key) { return invoke("ai:setKey", provider, key); },
    aiVerifyKey: function (provider, key) { return invoke("ai:verifyKey", provider, key); },
    aiSessions: function (root) { return invoke("ai:sessions", root); },
    aiSession: function (id) { return invoke("ai:session", id); },
    aiNewSession: function (root) { return invoke("ai:newSession", root); },
    aiSaveSession: function (id, root, messages) { return invoke("ai:saveSession", id, root, messages); },
    aiDeleteSession: function (id) { return invoke("ai:deleteSession", id); },
    aiSend: function (request) { return invoke("ai:send", request); },
    aiComplete: function (prefix, suffix, language) { return invoke("ai:complete", prefix, suffix, language); },
    aiStop: function (id) { return invoke("ai:stop", id); },
    aiCommitFile: function (root, path, content) { return invoke("ai:commitFile", root, path, content); },
    aiSearch: function (query, limit) { return invoke("ai:search", query, limit); },
    aiFiles: function (source, id) { return invoke("ai:files", source, id); },
    aiRecommended: function () { return invoke("ai:recommended"); },
    aiLocalStatus: function () { return invoke("ai:localStatus"); },
    aiLocalSetup: function () { return invoke("ai:localSetup"); },
    aiLocalPull: function (reference) { return invoke("ai:localPull", reference); },
    aiLocalRemove: function (name) { return invoke("ai:localRemove", name); },
    aiClaudeCodeStatus: function () { return invoke("ai:claudeCodeStatus"); },
    aiClaudeCodeInstall: function () { return invoke("ai:claudeCodeInstall"); },
    aiClaudeCodeLogin: function () { return invoke("ai:claudeCodeLogin"); },
    onAiEvent: subscribe("ai:event"),
    onAiPull: subscribe("ai:pull"),
    onMcpPending: subscribe("mcp:pending"),
    mcpPending: function () { return invoke("mcp:pending"); },
    mcpTrust: function (signature, allow) { return invoke("mcp:trust", signature, allow); },


    stripComments: function (root, path, text) { return invoke("comments:strip", root, path, text); },
    commentLanguage: function (path) { return invoke("comments:language", path); },

    codebergStatus: function (root) { return invoke("codeberg:status", root); },
    codebergStage: function (root, paths) { return invoke("codeberg:stage", root, paths); },
    codebergUnstage: function (root, paths) { return invoke("codeberg:unstage", root, paths); },
    codebergCommit: function (root, message, amend) { return invoke("codeberg:commit", root, message, amend); },
    codebergPush: function (root, withTags) { return invoke("codeberg:push", root, withTags); },
    codebergPull: function (root) { return invoke("codeberg:pull", root); },
    codebergInit: function (root, branch) { return invoke("codeberg:init", root, branch); },
    codebergSetRemote: function (root, url) { return invoke("codeberg:setRemote", root, url); },
    codebergIdentity: function (root, name, email) { return invoke("codeberg:identity", root, name, email); },
    codebergSignIn: function (username, token, host) { return invoke("codeberg:signIn", username, token, host); },
    codebergSignOut: function (username, host) { return invoke("codeberg:signOut", username, host); },
    codebergSignedIn: function (host) { return invoke("codeberg:signedIn", host); },
    codebergLog: function (root, limit) { return invoke("codeberg:log", root, limit); },
    codebergTag: function (root, name, message, push) { return invoke("codeberg:tag", root, name, message, push); },
    codebergDiff: function (root, path, staged) { return invoke("codeberg:diff", root, path, staged); },
    codebergBranches: function (root) { return invoke("codeberg:branches", root); },
    codebergSwitch: function (root, name, create) { return invoke("codeberg:switch", root, name, create); },
    codebergDiscard: function (root, paths) { return invoke("codeberg:discard", root, paths); },
    codebergStash: function (root, action, ref) { return invoke("codeberg:stash", root, action, ref); },
    codebergClone: function (url, parentDir, folder) { return invoke("codeberg:clone", url, parentDir, folder); },
  };

  try {
    Object.defineProperty(window, "api", { value: api, enumerable: true, configurable: false, writable: false });
  } catch (e) {
    window.api = api;
  }
})();
