const TEST_IGNORE = new Set([".git", "node_modules", "dist", "out", "build", ".next", ".nuxt", "coverage", ".venv", "venv", "target", "__pycache__", ".cache", "vendor", ".idea", ".vscode"]);
const TEST_MAX_FILES = 4000;
const TEST_MAX_BYTES = 1024 * 1024;

async function testReadSafe(file) {
  try {
    const stat = await promises.stat(file);
    if (stat.size > TEST_MAX_BYTES || stat.size === 0) return null;
    return await promises.readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function testExists(root, name) {
  try {
    await promises.access(node_path.join(root, name));
    return true;
  } catch {
    return false;
  }
}

async function detectFramework(root) {
  const pkgRaw = await testReadSafe(node_path.join(root, "package.json"));
  if (pkgRaw) {
    try {
      const pkg = JSON.parse(pkgRaw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      if (deps.vitest) return "vitest";
      if (deps.jest) return "jest";
      if (pkg.scripts && typeof pkg.scripts.test === "string") {
        if (/vitest/.test(pkg.scripts.test)) return "vitest";
        if (/jest/.test(pkg.scripts.test)) return "jest";
      }
    } catch {
      void 0;
    }
  }
  if ((await testExists(root, "pyproject.toml")) || (await testExists(root, "pytest.ini")) || (await testExists(root, "setup.cfg"))) return "pytest";
  if (await testExists(root, "go.mod")) return "go";
  if (await testExists(root, "Cargo.toml")) return "cargo";
  return null;
}

async function* testWalk(root, budget) {
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = node_path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (TEST_IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;
        stack.push(full);
      } else if (entry.isFile()) {
        if (budget.files >= TEST_MAX_FILES) return;
        budget.files += 1;
        yield full;
      }
    }
  }
}

function isTestFile(rel, framework) {
  const name = rel.split(/[\\/]/).pop() || "";
  if (framework === "vitest" || framework === "jest") return /\.(test|spec)\.(m|c)?[jt]sx?$/.test(name) || /(^|[\\/])__tests__[\\/]/.test(rel);
  if (framework === "pytest") return /^test_.*\.py$/.test(name) || /_test\.py$/.test(name) || /(^|[\\/])tests?[\\/].*\.py$/.test(rel);
  if (framework === "go") return /_test\.go$/.test(name);
  if (framework === "cargo") return /\.rs$/.test(name);
  return false;
}

function parseCases(content, framework) {
  const lines = content.split("\n");
  const cases = [];
  if (framework === "vitest" || framework === "jest") {
    const re = /(?:^|[^.\w])(?:it|test)\s*(?:\.\w+)?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/;
    for (let i = 0; i < lines.length; i += 1) {
      const m = re.exec(lines[i]);
      if (m && m[2].trim()) cases.push({ name: m[2], line: i + 1 });
    }
  } else if (framework === "pytest") {
    const re = /^\s*(?:async\s+)?def\s+(test_\w+)\s*\(/;
    for (let i = 0; i < lines.length; i += 1) {
      const m = re.exec(lines[i]);
      if (m) cases.push({ name: m[1], line: i + 1 });
    }
  } else if (framework === "go") {
    const re = /^func\s+(Test\w+)\s*\(/;
    for (let i = 0; i < lines.length; i += 1) {
      const m = re.exec(lines[i]);
      if (m) cases.push({ name: m[1], line: i + 1 });
    }
  } else if (framework === "cargo") {
    for (let i = 0; i < lines.length; i += 1) {
      if (/#\[(?:\w+::)?(?:tokio::)?test\]/.test(lines[i]) || /#\[test\]/.test(lines[i])) {
        for (let j = i + 1; j < Math.min(lines.length, i + 4); j += 1) {
          const m = /\bfn\s+(\w+)\s*\(/.exec(lines[j]);
          if (m) {
            cases.push({ name: m[1], line: j + 1 });
            break;
          }
        }
      }
    }
  }
  return cases;
}

async function discoverTests(root, framework) {
  const budget = { files: 0 };
  const files = [];
  for await (const full of testWalk(root, budget)) {
    const rel = node_path.relative(root, full).split(node_path.sep).join("/");
    if (!isTestFile(rel, framework)) continue;
    const content = await testReadSafe(full);
    if (content === null) continue;
    const cases = parseCases(content, framework);
    if (framework === "cargo" && cases.length === 0) continue;
    if (cases.length === 0 && framework !== "cargo") continue;
    files.push({ file: node_path.normalize(full), rel, cases });
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return files;
}

function spawnTest(root, command, args) {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    let child;
    try {
      if (win) {
        const line = [command, ...args].map((a) => (/[\s"^&|<>()]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(" ");
        child = node_child_process.spawn(line, { cwd: root, shell: true, windowsHide: true });
      } else {
        child = node_child_process.spawn(command, args, { cwd: root, windowsHide: true });
      }
    } catch (error) {
      resolve({ code: -1, output: String((error && error.message) || error) });
      return;
    }
    let output = "";
    const cap = 512 * 1024;
    const add = (chunk) => {
      if (output.length < cap) output += chunk.toString("utf8");
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    child.on("error", (error) => resolve({ code: -1, output: output + String((error && error.message) || error) }));
    child.on("close", (code) => resolve({ code: code == null ? -1 : code, output }));
  });
}

function testCommand(framework, rel, name) {
  if (framework === "vitest") {
    const args = ["vitest", "run"];
    if (rel) args.push(rel);
    if (name) args.push("-t", name);
    return { command: "npx", args };
  }
  if (framework === "jest") {
    const args = ["jest"];
    if (rel) args.push(rel);
    if (name) args.push("-t", name);
    return { command: "npx", args };
  }
  if (framework === "pytest") {
    const args = [];
    if (rel && name) args.push(`${rel}::${name}`);
    else if (rel) args.push(rel);
    else if (name) args.push("-k", name);
    return { command: "pytest", args };
  }
  if (framework === "go") {
    const args = ["test"];
    if (name) args.push("-run", `^${name}$`);
    args.push(rel ? "./" + rel.replace(/\/[^/]+$/, "") : "./...");
    return { command: "go", args };
  }
  if (framework === "cargo") {
    const args = ["test"];
    if (name) args.push(name);
    return { command: "cargo", args };
  }
  return null;
}

function parseFailures(framework, output) {
  const failures = new Set();
  const lines = output.split("\n");
  for (const line of lines) {
    if (framework === "go") {
      const m = /^\s*--- FAIL:\s+(\w+)/.exec(line);
      if (m) failures.add(m[1]);
    } else if (framework === "pytest") {
      const m = /^FAILED\s+\S+::(\w+)/.exec(line) || /^(\S+::\w+)\s+FAILED/.exec(line);
      if (m) failures.add(m[1].split("::").pop());
    } else if (framework === "cargo") {
      const m = /^test\s+(\S+)\s+\.\.\.\s+FAILED/.exec(line);
      if (m) failures.add(m[1].split("::").pop());
    } else {
      const m = /^\s*(?:×|✗|✕|FAIL)\s+(.+?)(?:\s+\d+ms)?\s*$/.exec(line);
      if (m) failures.add(m[1].trim());
    }
  }
  return [...failures];
}

function registerTestHandlers() {
  electron.ipcMain.handle("test:discover", async (_event, root) => {
    if (!root || typeof root !== "string") return { ok: false, error: "No project." };
    const framework = await detectFramework(root);
    if (!framework) return { ok: true, framework: null, files: [] };
    try {
      const files = await discoverTests(root, framework);
      return { ok: true, framework, files };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });

  electron.ipcMain.handle("test:run", async (_event, root, framework, target) => {
    if (!root || typeof root !== "string" || !framework) return { ok: false, error: "No test target." };
    const rel = target && typeof target.rel === "string" ? target.rel : "";
    const name = target && typeof target.name === "string" ? target.name : "";
    const spec = testCommand(framework, rel, name);
    if (!spec) return { ok: false, error: "Unsupported framework." };
    const result = await spawnTest(root, spec.command, spec.args);
    return { ok: result.code === 0, code: result.code, output: result.output, failures: parseFailures(framework, result.output) };
  });
}
