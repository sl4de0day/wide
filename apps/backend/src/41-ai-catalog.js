

const HF_HOST = "huggingface.co";
const OLLAMA_WEB_HOST = "ollama.com";
const CATALOG_TIMEOUT_MS = 20000;

const CATALOG_HEADERS = {
  "user-agent": "Wide/1.0 (+https://codeberg.org) Mozilla/5.0",
  "accept-language": "en",
};

function catalogGet(host, path, extraHeaders = {}, redirects = 4) {
  return new Promise((resolve, reject) => {
    if (redirects < 0) {
      reject(new Error("Too many redirects."));
      return;
    }
    const request = node_https.get(
      {
        host,
        path,
        headers: { ...CATALOG_HEADERS, ...extraHeaders, "accept-encoding": "identity" },
        timeout: CATALOG_TIMEOUT_MS,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          const next = new URL(response.headers.location, `https://${host}${path}`);
          resolve(catalogGet(next.host, next.pathname + next.search, extraHeaders, redirects - 1));
          return;
        }
        let body = "";
        response.on("data", (chunk) => {

          if (body.length < 4 * 1024 * 1024) body += chunk.toString("utf8");
        });
        response.on("end", () =>
          status === 200
            ? resolve(body)
            : reject(new Error(`${host} answered ${status}.`))
        );
      }
    );
    request.on("timeout", () => {
      request.destroy();
      reject(new Error(`${host} did not answer in time.`));
    });
    request.on("error", reject);
  });
}

const QUANT_PATTERN = /\b(IQ\d+_[A-Z]+|Q\d+_[0-9KSML]+(?:_[A-Z]+)?|F16|F32|BF16|FP16|FP8)\b/i;

function quantOf(fileName) {
  const match = QUANT_PATTERN.exec(fileName.replace(/\.gguf$/i, ""));
  return match ? match[1].toUpperCase() : "";
}

function splitPart(fileName) {
  const match = /-(\d{5})-of-(\d{5})\.gguf$/i.exec(fileName);
  if (!match) return null;
  return { index: Number(match[1]), total: Number(match[2]) };
}

async function searchHuggingFace(query, limit) {
  const path =
    `/api/models?search=${encodeURIComponent(query)}` +
    `&filter=gguf&sort=downloads&direction=-1&limit=${limit}`;
  const body = await catalogGet(HF_HOST, path);
  const parsed = JSON.parse(body);
  return (Array.isArray(parsed) ? parsed : []).map((entry) => ({
    source: "huggingface",
    id: entry.id,
    name: entry.id,
    downloads: entry.downloads ?? 0,
    likes: entry.likes ?? 0,
    updated: entry.lastModified ?? "",
    gated: Boolean(entry.gated),
  }));
}

async function searchOllamaLibrary(query) {
  const path = `/library?q=${encodeURIComponent(query)}&sort=popular`;
  const body = await catalogGet(OLLAMA_WEB_HOST, path, {
    "hx-request": "true",
    "hx-target": "repo",
  });

  const found = new Map();
  const linkPattern = /href="\/library\/([a-z0-9][a-z0-9._-]*)"/gi;
  let match;
  while ((match = linkPattern.exec(body)) !== null) {
    const slug = match[1];
    if (found.has(slug)) continue;

    const after = body.slice(match.index, match.index + 4000);
    const pulls = /<span>([\d.]+[KMB]?)<\/span>\s*<span[^>]*>\s*(?:&nbsp;)?Pulls/i.exec(after);
    found.set(slug, {
      source: "ollama",
      id: slug,
      name: slug,
      downloads: pulls ? expandCount(pulls[1]) : 0,
      likes: 0,
      updated: "",
      gated: false,
    });
  }
  return [...found.values()];
}

function expandCount(text) {
  const match = /^([\d.]+)([KMB])?$/i.exec(text.trim());
  if (!match) return 0;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[(match[2] ?? "").toUpperCase()] ?? 1;
  return Math.round(Number(match[1]) * scale);
}

