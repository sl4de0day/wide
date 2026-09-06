

let shutdownDone = false;
function shutdownServices() {
  if (shutdownDone) return;
  shutdownDone = true;
  const steps = [
    lspStopAll,
    disposeAllTerminals,
    disposeEngine,
    disposeTools,
    closeAllRealtime,
    closeAllGrpc,
    mcpDisposeAll,
    stopProxy,
    stopOast,
    stopBuiltinOast,
    dispose,
  ];
  for (const step of steps) {
    try {
      step();
    } catch {
      void 0;
    }
  }
}

let backendFailing = false;
function reportFatal(kind, error) {
  const detail = String((error && error.stack) || (error && error.message) || error);
  console.warn(`[backend] ${kind}:`, detail);
  if (backendFailing) return;
  backendFailing = true;
  try {
    broadcast("backend:fault", { kind, detail });
  } catch {
    void 0;
  }
  setTimeout(() => {
    backendFailing = false;
  }, 5000);
}

process.on("uncaughtException", (error) => {
  reportFatal("uncaughtException", error);
});
process.on("unhandledRejection", (reason) => {
  reportFatal("unhandledRejection", reason);
});
process.on("exit", shutdownServices);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  try {
    process.on(signal, () => {
      shutdownServices();
      process.exit(0);
    });
  } catch {
    void 0;
  }
}

electron.app.whenReady().then(async () => {
  openSplash();
  if (typeof electron.__initSecrets === "function") {
    try {
      await electron.__initSecrets();
    } catch {
      void 0;
    }
  }
  await boot();


  registerSssfHandlers();
  registerFsHandlers();
  registerWorkspaceHandlers();
  registerWorkflowHandlers();
  registerPerfHandlers();
  registerWindowHandlers();
  registerSearchHandlers();
  registerTsHandlers();
  registerProjectHandlers();
  registerTerminalHandlers();
  registerTestHandlers();
  registerOsvHandlers();
  registerEngineHandlers();
  registerHttpHandlers();
  registerFormatHandlers();
  registerLintHandlers();
  registerLspHandlers();
  registerToolHandlers();
  registerExtensionHandlers();
  registerPrepareHandlers();
  registerCodebergHandlers();
  registerCommentHandlers();
  registerAiStoreHandlers();
  registerAiCatalogHandlers();
  registerAiLocalHandlers();
  registerMcpHandlers();
  registerAiAgentHandlers();
  registerClaudeCodeHandlers();
  registerBrowserHandlers();
  registerProxyHandlers();
  registerDebugHandlers();
  registerRemoteHandlers();
  registerUpdateHandlers();
  registerSecScanHandlers();
  registerToolScanHandlers();
  registerWebtoolsHandlers();
  registerOastHandlers();
  registerRealtimeHandlers();
  registerGrpcHandlers();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("before-quit", shutdownServices);
electron.app.on("window-all-closed", () => {
  shutdownServices();
  if (!isMac) {
    electron.app.quit();
  }
});

