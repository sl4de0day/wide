const OSV_SNAPSHOT_META = { source: "OSV / GHSA curated", snapshot: "2026-09", note: "Offline advisory snapshot; extend or override per project via .wide/osv.json" };

const OSV_SNAPSHOT = {
  npm: [
    { name: "handlebars", lt: "4.7.7", id: "CVE-2021-23369", cwe: "CWE-1336", sev: "high", note: "remote code execution via the compiler when compiling templates from untrusted input" },
    { name: "ws", lt: "7.4.6", id: "CVE-2021-32640", cwe: "CWE-1333", sev: "medium", note: "ReDoS when parsing crafted Sec-WebSocket-Protocol headers" },
    { name: "async", lt: "2.6.4", id: "CVE-2021-43138", cwe: "CWE-1321", sev: "high", note: "prototype pollution in the mapValues() helper" },
    { name: "json5", lt: "2.2.2", id: "CVE-2022-46175", cwe: "CWE-1321", sev: "high", note: "prototype pollution via __proto__ when parsing" },
    { name: "minimatch", lt: "3.0.5", id: "CVE-2022-3517", cwe: "CWE-1333", sev: "high", note: "ReDoS in brace-expansion / glob parsing" },
    { name: "word-wrap", lt: "1.2.4", id: "CVE-2023-26115", cwe: "CWE-1333", sev: "medium", note: "ReDoS on long inputs without whitespace" },
    { name: "tough-cookie", lt: "4.1.3", id: "CVE-2023-26136", cwe: "CWE-1321", sev: "medium", note: "prototype pollution in cookie memstore" },
    { name: "follow-redirects", lt: "1.15.4", id: "CVE-2023-26159", cwe: "CWE-601", sev: "medium", note: "improper URL handling allows following a malformed location" },
    { name: "express", lt: "4.19.2", id: "CVE-2024-29041", cwe: "CWE-601", sev: "medium", note: "open redirect via a malformed URL passed to res.location/redirect" },
    { name: "braces", lt: "3.0.3", id: "CVE-2024-4068", cwe: "CWE-400", sev: "high", note: "uncontrolled resource consumption on crafted brace patterns" },
    { name: "micromatch", lt: "4.0.8", id: "CVE-2024-4067", cwe: "CWE-1333", sev: "medium", note: "ReDoS in the pattern parser" },
    { name: "y18n", lt: "4.0.1", id: "CVE-2020-7774", cwe: "CWE-1321", sev: "high", note: "prototype pollution via the locale setter" },
    { name: "qs", lt: "6.5.3", id: "CVE-2022-24999", cwe: "CWE-1321", sev: "high", note: "prototype pollution / DoS when parsing crafted query strings" },
  ],
  pip: [
    { name: "flask", lt: "2.2.5", id: "CVE-2023-30861", cwe: "CWE-539", sev: "high", note: "cached response may leak a session cookie to the wrong client" },
    { name: "werkzeug", lt: "2.2.3", id: "CVE-2023-25577", cwe: "CWE-400", sev: "high", note: "denial of service via many multipart form parts" },
    { name: "urllib3", lt: "1.26.5", id: "CVE-2021-33503", cwe: "CWE-1333", sev: "high", note: "ReDoS when parsing crafted URLs" },
    { name: "pillow", lt: "9.0.1", id: "CVE-2022-22817", cwe: "CWE-94", sev: "critical", note: "arbitrary expression evaluation in PIL.ImageMath.eval" },
    { name: "setuptools", lt: "65.5.1", id: "CVE-2022-40897", cwe: "CWE-1333", sev: "high", note: "ReDoS in package_index when scanning a crafted index page" },
    { name: "cryptography", lt: "3.3.2", id: "CVE-2020-36242", cwe: "CWE-787", sev: "high", note: "buffer overflow when decrypting very large ciphertexts with Fernet/HKDF" },
  ],
  maven: [
    { name: "snakeyaml", lt: "2.0", id: "CVE-2022-1471", cwe: "CWE-502", sev: "high", note: "remote code execution via the default constructor when loading untrusted YAML" },
    { name: "spring-beans", ge: "5.3.0", lt: "5.3.18", id: "CVE-2022-22965", cwe: "CWE-94", sev: "critical", note: "Spring4Shell — data-binding remote code execution" },
    { name: "jackson-databind", ge: "2.0.0", lt: "2.12.7", id: "CVE-2020-36518", cwe: "CWE-787", sev: "high", note: "denial of service via deeply nested JSON" },
    { name: "commons-collections", lt: "3.2.2", id: "CVE-2015-6420", cwe: "CWE-502", sev: "high", note: "remote code execution via unsafe deserialization gadget chains" },
    { name: "guava", ge: "1.0", lt: "32.0.0", id: "CVE-2023-2976", cwe: "CWE-379", sev: "medium", note: "local information disclosure via world-readable temporary directories" },
    { name: "httpclient", lt: "4.5.13", id: "CVE-2020-13956", cwe: "CWE-644", sev: "medium", note: "improper URI parsing can mislead request routing" },
  ],
  go: [
    { name: "golang.org/x/net", lt: "0.17.0", id: "CVE-2023-39325", cwe: "CWE-400", sev: "high", note: "HTTP/2 rapid reset denial of service" },
    { name: "golang.org/x/crypto", lt: "0.17.0", id: "CVE-2023-48795", cwe: "CWE-222", sev: "medium", note: "Terrapin — SSH transcript truncation weakens the handshake" },
    { name: "github.com/gin-gonic/gin", lt: "1.9.1", id: "CVE-2023-29401", cwe: "CWE-494", sev: "medium", note: "unsafe filename handling in Context.FileAttachment" },
  ],
};