async function huggingFaceFiles(id) {
  const body = await catalogGet(HF_HOST, `/api/models/${id}/tree/main`);
  const entries = JSON.parse(body);
  const files = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    const path = entry.path ?? "";
    if (!path.toLowerCase().endsWith(".gguf")) continue;
    const part = splitPart(path);

    if (part && part.index !== 1) continue;
    files.push({
      path,
      size: entry.lfs?.size ?? entry.size ?? 0,
      quant: quantOf(path),
      split: part ? part.total : 0,
    });
  }

  files.sort((a, b) => a.size - b.size);
  return files;
}

const AI_RECOMMENDED = [
  { label: "Qwen3-Coder 30B-A3B", vendor: "Alibaba", query: "Qwen3-Coder-30B-A3B-Instruct" },
  { label: "gpt-oss 20B", vendor: "OpenAI", query: "gpt-oss-20b" },
  { label: "Devstral Small 2", vendor: "Mistral AI", query: "Devstral-Small-2" },
  { label: "DeepSeek-R1-Distill 32B", vendor: "DeepSeek", query: "DeepSeek-R1-Distill-Qwen-32B" },
  { label: "GLM Z1 32B", vendor: "Zhipu AI", query: "GLM-Z1-32B" },
  { label: "Kimi K3", vendor: "Moonshot AI", query: "Kimi-K3" },
  { label: "Codestral 2", vendor: "Mistral AI", query: "Codestral" },
  { label: "Gemma 4 31B", vendor: "Google", query: "gemma-4-31B" },
  { label: "Yi-Coder 9B", vendor: "01.AI", query: "Yi-9B-Coder" },
  { label: "Granite Code 20B", vendor: "IBM", query: "granite-20b-code-instruct" },
];

function registerAiCatalogHandlers() {

  electron.ipcMain.handle("ai:search", async (_event, query, limit) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const text = String(query ?? "").trim();
    if (text.length < 2) return { ok: true, results: [] };

    const count = Math.min(Math.max(Number(limit) || 20, 1), 50);
    const [hugging, ollama] = await Promise.allSettled([
      searchHuggingFace(text, count),
      searchOllamaLibrary(text),
    ]);

    const results = [
      ...(ollama.status === "fulfilled" ? ollama.value : []),
      ...(hugging.status === "fulfilled" ? hugging.value : []),
    ];
    return {
      ok: true,
      results,

      failed: [
        hugging.status === "rejected" ? "huggingface" : null,
        ollama.status === "rejected" ? "ollama" : null,
      ].filter(Boolean),
    };
  });

  electron.ipcMain.handle("ai:files", async (_event, source, id) => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    try {
      if (source === "huggingface") {
        const files = await huggingFaceFiles(String(id ?? ""));
        const hardware = await aiHardware();
        return {
          ok: true,
          files: files.map((file) => ({
            ...file,
            ...aiFitFor(file.size, hardware),

            reference: `hf.co/${id}:${file.quant || file.path}`,
          })),
        };
      }

      const body = await catalogGet(OLLAMA_WEB_HOST, `/library/${id}/tags`);
      const hardware = await aiHardware();
      const files = [];
      const seen = new Set();
      const rowPattern = /href="\/library\/([^"]+:[^"]+)"[\s\S]{0,600}?([\d.]+)(MB|GB|TB)/gi;
      let match;
      while ((match = rowPattern.exec(body)) !== null) {
        const reference = match[1];
        if (seen.has(reference)) continue;
        seen.add(reference);
        const scale = { MB: 1e6, GB: 1e9, TB: 1e12 }[match[3].toUpperCase()] ?? 1;
        const size = Math.round(Number(match[2]) * scale);
        files.push({
          path: reference,
          size,
          quant: reference.split(":")[1] ?? "",
          split: 0,
          reference,
          ...aiFitFor(size, hardware),
        });
      }
      return { ok: true, files };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  electron.ipcMain.handle("ai:recommended", async () => {
    const gate = await requireInstalled("ai-assistant");
    if (gate) return gate;
    const hardware = await aiHardware();
    const resolved = await Promise.all(
      AI_RECOMMENDED.map(async (entry) => {
        try {
          const hits = await searchHuggingFace(entry.query, 3);
          const best = hits[0];
          if (!best) return { ...entry, found: false };
          return { ...entry, found: true, source: "huggingface", id: best.id, downloads: best.downloads };
        } catch {
          return { ...entry, found: false };
        }
      })
    );
    return { ok: true, models: resolved, hardware };
  });
}
