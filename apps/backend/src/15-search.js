

function registerSearchHandlers() {
  electron.ipcMain.handle("search:inFiles", (_event, root, options) => searchInFiles(root, options));

  electron.ipcMain.handle("search:files", (_event, root) => listProjectFiles(root));

  electron.ipcMain.handle("search:replace", (_event, root, options, replacement, exclude) =>
    replaceInFiles(root, options, replacement, exclude));
}
