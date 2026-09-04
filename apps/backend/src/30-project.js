

const MANIFESTS = [
  {
    file: "package.json",
    runner: "npm run",
    read: (raw) => {
      const manifest2 = JSON.parse(raw);
      return {
        name: manifest2.name ?? null,
        tasks: Object.entries(manifest2.scripts ?? {}).map(([name, command]) => ({
          name,
          detail: String(command)
        }))
      };
    }
  },
  {
    file: "composer.json",
    runner: "composer run",
    read: (raw) => {
      const manifest2 = JSON.parse(raw);
      const declared = manifest2.scripts ?? {};
      return {
        name: manifest2.name ?? null,
        tasks: Object.keys(declared).map((name) => ({
          name,
          detail: Array.isArray(declared[name]) ? declared[name].join(" && ") : String(declared[name])
        }))
      };
    }
  },
  {
    file: "Makefile",

    runner: "make",
    read: (raw) => ({
      name: null,
      tasks: [...raw.matchAll(/^([A-Za-z0-9][\w.-]*)[ \t]*:(?!=)/gm)]
        .map((match) => ({ name: match[1], detail: null }))
        .filter((task, index, list) => list.findIndex((other) => other.name === task.name) === index)
    })
  },
  {
    file: "mix.exs",
    runner: "mix",
    read: (raw) => {

      const at = raw.indexOf("aliases:");
      let block = "";
      if (at !== -1) {
        const open = raw.indexOf("[", at);
        if (open !== -1) {
          let depth = 0;
          for (let i = open; i < raw.length; i += 1) {
            if (raw[i] === "[") depth += 1;
            else if (raw[i] === "]") {
              depth -= 1;
              if (depth === 0) {
                block = raw.slice(open + 1, i);
                break;
              }
            }
          }
        }
      }

      const tasks = [];
      let depth = 0;
      let current = "";
      for (let i = 0; i < block.length; i += 1) {
        const ch = block[i];
        if (ch === "[") depth += 1;
        else if (ch === "]") depth -= 1;
        if (depth === 0) current += ch;
      }
      for (const match of current.matchAll(/"?([a-z][\w.]*)"?:\s*/g)) {
        tasks.push({ name: match[1], detail: null });
      }

      for (const name of ["deps.get", "compile", "test"]) {
        if (!tasks.some((task) => task.name === name)) tasks.push({ name, detail: null });
      }
      return { name: /app:\s*:([a-z_]+)/.exec(raw)?.[1] ?? null, tasks };
    }
  },
  {
    file: "Cargo.toml",
    runner: "cargo",
    read: (raw) => ({
      name: /^\s*name\s*=\s*"([^"]+)"/m.exec(raw)?.[1] ?? null,
      tasks: ["build", "run", "test", "check", "clippy", "fmt"].map((name) => ({ name, detail: null }))
    })
  },
  {
    file: "go.mod",
    runner: "go",
    read: (raw) => ({
      name: /^module\s+(\S+)/m.exec(raw)?.[1] ?? null,
      tasks: ["build ./...", "run .", "test ./...", "vet ./...", "mod tidy"].map((name) => ({
        name,
        detail: null
      }))
    })
  },
  {
    file: "Rakefile",
    runner: "rake",
    read: (raw) => ({
      name: null,
      tasks: [...raw.matchAll(/^\s*task\s+:?["']?([\w:-]+)/gm)].map((match) => ({
        name: match[1],
        detail: null
      }))
    })
  },
  {
    file: "pom.xml",
    runner: "mvn",
    read: (raw) => ({
      name: /<artifactId>([^<]+)<\/artifactId>/.exec(raw)?.[1] ?? null,
      tasks: ["compile", "test", "package", "verify", "clean"].map((name) => ({ name, detail: null }))
    })
  },
  {
    file: "build.gradle",
    runner: "gradle",
    read: () => ({
      name: null,
      tasks: ["build", "test", "run", "clean"].map((name) => ({ name, detail: null }))
    })
  },
  {
    file: "build.gradle.kts",
    runner: "gradle",
    read: () => ({
      name: null,
      tasks: ["build", "test", "run", "clean"].map((name) => ({ name, detail: null }))
    })
  },
  {
    file: "pyproject.toml",
    runner: "",
    read: (raw) => {
      const section = /\[project\.scripts\]([\s\S]*?)(?=\n\[|$)/.exec(raw);
      const tasks = section
        ? [...section[1].matchAll(/^\s*([\w.-]+)\s*=/gm)].map((match) => ({
            name: match[1],
            detail: null
          }))
        : [];
      return { name: /^\s*name\s*=\s*"([^"]+)"/m.exec(raw)?.[1] ?? null, tasks };
    }
  }
];

