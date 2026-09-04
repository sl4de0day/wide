

const RECENTS_FILE = () => node_path.join(electron.app.getPath("userData"), "recent-projects.json");
const MAX_RECENTS = 12;
async function readRecents() {
  try {
    const parsed = JSON.parse(await promises.readFile(RECENTS_FILE(), "utf8"));
    return Array.isArray(parsed.projects) ? parsed.projects : [];
  } catch {
    return [];
  }
}
async function writeRecents(projects) {
  try {
    await promises.writeFile(RECENTS_FILE(), JSON.stringify({ projects }, null, 2), "utf8");
  } catch (error) {
    console.warn("[workspace] The recent-projects list could not be saved:", error.message);
  }
}
async function isDirectory(path) {
  try {
    return (await promises.stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function stillThere(path, kind) {
  try {
    const stats = await promises.stat(path);
    return kind === "folder" ? stats.isDirectory() : stats.isFile();
  } catch {
    return false;
  }
}

function registerWorkspaceHandlers() {
  electron.ipcMain.handle("workspace:recents", async () => {
    const projects = await readRecents();
    const checked = await Promise.all(
      projects.map(async (project) => {

        const kind = project.kind === "file" || project.kind === "workflow" ? project.kind : "folder";
        return { ...project, kind, missing: !await stillThere(project.path, kind) };
      })
    );

    checked.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0));
    return { projects: checked };
  });
  electron.ipcMain.handle("workspace:addRecent", async (_event, path, name, kind) => {
    if (!path) return { projects: [] };
    const projects = await readRecents();
    const entry = {
      path,
      name: name || node_path.basename(path),
      kind: kind === "file" || kind === "workflow" ? kind : "folder",
      openedAt: Date.now()
    };
    const next = [entry, ...projects.filter((project) => project.path !== path)].slice(
      0,
      MAX_RECENTS
    );
    await writeRecents(next);
    return { projects: next };
  });
  electron.ipcMain.handle("workspace:openRecent", async (_event, path) => {
    if (!path || !await isDirectory(path)) {
      return { error: "That folder is no longer there." };
    }
    return { path, name: node_path.basename(path) };
  });

  electron.ipcMain.handle("workspace:openRecentFile", async (_event, path) => {
    if (!path || !(await stillThere(path, "file"))) {
      return { error: "That file is no longer there." };
    }
    return { path, name: node_path.basename(path) };
  });

  electron.ipcMain.handle("workspace:openTarget", async (_event, path) => {
    if (!path) return { error: "No path was given." };
    try {
      const stats = await promises.stat(path);
      if (stats.isDirectory()) return { kind: "folder", path, name: node_path.basename(path) };
      if (stats.isFile()) {
        const folder = node_path.dirname(path);
        return { kind: "file", path: folder, name: node_path.basename(folder), file: path };
      }
      return { error: "That is neither a file nor a folder." };
    } catch {
      return { error: "That path is no longer there." };
    }
  });

  electron.ipcMain.handle("workspace:forgetRecent", async (_event, path) => {
    const projects = await readRecents();
    const next = projects.filter((project) => project.path !== path);
    await writeRecents(next);
    return { projects: next };
  });

  electron.ipcMain.handle("workspace:watch", async (_event, root) => {
    if (workspaceWatcher) {
      try { workspaceWatcher.close(); } catch {  }
      workspaceWatcher = null;
    }
    if (workspaceWatchTimer) {
      clearTimeout(workspaceWatchTimer);
      workspaceWatchTimer = null;
    }
    if (!root) return { ok: true };
    try {
      workspaceWatcher = node_fs.watch(root, { recursive: true, persistent: false }, (_type, name) => {
        const rel = String(name || "");
        if (/(^|[\\/])(node_modules|\.git|dist|out|build|\.next|\.nuxt|coverage|\.cache)([\\/]|$)/.test(rel)) return;
        if (workspaceWatchTimer) clearTimeout(workspaceWatchTimer);
        workspaceWatchTimer = setTimeout(() => broadcast("fs:changed", { root }), 300);
      });
    } catch {

      workspaceWatcher = null;
    }
    return { ok: true };
  });
}

let workspaceWatcher = null;
let workspaceWatchTimer = null;
