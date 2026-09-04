

electron.app.whenReady().then(async () => {
  openSplash();
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
  registerAiAgentHandlers();
  registerClaudeCodeHandlers();
  registerBrowserHandlers();
  registerProxyHandlers();
  registerDebugHandlers();
  registerRemoteHandlers();
  registerUpdateHandlers();
  registerSecScanHandlers();
  registerToolScanHandlers();
  registerOastHandlers();
  registerRealtimeHandlers();
  registerGrpcHandlers();
  createWindow();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
electron.app.on("before-quit", () => {


  lspStopAll();
  disposeAllTerminals();
  disposeEngine();
  disposeTools();
  closeAllRealtime();
  closeAllGrpc();


  stopProxy();
  stopOast();
  dispose();
});
electron.app.on("window-all-closed", () => {
  lspStopAll();
  disposeAllTerminals();
  disposeEngine();
  disposeTools();
  closeAllRealtime();
  closeAllGrpc();


  stopProxy();
  stopOast();
  dispose();
  if (!isMac) {
    electron.app.quit();
  }
});

