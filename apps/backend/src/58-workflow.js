

const WORKFLOW_EXTENSION = ".wideflow";

const WORKFLOW_VERSION = 1;
const MAX_WORKFLOW_BYTES = 1024 * 1024;
const MAX_WORKFLOW_FOLDERS = 32;

const isWorkflowPath = (path) =>
  typeof path === "string" && path.toLowerCase().endsWith(WORKFLOW_EXTENSION);

function resolveFolder(workflowDir, entry) {
  const raw = typeof entry === "string" ? entry : entry?.path;
  if (typeof raw !== "string" || raw.length === 0) return null;
  const absolute = node_path.resolve(workflowDir, raw);
  return {
    path: absolute,
    name:
      (typeof entry?.name === "string" && entry.name.trim()) || node_path.basename(absolute),
  };
}

function storeFolder(workflowDir, folder) {
  let stored = folder.path;
  const relative = node_path.relative(workflowDir, folder.path);

  if (relative && !node_path.isAbsolute(relative) && (relative.match(/\.\./g) ?? []).length <= 2) {
    stored = relative.split(node_path.sep).join("/");
  }
  return { name: folder.name, path: stored };
}

function registerWorkflowHandlers() {

  electron.ipcMain.handle("workflow:open", async (_event, workflowPath) => {
    if (!isWorkflowPath(workflowPath)) {
      return { error: "That is not a Wide workflow file." };
    }
    let text;
    try {
      const stats = await promises.stat(workflowPath);
      if (stats.size > MAX_WORKFLOW_BYTES) return { error: "That workflow file is too large." };
      text = await promises.readFile(workflowPath, "utf8");
    } catch {
      return { error: "That workflow could not be read." };
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      return { error: `That workflow is not valid JSON: ${error.message}` };
    }
    if (!parsed || !Array.isArray(parsed.folders)) {
      return { error: "That workflow has no folders in it." };
    }

    const dir = node_path.dirname(workflowPath);
    const seen = new Set();
    const folders = [];
    for (const entry of parsed.folders.slice(0, MAX_WORKFLOW_FOLDERS)) {
      const folder = resolveFolder(dir, entry);
      if (!folder) continue;

      const key = folder.path.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      folders.push({ ...folder, missing: !(await isDirectory(folder.path)) });
    }
    if (folders.length === 0) return { error: "That workflow has no folders in it." };

    return {
      path: workflowPath,
      name: node_path.basename(workflowPath, WORKFLOW_EXTENSION),
      folders,
      settings: parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {},
    };
  });

  electron.ipcMain.handle("workflow:create", async (_event, workflowPath, folders) => {
    if (!isWorkflowPath(workflowPath)) {
      return { error: "A workflow file must end in .wideflow." };
    }
    const list = (Array.isArray(folders) ? folders : [])
      .map((folder) => ({
        path: typeof folder?.path === "string" ? folder.path : "",
        name: typeof folder?.name === "string" ? folder.name : "",
      }))
      .filter((folder) => folder.path);
    if (list.length === 0) return { error: "A workflow needs at least one folder." };

    const dir = node_path.dirname(workflowPath);
    const resolved = [];
    const seen = new Set();
    for (const folder of list.slice(0, MAX_WORKFLOW_FOLDERS)) {
      const absolute = node_path.resolve(folder.path);
      const key = absolute.toLowerCase();
      if (seen.has(key)) continue;
      if (!(await isDirectory(absolute))) return { error: `There is no folder at ${absolute}` };
      seen.add(key);
      resolved.push({ path: absolute, name: folder.name || node_path.basename(absolute) });
    }

    const document = {

      wideflow: WORKFLOW_VERSION,
      folders: resolved.map((folder) => storeFolder(dir, folder)),
      settings: {},
    };
    try {

      await promises.writeFile(workflowPath, `${JSON.stringify(document, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if (error.code === "EEXIST") return { error: "A workflow with that name is already there." };
      return { error: error.message };
    }

    return {
      path: workflowPath,
      name: node_path.basename(workflowPath, WORKFLOW_EXTENSION),
      folders: resolved.map((folder) => ({ ...folder, missing: false })),
      settings: {},
    };
  });

  electron.ipcMain.handle("workflow:setFolders", async (_event, workflowPath, folders) => {
    if (!isWorkflowPath(workflowPath)) return { error: "That is not a Wide workflow file." };

    let existing = {};
    try {
      existing = JSON.parse(await promises.readFile(workflowPath, "utf8"));
    } catch {

    }

    const dir = node_path.dirname(workflowPath);
    const resolved = [];
    const seen = new Set();
    for (const folder of (Array.isArray(folders) ? folders : []).slice(0, MAX_WORKFLOW_FOLDERS)) {
      if (typeof folder?.path !== "string" || !folder.path) continue;
      const absolute = node_path.resolve(folder.path);
      const key = absolute.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      resolved.push({ path: absolute, name: folder.name || node_path.basename(absolute) });
    }
    if (resolved.length === 0) return { error: "A workflow needs at least one folder." };

    const document = {
      wideflow: WORKFLOW_VERSION,
      folders: resolved.map((folder) => storeFolder(dir, folder)),
      settings: existing?.settings && typeof existing.settings === "object" ? existing.settings : {},
    };
    try {
      await promises.writeFile(workflowPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
    } catch (error) {
      return { error: error.message };
    }
    return {
      path: workflowPath,
      name: node_path.basename(workflowPath, WORKFLOW_EXTENSION),
      folders: resolved.map((folder) => ({ ...folder, missing: false })),
      settings: document.settings,
    };
  });
}