const TAILWIND_STYLE_EXTENSIONS = /\.(?:css|pcss|postcss)$/;
const TAILWIND_MAX_FILES = 200;
const TAILWIND_MAX_BYTES = 512 * 1024;

function readThemeBlocks(source) {
  const tokens = [];
  let at = 0;
  for (;;) {
    const start = source.indexOf("@theme", at);
    if (start === -1) break;
    const open = source.indexOf("{", start);
    if (open === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    const body = source.slice(open + 1, end);
    for (const match of body.matchAll(/(--[A-Za-z0-9_-]+)\s*:\s*([^;}]+)/g)) {
      tokens.push({ name: match[1], value: match[2].trim() });
    }
    at = end + 1;
  }
  return tokens;
}

async function scanTailwindTheme(root) {
  const seen = new Map();
  let usesTailwind = false;
  let files = 0;

  const visit = async (dir2) => {
    if (files >= TAILWIND_MAX_FILES) return;
    let entries;
    try {
      entries = await promises.readdir(dir2, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files >= TAILWIND_MAX_FILES) return;
      const full = node_path.join(dir2, entry.name);
      if (entry.isDirectory()) {
        if (!IGNORED$1.has(entry.name)) await visit(full);
        continue;
      }
      if (!TAILWIND_STYLE_EXTENSIONS.test(entry.name)) continue;
      let text;
      try {
        const info = await promises.stat(full);
        if (info.size > TAILWIND_MAX_BYTES) continue;
        text = await promises.readFile(full, "utf8");
      } catch {
        continue;
      }
      files += 1;
      if (/@import\s+["']tailwindcss["']|@tailwind\s+(?:base|utilities)/.test(text)) {
        usesTailwind = true;
      }
      for (const token of readThemeBlocks(text)) {

        if (!seen.has(token.name)) seen.set(token.name, token.value);
      }
    }
  };

  await visit(root);
  if (seen.size > 0) usesTailwind = true;
  return {
    usesTailwind,
    filesScanned: files,
    tokens: [...seen].map(([name, value]) => ({ name, value })),
  };
}

function registerProjectHandlers() {
  electron.ipcMain.handle("project:tailwind", async (_event, root) => {
    if (!root) return { usesTailwind: false, tokens: [], filesScanned: 0 };
    try {
      return await scanTailwindTheme(root);
    } catch (error) {
      return { usesTailwind: false, tokens: [], filesScanned: 0, error: error.message };
    }
  });
  electron.ipcMain.handle("project:scripts", async (_event, root) => {
    if (!root) return { scripts: [], packageName: null };
    const scripts = [];
    const errors = [];
    let packageName = null;
    for (const source of MANIFESTS) {
      let raw;
      try {
        raw = await promises.readFile(node_path.join(root, source.file), "utf8");
      } catch (error) {
        if (error.code !== "ENOENT") errors.push(`${source.file}: ${error.message}`);
        continue;
      }
      try {
        const found = source.read(raw);
        if (found.name && !packageName) packageName = found.name;
        for (const task of found.tasks) {
          scripts.push({
            name: task.name,
            command: `${source.runner} ${task.name}`.trim(),
            detail: task.detail ?? null,
            manifest: source.file
          });
        }
      } catch (error) {
        errors.push(`${source.file}: ${error.message}`);
      }
    }
    return { scripts, packageName, error: errors.length ? errors.join("; ") : void 0 };
  });

}
function resolveInProject(root, candidate) {
  if (!root) throw new Error("No project is open.");
  if (typeof candidate !== "string" || candidate.length === 0) {
    throw new Error("Invalid path.");
  }
  const target = node_path.isAbsolute(candidate) ? candidate : node_path.join(root, candidate);
  const rel = node_path.relative(root, target);
  if (rel.startsWith("..") || node_path.isAbsolute(rel)) {
    throw new Error(`Access outside the project was denied: ${candidate}`);
  }
  return target;
}