function osvFilePath(root) {
  return node_path.join(root, ".wide", "osv.json");
}

function osvCountEntries(doc) {
  if (!doc || typeof doc !== "object") return 0;
  if (Array.isArray(doc)) return doc.length;
  if (Array.isArray(doc.entries)) return doc.entries.length;
  if (Array.isArray(doc.vulns)) return doc.vulns.length;
  let n = 0;
  for (const eco of ["npm", "pip", "maven", "go"]) if (Array.isArray(doc[eco])) n += doc[eco].length;
  return n;
}

function osvCollectFromScanner(doc) {
  const out = [];
  const results = doc && Array.isArray(doc.results) ? doc.results : [];
  for (const result of results) {
    const packages = result && Array.isArray(result.packages) ? result.packages : [];
    for (const pkg of packages) {
      const vulns = pkg && Array.isArray(pkg.vulnerabilities) ? pkg.vulnerabilities : [];
      for (const vuln of vulns) if (vuln && typeof vuln === "object") out.push(vuln);
    }
  }
  return out;
}

function osvCollectFromAny(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && Array.isArray(doc.results)) return osvCollectFromScanner(doc);
  if (doc && Array.isArray(doc.entries)) return doc.entries;
  if (doc && Array.isArray(doc.vulns)) return doc.vulns;
  return [];
}

function runOsvScanner(root) {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    const args = ["--format", "json", "-r", "."];
    let child;
    try {
      if (win) {
        child = node_child_process.spawn(["osv-scanner", ...args].join(" "), { cwd: root, shell: true, windowsHide: true });
      } else {
        child = node_child_process.spawn("osv-scanner", args, { cwd: root, windowsHide: true });
      }
    } catch (error) {
      resolve({ output: "", error: String((error && error.message) || error) });
      return;
    }
    let output = "";
    let err = "";
    child.stdout.on("data", (c) => { if (output.length < 8 * 1024 * 1024) output += c.toString("utf8"); });
    child.stderr.on("data", (c) => { if (err.length < 65536) err += c.toString("utf8"); });
    child.on("error", (error) => resolve({ output, error: String((error && error.message) || error) }));
    child.on("close", () => resolve({ output, error: err }));
  });
}

function registerOsvHandlers() {
  electron.ipcMain.handle("osv:info", async (_event, root) => {
    if (!root || typeof root !== "string") return { ok: false };
    try {
      const raw = await promises.readFile(osvFilePath(root), "utf8");
      const doc = JSON.parse(raw);
      let updatedAt = doc && doc.updatedAt ? doc.updatedAt : null;
      if (!updatedAt) {
        const stat = await promises.stat(osvFilePath(root));
        updatedAt = new Date(stat.mtimeMs).toISOString();
      }
      return { ok: true, exists: true, updatedAt, count: osvCountEntries(doc) };
    } catch {
      return { ok: true, exists: false };
    }
  });

  electron.ipcMain.handle("osv:refresh", async (_event, root, dumpPath) => {
    if (!root || typeof root !== "string") return { ok: false, error: "No project." };
    let entries = [];
    if (dumpPath && typeof dumpPath === "string") {
      try {
        entries = osvCollectFromAny(JSON.parse(await promises.readFile(dumpPath, "utf8")));
      } catch {
        return { ok: false, error: "That OSV dump could not be read." };
      }
    } else {
      const res = await runOsvScanner(root);
      try {
        entries = osvCollectFromScanner(JSON.parse(res.output));
      } catch {
        return { ok: false, error: res.error && /ENOENT|not recognized|not found/i.test(res.error) ? "osv-scanner is not installed or not on PATH." : "osv-scanner produced no readable JSON." };
      }
    }
    const doc = { tool: "osv-scanner", updatedAt: new Date().toISOString(), entries };
    try {
      await promises.mkdir(node_path.join(root, ".wide"), { recursive: true });
      await promises.writeFile(osvFilePath(root), JSON.stringify(doc, null, 2), "utf8");
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
    return { ok: true, count: entries.length };
  });
}
