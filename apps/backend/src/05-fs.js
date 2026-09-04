

function registerFsHandlers() {
  electron.ipcMain.handle("dialog:openFolder", async (event) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    const result = await electron.dialog.showOpenDialog(window, {
      properties: ["openDirectory"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0];
    return { path, name: node_path.basename(path) };
  });
  electron.ipcMain.handle("dialog:openFile", async (event) => {
    const window = electron.BrowserWindow.fromWebContents(event.sender);
    const result = await electron.dialog.showOpenDialog(window, {
      properties: ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0];

    return {
      path,
      name: node_path.basename(path),
      dir: node_path.dirname(path),
      dirName: node_path.basename(node_path.dirname(path))
    };
  });
  electron.ipcMain.handle("fs:readDir", async (_event, dirPath) => {
    const dirents = await promises.readdir(dirPath, { withFileTypes: true });
    return sortEntries(
      dirents.filter((dirent) => !IGNORED$3.has(dirent.name)).map((dirent) => ({
        name: dirent.name,
        path: node_path.join(dirPath, dirent.name),
        isDirectory: dirent.isDirectory()
      }))
    );
  });
  electron.ipcMain.handle("fs:readFile", async (_event, filePath) => {
    const stats = await promises.stat(filePath);
    if (stats.size > MAX_FILE_BYTES$1) {
      return { path: filePath, tooLarge: true, size: stats.size, content: "" };
    }
    const content = await promises.readFile(filePath, "utf8");
    return { path: filePath, tooLarge: false, size: stats.size, content };
  });
  electron.ipcMain.handle("fs:writeFile", async (_event, filePath, content) => {

    await promises.mkdir(node_path.dirname(filePath), { recursive: true });
    await promises.writeFile(filePath, content, "utf8");
    return { path: filePath };
  });
  electron.ipcMain.handle("fs:create", async (_event, parentPath, name, kind) => {
    const target = node_path.join(parentPath, name);
    if (node_path.dirname(target) !== parentPath) {
      return { error: "The name cannot contain a path separator." };
    }
    if (await exists(target)) {
      return { error: "An item with this name already exists." };
    }
    try {
      if (kind === "folder") await promises.mkdir(target);
      else await promises.writeFile(target, "", { encoding: "utf8", flag: "wx" });
      return { path: target };
    } catch (error) {
      return { error: error.message };
    }
  });
  electron.ipcMain.handle("fs:rename", async (_event, oldPath, name) => {
    const parent = node_path.dirname(oldPath);
    const target = node_path.join(parent, name);
    if (node_path.dirname(target) !== parent) return { error: "The name cannot contain a path separator." };
    if (target === oldPath) return { path: oldPath };
    if (await exists(target)) return { error: "An item with this name already exists." };
    try {
      await promises.rename(oldPath, target);
      return { path: target };
    } catch (error) {
      return { error: error.message };
    }
  });
  electron.ipcMain.handle("fs:trash", async (_event, targetPath) => {
    try {
      await electron.shell.trashItem(targetPath);
      return { path: targetPath };
    } catch (error) {
      return { error: error.message };
    }
  });
  electron.ipcMain.handle("fs:move", async (_event, sourcePath, targetDir) => {
    if (node_path.dirname(sourcePath) === targetDir) return { path: sourcePath };
    if (isInside(targetDir, sourcePath)) {
      return { error: "A folder cannot be moved inside itself." };
    }
    const target = node_path.join(targetDir, node_path.basename(sourcePath));
    if (await exists(target)) return { error: "An item with this name already exists at the destination." };
    try {
      await promises.rename(sourcePath, target);
      return { path: target };
    } catch (error) {
      if (error.code === "EXDEV") {
        return { error: "Moving between different drives is not supported." };
      }
      return { error: error.message };
    }
  });
  electron.ipcMain.handle("fs:reveal", (_event, targetPath) => {
    electron.shell.showItemInFolder(targetPath);
  });
}
function registerWindowHandlers() {
  electron.ipcMain.handle("window:setTitle", (event, title2) => {
    electron.BrowserWindow.fromWebContents(event.sender)?.setTitle(title2);
  });
}
