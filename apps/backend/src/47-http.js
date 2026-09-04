

const HTTP_TIMEOUT_MS = 30_000;
const HTTP_MAX_BYTES = 8 * 1024 * 1024;
const HTTP_MAX_REDIRECTS = 5;

function decodeBody(raw, encodingHeader) {
  const encoding = String(encodingHeader || "").toLowerCase().trim();
  try {
    if (encoding === "gzip" || encoding === "x-gzip") return node_zlib.gunzipSync(raw);
    if (encoding === "br") return node_zlib.brotliDecompressSync(raw);
    if (encoding === "deflate") return node_zlib.inflateSync(raw);
  } catch {

  }
  return raw;
}

function afterRedirect(status, method, headers, body) {
  if (status === 307 || status === 308) return { method, headers, body };
  if (status === 303 || (method !== "GET" && method !== "HEAD")) {

    const kept = headers.filter(
      ([name]) => !/^content-(length|type|encoding)$/i.test(name),
    );
    return { method: "GET", headers: kept, body: null };
  }
  return { method, headers, body };
}

function sendOnce(target, method, headers, body, redirectsLeft) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(target);
    } catch {
      resolve({ ok: false, error: `That is not a URL: ${target}` });
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      resolve({ ok: false, error: `Only http and https can be sent (${url.protocol}).` });
      return;
    }

    const transport = url.protocol === "https:" ? node_https : node_http;
    const startedAt = Date.now();
    const request = transport.request(
      url,
      { method, headers: Object.fromEntries(headers) },
      (response) => {

        const location = response.headers.location;
        if (
          location &&
          response.statusCode >= 300 &&
          response.statusCode < 400 &&
          redirectsLeft > 0
        ) {
          response.resume();
          const next = new URL(location, url).toString();

          const after = afterRedirect(response.statusCode, method, headers, body);
          resolve(sendOnce(next, after.method, after.headers, after.body, redirectsLeft - 1));
          return;
        }

        const chunks = [];
        let size = 0;
        let truncated = false;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size > HTTP_MAX_BYTES) {
            truncated = true;
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.on("close", () => {

          if (!response.complete && !truncated) {
            resolve({ ok: false, error: "The connection closed before the response finished." });
            return;
          }
          const raw = Buffer.concat(chunks);

          const decoded = truncated ? raw : decodeBody(raw, response.headers["content-encoding"]);
          resolve({
            ok: true,
            status: response.statusCode,
            statusText: response.statusMessage ?? "",
            headers: Object.entries(response.headers).map(([name, value]) => [
              name,
              Array.isArray(value) ? value.join(", ") : String(value ?? ""),
            ]),
            body: decoded.toString("utf8"),
            bytes: size,
            truncated,
            ms: Date.now() - startedAt,
            url: url.toString(),
          });
        });
      },
    );

    request.setTimeout(HTTP_TIMEOUT_MS, () => {
      request.destroy();
      resolve({ ok: false, error: `No answer within ${HTTP_TIMEOUT_MS / 1000}s.` });
    });
    request.on("error", (error) => resolve({ ok: false, error: error.message }));
    if (body) request.write(body);
    request.end();
  });
}

function registerHttpHandlers() {

  electron.ipcMain.handle("http:send", async (_event, url, method = "GET", headers = [], body = null) => {
    if (typeof url !== "string" || !url.trim()) return { ok: false, error: "No address." };
    const safeHeaders = Array.isArray(headers)
      ? headers.filter((pair) => Array.isArray(pair) && typeof pair[0] === "string")
      : [];
    return sendOnce(url.trim(), String(method || "GET").toUpperCase(), safeHeaders, body, HTTP_MAX_REDIRECTS);
  });
}
