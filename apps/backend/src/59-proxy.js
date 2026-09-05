

const PROXY_DIR = () => node_path.join(electron.app.getPath("userData"), "proxy");
const PROXY_CA_CERT = () => node_path.join(PROXY_DIR(), "ca-cert.pem");
const PROXY_CA_KEY = () => node_path.join(PROXY_DIR(), "ca-key.bin");

const forge = require("node-forge");

const PROXY_MAX_BODY = 8 * 1024 * 1024;
const PROXY_MAX_ENTRIES = 500;
const PROXY_TUNNEL_IDLE_MS = 120000;

let proxyServer = null;
let proxyPort = 0;
let proxyCa = null;
let proxyScope = [];
let leafCache = new Map();
const proxyLog = [];
let proxyCounter = 0;

let matchReplaceRules = [];
let intercepting = false;
const pendingIntercepts = new Map();

let interceptingResponses = false;
const pendingResponseIntercepts = new Map();

const liveWebSockets = new Map();

function encodeWsFrame(text, mask) {
  const payload = Buffer.from(String(text ?? ""), "utf8");
  const length = payload.length;
  let header;
  if (length < 126) {
    header = Buffer.alloc(2);
    header[1] = length;
  } else if (length < 65536) {
    header = Buffer.alloc(4);
    header[1] = 126;
    header.writeUInt16BE(length, 2);
  } else {
    header = Buffer.alloc(10);
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(length), 2);
  }
  header[0] = 0x81;
  if (!mask) return Buffer.concat([header, payload]);
  header[1] |= 0x80;
  const key = require("crypto").randomBytes(4);
  const masked = Buffer.alloc(length);
  for (let i = 0; i < length; i += 1) masked[i] = payload[i] ^ key[i % 4];
  return Buffer.concat([header, key, masked]);
}

function pairsToNodeHeaders(pairs) {
  const out = {};
  for (const pair of pairs) {
    if (!Array.isArray(pair) || typeof pair[0] !== "string") continue;
    const name = pair[0];
    const value = pair[1];
    if (out[name] === undefined) out[name] = value;
    else if (Array.isArray(out[name])) out[name].push(value);
    else out[name] = [out[name], value];
  }
  return out;
}

function hasHeaderNamed(pairs, name) {
  const lower = name.toLowerCase();
  return pairs.some((p) => Array.isArray(p) && typeof p[0] === "string" && p[0].toLowerCase() === lower);
}

function sendRequestOnce(request, options = {}) {
  const { method = "GET", url = "", headers = [], body = "" } = request ?? {};
  const followRedirects = options.followRedirects === true;
  const redirectsLeft = options.redirectsLeft ?? (followRedirects ? 5 : 0);
  const chain = options.chain ?? [];
  const started = options.started ?? Date.now();
  let target;
  try {
    target = new URL(url);
  } catch {
    return Promise.resolve({ ok: false, error: "That is not a valid URL." });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return Promise.resolve({ ok: false, error: "Only http and https can be sent." });
  }
  const transport = target.protocol === "https:" ? node_https : node_http;

  const outHeaders = pairsToNodeHeaders(headers);
  if (body && !hasHeaderNamed(headers, "content-length") && !hasHeaderNamed(headers, "transfer-encoding")) {
    outHeaders["Content-Length"] = String(Buffer.byteLength(body));
  }

  return new Promise((resolve) => {
    const outgoing = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        method,
        path: target.pathname + target.search,
        headers: outHeaders,
      },
      (response) => {
        const status = response.statusCode || 0;
        const location = response.headers.location;

        if (followRedirects && location && status >= 300 && status < 400 && redirectsLeft > 0) {
          response.resume();
          const nextUrl = new URL(location, target).toString();
          chain.push({ status, url: target.toString(), location: nextUrl });
          const after = afterRedirect(status, method, headers, body);
          resolve(
            sendRequestOnce(
              { method: after.method, url: nextUrl, headers: after.headers, body: after.body ?? "" },
              { followRedirects, redirectsLeft: redirectsLeft - 1, chain, started },
            ),
          );
          return;
        }
        const chunks = [];
        let size = 0;
        let truncated = false;
        response.on("data", (chunk) => {
          size += chunk.length;
          if (size <= PROXY_MAX_BODY) chunks.push(chunk);
          else truncated = true;
        });
        response.on("end", () => {
          const raw = Buffer.concat(chunks);

          const decoded = truncated ? raw : decodeBody(raw, response.headers["content-encoding"]);
          resolve({
            ok: true,
            status,
            statusText: response.statusMessage || "",
            headers: pairHeaders(response.rawHeaders),
            body: decoded.toString("utf8"),
            bytes: size,
            truncated,
            ms: Date.now() - started,
            url: target.toString(),
            redirects: chain,
          });
        });
      },
    );
    outgoing.on("error", (error) => resolve({ ok: false, error: String(error.message || error) }));
    outgoing.setTimeout(30000, () => outgoing.destroy(new Error("Timed out.")));
    if (body) outgoing.write(body);
    outgoing.end();
  });
}

function fillTemplate(text, vars) {
  return String(text ?? "").replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, name) => (vars.has(name) ? vars.get(name) : whole));
}

function parseSetCookies(headerPairs, jar) {
  for (const [name, value] of headerPairs) {
    if (String(name).toLowerCase() !== "set-cookie") continue;
    const first = String(value).split(";")[0];
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    jar.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
  }
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

async function loadOrMakeCa() {
  if (proxyCa) return proxyCa;
  await promises.mkdir(PROXY_DIR(), { recursive: true });
  let unreadable = false;
  try {
    const certPem = await promises.readFile(PROXY_CA_CERT(), "utf8");
    const keyBlob = await promises.readFile(PROXY_CA_KEY());
    const keyPem = electron.safeStorage.decryptString(keyBlob);
    proxyCa = {
      cert: forge.pki.certificateFromPem(certPem),
      key: forge.pki.privateKeyFromPem(keyPem),
      pem: certPem,
    };
    const isLegacy = electron.safeStorage.isLegacyEncrypted;
    const stale = secretsNeedReseal();
    if (stale || (typeof isLegacy === "function" && isLegacy.call(electron.safeStorage, keyBlob))) {
      try {
        await promises.writeFile(PROXY_CA_KEY(), electron.safeStorage.encryptString(keyPem));
      } catch {

      }
    }
    return proxyCa;
  } catch (error) {
    unreadable = Boolean(error && error.code !== "ENOENT");
  }

  if (unreadable) {
    await preserveUnreadable(PROXY_CA_KEY());
    await preserveUnreadable(PROXY_CA_CERT());
  }

  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 5);
  const attrs = [
    { name: "commonName", value: "Wide Proxy CA" },
    { name: "organizationName", value: "Wide" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.setExtensions([
    { name: "basicConstraints", cA: true },
    { name: "keyUsage", keyCertSign: true, cRLSign: true },
  ]);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
  await promises.writeFile(PROXY_CA_CERT(), certPem, "utf8");
  await promises.writeFile(PROXY_CA_KEY(), electron.safeStorage.encryptString(keyPem));
  proxyCa = { cert, key: keys.privateKey, pem: certPem };
  return proxyCa;
}

let sharedLeafKeys = null;
function leafKeys() {
  if (!sharedLeafKeys) sharedLeafKeys = forge.pki.rsa.generateKeyPair(2048);
  return sharedLeafKeys;
}

function leafFor(host) {
  const cached = leafCache.get(host);
  if (cached) return cached;

  const keys = leafKeys();
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = String(Date.now()) + String(leafCache.size);
  cert.validity.notBefore = new Date(Date.now() - 60 * 1000);
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  cert.setSubject([{ name: "commonName", value: host }]);
  cert.setIssuer(proxyCa.cert.subject.attributes);
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    { name: "keyUsage", digitalSignature: true, keyEncipherment: true },
    { name: "extKeyUsage", serverAuth: true },
    { name: "subjectAltName", altNames: [{ type: 2, value: host }] },
  ]);
  cert.sign(proxyCa.key, forge.md.sha256.create());

  const pair = {
    key: forge.pki.privateKeyToPem(keys.privateKey),
    cert: forge.pki.certificateToPem(cert),
  };

  if (leafCache.size >= 500) {
    const oldest = leafCache.keys().next().value;
    if (oldest !== undefined) leafCache.delete(oldest);
  }
  leafCache.set(host, pair);
  return pair;
}

function inScope(host) {
  const name = String(host || "").toLowerCase().replace(/:\d+$/, "");
  return proxyScope.some((pattern) => {
    if (pattern.startsWith("*.")) {
      const base = pattern.slice(2);
      return name === base || name.endsWith(`.${base}`);
    }
    return name === pattern;
  });
}

function isLoopbackName(host) {
  let name = String(host || "").trim().toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (!name) return false;
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  if (name === "::1" || name === "::" || name === "0:0:0:0:0:0:0:1") return true;
  const mapped = /^::ffff:(.+)$/.exec(name);
  if (mapped) name = mapped[1];
  if (/^\d+$/.test(name)) {
    const packed = Number(name);
    if (Number.isSafeInteger(packed) && packed >= 0 && packed <= 0xffffffff) {
      name = [packed >>> 24, (packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255].join(".");
    }
  } else if (/^0x[0-9a-f]+$/.test(name)) {
    const packed = Number(name);
    if (Number.isSafeInteger(packed) && packed >= 0 && packed <= 0xffffffff) {
      name = [packed >>> 24, (packed >>> 16) & 255, (packed >>> 8) & 255, packed & 255].join(".");
    }
  }
  const octets = name.split(".");
  if (octets.length === 4 && octets.every((part) => /^\d{1,3}$/.test(part))) {
    const first = Number(octets[0]);
    return first === 127 || first === 0;
  }
  return false;
}

function isProxyItself(host, port) {
  if (!proxyPort || Number(port) !== proxyPort) return false;
  return isLoopbackName(host);
}

let trafficBuffer = [];
let trafficTimer = null;
function flushTraffic() {
  if (trafficTimer) clearTimeout(trafficTimer);
  trafficTimer = null;
  if (trafficBuffer.length === 0) return;
  const batch = trafficBuffer;
  trafficBuffer = [];
  broadcast("proxy:traffic", batch);
}
function queueEntry(entry) {
  trafficBuffer.push(entry);
  if (!trafficTimer) trafficTimer = setTimeout(flushTraffic, 50);
}
function recordEntry(entry) {
  proxyLog.push(entry);
  if (proxyLog.length > PROXY_MAX_ENTRIES) proxyLog.shift();
  queueEntry(entry);
}

function readBody(stream, onDone) {
  const chunks = [];
  let size = 0;
  let truncated = false;
  stream.on("data", (chunk) => {
    size += chunk.length;
    if (size <= PROXY_MAX_BODY) chunks.push(chunk);
    else truncated = true;
  });
  stream.on("end", () => onDone(Buffer.concat(chunks), truncated));
  stream.on("error", () => onDone(Buffer.concat(chunks), truncated));
}

function pairHeaders(rawHeaders) {
  const out = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) out.push([rawHeaders[i], rawHeaders[i + 1]]);
  return out;
}

function ruleReplacer(rule) {
  const replacement = rule.replace ?? "";
  if (rule.regex) {
    try {
      const re = new RegExp(rule.match, "g");
      return (text) => text.replace(re, replacement);
    } catch {
      return null;
    }
  }
  if (!rule.match) return null;
  return (text) => text.split(rule.match).join(replacement);
}

function rulesFor(target) {
  return matchReplaceRules.filter((rule) => rule.enabled && rule.target === target);
}

function applyBodyRules(target, body) {
  let text = body;
  for (const rule of rulesFor(target)) {
    const replace = ruleReplacer(rule);
    if (replace) text = replace(text);
  }
  return text;
}

function applyHeaderRules(target, headersObj) {
  const rules = rulesFor(target);
  if (rules.length === 0) return headersObj;
  const lines = [];
  for (const [name, value] of Object.entries(headersObj)) {
    for (const one of Array.isArray(value) ? value : [value]) lines.push(`${name}: ${one}`);
  }
  let text = lines.join("\n");
  for (const rule of rules) {
    const replace = ruleReplacer(rule);
    if (replace) text = replace(text);
  }
  const out = {};
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const name = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (!name) continue;
    if (out[name] === undefined) out[name] = val;
    else out[name] = [].concat(out[name], val);
  }
  return out;
}

function objectToPairs(headersObj) {
  const out = [];
  for (const [name, value] of Object.entries(headersObj)) {
    for (const one of Array.isArray(value) ? value : [value]) out.push([name, String(one)]);
  }
  return out;
}

function pairsToHeaders(pairs) {
  const out = {};
  for (const [name, value] of Array.isArray(pairs) ? pairs : []) {
    if (!name) continue;
    if (out[name] === undefined) out[name] = value;
    else out[name] = [].concat(out[name], value);
  }
  return out;
}

function releaseIntercepts() {
  for (const entry of pendingIntercepts.values()) entry.resolve({ action: "forward" });
  pendingIntercepts.clear();
}

function releaseResponseIntercepts() {
  for (const entry of pendingResponseIntercepts.values()) entry.resolve({ action: "forward" });
  pendingResponseIntercepts.clear();
}

const HOP_BY_HOP = ["connection", "keep-alive", "proxy-connection", "te", "trailer", "upgrade", "transfer-encoding"];

const TEXT_TYPE = /(text\/|application\/(?:json|javascript|xml|xhtml\+xml|x-www-form-urlencoded)|\+json|\+xml)/i;

function forward(scheme, req, res) {
  const host = req.headers.host || "";
  const capture = inScope(host);
  const transport = scheme === "https" ? node_https : node_http;
  const id = ++proxyCounter;
  const startedAt = Date.now();

  res.on("error", () => {});

  const target = new URL(req.url.startsWith("http") ? req.url : `${scheme}://${host}${req.url}`);
  const targetPort = Number(target.port) || (scheme === "https" ? 443 : 80);
  const rewriteResBody = rulesFor("res-body").length > 0;
  const willHold = capture && intercepting;

  const bufferRequest = willHold || rulesFor("req-header").length > 0 || rulesFor("req-body").length > 0;

  let recMethod = req.method;
  let recHeaders = { ...req.headers };
  let recBody = "";
  let recTruncated = false;

  const recordFailure = (status, extra) => {
    if (!capture) return;
    recordEntry({
      id, at: startedAt, ms: Date.now() - startedAt,
      method: recMethod, url: target.toString(), host, scheme, status,
      reqHeaders: objectToPairs(recHeaders), reqBody: recBody, reqTruncated: recTruncated,
      resHeaders: [], resBody: "", ...extra,
    });
  };

  if (isProxyItself(target.hostname, targetPort)) {
    try { res.writeHead(508); } catch {  }
    try { res.end(); } catch {  }
    recordFailure(508, {});
    return;
  }

  const handleResponse = (up) => {
    up.on("error", () => {
      if (!res.headersSent) { try { res.writeHead(502); } catch {  } }
      try { res.end(); } catch {  }
    });
    const resHeaders = applyHeaderRules("res-header", { ...up.headers });
    const contentType = String(up.headers["content-type"] || "");
    const declaredLength = Number(up.headers["content-length"] || 0);

    const canRewriteBody = rewriteResBody && TEXT_TYPE.test(contentType) && declaredLength <= 32 * 1024 * 1024;

    const holdResponse =
      capture && interceptingResponses && TEXT_TYPE.test(contentType) && declaredLength <= 32 * 1024 * 1024;

    if (holdResponse) {
      const chunks = [];
      let size = 0;
      let resTruncated = false;
      up.on("data", (chunk) => {
        size += chunk.length;
        if (size <= PROXY_MAX_BODY) chunks.push(chunk);
        else resTruncated = true;
      });
      up.on("end", async () => {
        let status = up.statusCode || 502;
        let outHeaders = { ...resHeaders };

        const rawBuf = Buffer.concat(chunks);
        let bodyStr = (resTruncated ? rawBuf : decodeBody(rawBuf, outHeaders["content-encoding"])).toString("utf8");
        const response = {
          id,
          status,
          statusText: up.statusMessage || "",
          host,
          url: target.toString(),
          headers: objectToPairs(outHeaders),
          body: bodyStr,
          truncated: resTruncated,
        };
        const decision = await new Promise((resolve) => {
          pendingResponseIntercepts.set(id, { resolve, response });
          broadcast("proxy:interceptResponse", response);
        });
        pendingResponseIntercepts.delete(id);
        if (decision.action === "drop") {
          try {
            res.destroy();
          } catch {

          }
          recordEntry({
            id, at: startedAt, ms: Date.now() - startedAt,
            method: recMethod, url: target.toString(), host, scheme, status,
            reqHeaders: objectToPairs(recHeaders), reqBody: recBody, reqTruncated: recTruncated,
            resHeaders: objectToPairs(outHeaders), resBody: bodyStr, resTruncated, dropped: true,
          });
          return;
        }
        const edited = decision.edited;
        if (edited) {
          if (typeof edited.status === "number") status = edited.status;
          if (Array.isArray(edited.headers)) outHeaders = pairsToHeaders(edited.headers);
          if (typeof edited.body === "string") bodyStr = edited.body;
        }
        const finalBody = Buffer.from(bodyStr, "utf8");
        delete outHeaders["content-length"];
        delete outHeaders["transfer-encoding"];
        delete outHeaders["content-encoding"];
        outHeaders["content-length"] = String(finalBody.length);
        try {
          res.writeHead(status, outHeaders);
          res.end(finalBody);
        } catch {

        }
        recordEntry({
          id, at: startedAt, ms: Date.now() - startedAt,
          method: recMethod, url: target.toString(), host, scheme, status,
          reqHeaders: objectToPairs(recHeaders), reqBody: recBody, reqTruncated: recTruncated,
          resHeaders: objectToPairs(outHeaders), resBody: bodyStr, resTruncated,
        });
      });
      return;
    }

    if (!canRewriteBody) {
      res.writeHead(up.statusCode || 502, resHeaders);
      const captureChunks = [];
      let captureSize = 0;
      let resTruncated = false;
      up.on("data", (chunk) => {
        res.write(chunk);
        if (!capture) return;
        captureSize += chunk.length;
        if (captureSize <= PROXY_MAX_BODY) captureChunks.push(chunk);
        else resTruncated = true;
      });
      up.on("end", () => {
        res.end();
        if (!capture) return;
        recordEntry({
          id, at: startedAt, ms: Date.now() - startedAt,
          method: recMethod, url: target.toString(), host, scheme, status: up.statusCode || 0,
          reqHeaders: objectToPairs(recHeaders), reqBody: recBody, reqTruncated: recTruncated,
          resHeaders: objectToPairs(resHeaders),
          resBody: (resTruncated ? Buffer.concat(captureChunks) : decodeBody(Buffer.concat(captureChunks), resHeaders["content-encoding"])).toString("utf8"), resTruncated,
        });
      });
      return;
    }

    const chunks = [];
    up.on("data", (chunk) => chunks.push(chunk));
    up.on("end", () => {
      const bodyStr = applyBodyRules("res-body", Buffer.concat(chunks).toString("utf8"));
      const finalBody = Buffer.from(bodyStr, "utf8");
      const finalHeaders = { ...resHeaders };
      delete finalHeaders["content-length"];
      delete finalHeaders["transfer-encoding"];
      delete finalHeaders["content-encoding"];
      finalHeaders["content-length"] = String(finalBody.length);
      res.writeHead(up.statusCode || 502, finalHeaders);
      res.end(finalBody);
      recordEntry({
        id, at: startedAt, ms: Date.now() - startedAt,
        method: recMethod, url: target.toString(), host, scheme, status: up.statusCode || 0,
        reqHeaders: objectToPairs(recHeaders), reqBody: recBody, reqTruncated: recTruncated,
        resHeaders: objectToPairs(finalHeaders), resBody: bodyStr, resTruncated: false,
      });
    });
  };

  const makeUpstream = (headers) => {
    const out = { ...headers };
    for (const name of HOP_BY_HOP) delete out[name];
    if (rewriteResBody) out["accept-encoding"] = "identity";
    recHeaders = out;
    const upstream = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: targetPort,
        method: recMethod,
        path: target.pathname + target.search,
        headers: out,
      },
      handleResponse,
    );
    upstream.on("error", (error) => {
      if (!res.headersSent) { try { res.writeHead(502); } catch {  } }
      try { res.end(); } catch {  }
      recordFailure(0, { error: String(error.message || error) });
    });
    return upstream;
  };

  if (!bufferRequest) {

    const upstream = makeUpstream(req.headers);
    if (capture) {
      const captureChunks = [];
      let capSize = 0;
      req.on("data", (chunk) => {
        capSize += chunk.length;
        if (capSize <= PROXY_MAX_BODY) captureChunks.push(chunk);
        else recTruncated = true;
      });
      req.on("end", () => { recBody = Buffer.concat(captureChunks).toString("utf8"); });
    }
    req.on("error", () => { try { upstream.destroy(); } catch {  } });
    req.pipe(upstream);
    return;
  }

  readBody(req, async (reqBody, reqTruncated) => {
    recTruncated = reqTruncated;
    let headers = applyHeaderRules("req-header", { ...req.headers });
    let bodyText = applyBodyRules("req-body", reqBody.toString("utf8"));

    if (willHold) {
      const request = {
        id, method: recMethod, host, scheme,
        url: target.toString(), headers: objectToPairs(headers), body: bodyText,
      };
      const decision = await new Promise((resolve) => {

        pendingIntercepts.set(id, { resolve, request });
        broadcast("proxy:intercept", request);
      });
      pendingIntercepts.delete(id);
      if (decision.action === "drop") {
        recHeaders = headers;
        recBody = bodyText;
        res.destroy();
        recordFailure(0, { dropped: true });
        return;
      }
      const edited = decision.edited;
      if (edited) {
        if (typeof edited.method === "string" && edited.method) recMethod = edited.method;
        if (Array.isArray(edited.headers)) headers = pairsToHeaders(edited.headers);
        if (typeof edited.body === "string") bodyText = edited.body;
      }
    }

    recBody = bodyText;
    const outBody = Buffer.from(bodyText, "utf8");

    delete headers["content-length"];
    if (outBody.length) headers["content-length"] = String(outBody.length);

    const upstream = makeUpstream(headers);
    if (outBody.length) upstream.write(outBody);
    upstream.end();
  });
}

function makeFrameReader(onFrame) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    try {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      for (;;) {
        if (buffer.length < 2) return;
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let length = buffer[1] & 0x7f;
        let offset = 2;
        if (length === 126) {
          if (buffer.length < 4) return;
          length = buffer.readUInt16BE(2);
          offset = 4;
        } else if (length === 127) {
          if (buffer.length < 10) return;

          length = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        const maskLen = masked ? 4 : 0;
        if (buffer.length < offset + maskLen + length) return;
        let payload = buffer.subarray(offset + maskLen, offset + maskLen + length);
        if (masked) {
          const key = buffer.subarray(offset, offset + 4);
          const unmasked = Buffer.allocUnsafe(payload.length);
          for (let i = 0; i < payload.length; i += 1) unmasked[i] = payload[i] ^ key[i & 3];
          payload = unmasked;
        }
        buffer = buffer.subarray(offset + maskLen + length);
        if (opcode === 1) onFrame({ kind: "text", text: payload.toString("utf8") });
        else if (opcode === 2) onFrame({ kind: "binary", bytes: payload.length });
        else if (opcode === 8) onFrame({ kind: "close" });
      }
    } catch {

      buffer = Buffer.alloc(0);
    }
  };
}

function relayWebSocket(scheme, req, clientSocket, head) {
  const host = (req.headers.host || "").replace(/:\d+$/, "");
  const port = Number((req.headers.host || "").split(":")[1]) || (scheme === "https" ? 443 : 80);
  if (isProxyItself(host, port)) {
    clientSocket.destroy();
    return;
  }

  const capture = inScope(host);
  const id = ++proxyCounter;
  const startedAt = Date.now();

  const FRAME_CAP = 5000;
  const frames = [];
  let wsBuffer = [];
  let wsTimer = null;
  const flushWs = () => {
    wsTimer = null;
    if (wsBuffer.length === 0) return;
    const batch = wsBuffer;
    wsBuffer = [];
    broadcast("proxy:ws", batch);
  };
  const note = (direction) => (frame) => {
    if (!capture) return;
    const rec = { direction, at: Date.now(), ...frame };
    frames.push(rec);
    if (frames.length > FRAME_CAP) frames.shift();
    wsBuffer.push({ id, ...rec });
    if (!wsTimer) wsTimer = setTimeout(flushWs, 50);
  };
  const fromClient = makeFrameReader(note("up"));
  const fromServer = makeFrameReader(note("down"));

  let target = req.url;
  if (/^https?:\/\//i.test(target)) {
    try {
      const url = new URL(target);
      target = url.pathname + url.search;
    } catch {

    }
  }
  const head_lines = [`${req.method} ${target} HTTP/1.1`];
  for (let i = 0; i + 1 < req.rawHeaders.length; i += 2) {
    head_lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
  }
  const handshake = head_lines.join("\r\n") + "\r\n\r\n";

  const entry = {
    id,
    at: startedAt,
    ms: 0,
    method: "WS",
    url: `${scheme === "https" ? "wss" : "ws"}://${req.headers.host || host}${target}`,
    host: req.headers.host || host,
    scheme,
    status: 101,
    reqHeaders: pairHeaders(req.rawHeaders),
    reqBody: "",
    resHeaders: [],
    resBody: "",
    websocket: true,
    frames,
  };
  if (capture) {
    recordEntry(entry);
    flushTraffic();
  }

  const live = { clientSocket, upstream: null };
  if (capture) liveWebSockets.set(id, live);

  const connect = scheme === "https" ? node_tls.connect : node_net.connect;
  const options =
    scheme === "https"
      ? { host, port, servername: host, ALPNProtocols: ["http/1.1"] }
      : { host, port };
  const upstream = connect(options, () => {
    upstream.write(handshake);
    if (head && head.length) {
      upstream.write(head);
      fromClient(head);
    }
    clientSocket.on("data", (chunk) => {
      upstream.write(chunk);
      fromClient(chunk);
    });
    upstream.on("data", (chunk) => {
      clientSocket.write(chunk);
      fromServer(chunk);
    });
  });

  const finish = () => {
    if (!capture) return;
    entry.ms = Date.now() - startedAt;
    if (proxyLog.indexOf(entry) === -1) recordEntry(entry);
    else queueEntry(entry);
  };
  live.upstream = upstream;
  const forget = () => liveWebSockets.delete(id);
  upstream.on("close", () => { forget(); clientSocket.destroy(); finish(); });
  upstream.on("error", () => { forget(); clientSocket.destroy(); });
  clientSocket.on("close", () => { forget(); upstream.destroy(); });
  clientSocket.on("error", () => { forget(); upstream.destroy(); });
}

const mitmServers = new Map();

function mitmServerFor(host, secure) {
  const scheme = secure ? "https" : "http";
  const key = `${scheme}:${host}`;
  const existing = mitmServers.get(key);
  if (existing) return existing;
  const handleRequest = (req, res) => forward(scheme, req, res);
  let server;
  if (secure) {
    const leaf = leafFor(host);
    server = node_https.createServer({ key: leaf.key, cert: leaf.cert }, handleRequest);
  } else {
    server = node_http.createServer(handleRequest);
  }

  server.on("upgrade", (req, socket, head) => relayWebSocket(scheme, req, socket, head));
  server.on("error", () => {});
  mitmServers.set(key, server);
  return server;
}

function startProxy() {
  if (proxyServer) return { ok: true, port: proxyPort };

  const server = node_http.createServer((req, res) => {

    forward("http", req, res);
  });

  server.on("upgrade", (req, socket, head) => relayWebSocket("http", req, socket, head));

  server.on("connect", (req, clientSocket, head) => {
    const authority = String(req.url || "");
    const colon = authority.lastIndexOf(":");
    const host = colon > 0 ? authority.slice(0, colon) : authority;
    const port = Number(colon > 0 ? authority.slice(colon + 1) : "") || 443;

    clientSocket.on("error", () => clientSocket.destroy());

    if (isProxyItself(host, port)) {
      clientSocket.destroy();
      return;
    }

    const passThrough = (established, first) => {
      const upstream = node_net.connect(port, host, () => {
        if (!established) clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (first && first.length) upstream.write(first);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      });
      upstream.on("error", () => clientSocket.destroy());
      clientSocket.on("error", () => upstream.destroy());
    };

    if (inScope(host)) {

      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      let waiting = null;
      const enterTunnel = (first) => {
        if (waiting) {
          clearTimeout(waiting);
          waiting = null;
        }
        const byte = first && first.length ? first[0] : -1;
        const tls = byte === 0x16;
        const looksHttp = byte > 32 && byte < 127;
        if (!tls && !looksHttp) {
          clientSocket.pause();
          passThrough(true, first);
          return;
        }
        clientSocket.pause();
        if (first && first.length) clientSocket.unshift(first);
        mitmServerFor(host, tls).emit("connection", clientSocket);
        process.nextTick(() => clientSocket.resume());
      };
      if (head && head.length) {
        enterTunnel(head);
      } else {
        waiting = setTimeout(() => {
          waiting = null;
          clientSocket.removeListener("data", enterTunnel);
          clientSocket.destroy();
        }, PROXY_TUNNEL_IDLE_MS);
        waiting.unref();
        clientSocket.once("data", enterTunnel);
      }
    } else {

      passThrough(false, head);
    }
  });

  server.on("error", () => {});

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      proxyServer = server;
      proxyPort = server.address().port;
      resolve({ ok: true, port: proxyPort });
    });
  });
}

function stopProxy() {
  for (const server of mitmServers.values()) {
    try { server.close(); } catch {  }
  }
  mitmServers.clear();
  if (proxyServer) {
    try { proxyServer.close(); } catch {  }
  }
  proxyServer = null;
  proxyPort = 0;

  releaseIntercepts();
  releaseResponseIntercepts();
}

function catcherAutosaveFile(root) {
  const key = node_crypto.createHash("sha1").update(String(root || "")).digest("hex").slice(0, 16);
  return node_path.join(electron.app.getPath("userData"), "catcher-sessions", `${key}.json`);
}

function registerProxyHandlers() {
  electron.ipcMain.handle("catcher:autosaveWrite", async (_event, root, json) => {
    if (typeof root !== "string" || !root || typeof json !== "string") {
      return { ok: false, error: "There is nothing to save." };
    }
    try {
      const file = catcherAutosaveFile(root);
      await promises.mkdir(node_path.dirname(file), { recursive: true });
      await promises.writeFile(file, json, "utf8");
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });

  electron.ipcMain.handle("catcher:autosaveRead", async (_event, root) => {
    if (typeof root !== "string" || !root) return { ok: true, json: "" };
    try {
      return { ok: true, json: await promises.readFile(catcherAutosaveFile(root), "utf8") };
    } catch {
      return { ok: true, json: "" };
    }
  });

  electron.ipcMain.handle("proxy:start", async () => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    await loadOrMakeCa();
    const listening = await startProxy();

    electron.hostRequest("browser:proxy", { port: proxyPort });
    return { ok: true, port: listening.port, scope: proxyScope };
  });

  electron.ipcMain.handle("proxy:stop", async () => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    stopProxy();
    electron.hostRequest("browser:proxy", { port: 0 });
    return { ok: true };
  });

  electron.ipcMain.handle("proxy:status", async () => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    return {
      ok: true,
      running: Boolean(proxyServer),
      port: proxyPort,
      scope: proxyScope,

      intercepting,
      interceptingResponses,
      rules: matchReplaceRules,
      held: [...pendingIntercepts.values()].map((entry) => entry.request),
      heldResponses: [...pendingResponseIntercepts.values()].map((entry) => entry.response),
    };
  });

  electron.ipcMain.handle("proxy:scope", async (_event, next) => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    if (Array.isArray(next)) {
      proxyScope = next
        .map((entry) => String(entry || "").toLowerCase().trim())
        .filter(Boolean);
      for (const server of mitmServers.values()) {
        try { server.close(); } catch {  }
      }
      mitmServers.clear();
    }
    return { ok: true, scope: proxyScope };
  });

  electron.ipcMain.handle("proxy:traffic", async () => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    return { ok: true, entries: proxyLog.slice() };
  });

  electron.ipcMain.handle("proxy:matchReplace", async (_event, rules) => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    if (Array.isArray(rules)) {
      matchReplaceRules = rules
        .filter((rule) => rule && typeof rule.match === "string")
        .map((rule) => ({
          id: String(rule.id ?? ""),
          enabled: rule.enabled !== false,
          target: ["req-header", "req-body", "res-header", "res-body"].includes(rule.target)
            ? rule.target
            : "req-body",
          match: String(rule.match),
          replace: String(rule.replace ?? ""),
          regex: Boolean(rule.regex),
        }));
    }
    return { ok: true, rules: matchReplaceRules };
  });

  electron.ipcMain.handle("proxy:setIntercept", async (_event, config) => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;

    if (typeof config === "boolean") {
      intercepting = config;
      if (!intercepting) releaseIntercepts();
    } else if (config && typeof config === "object") {
      if (typeof config.request === "boolean") {
        intercepting = config.request;
        if (!intercepting) releaseIntercepts();
      }
      if (typeof config.response === "boolean") {
        interceptingResponses = config.response;
        if (!interceptingResponses) releaseResponseIntercepts();
      }
    }
    return { ok: true, intercepting, interceptingResponses };
  });

  electron.ipcMain.handle("proxy:wsSend", async (_event, id, direction, text) => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    const entry = liveWebSockets.get(Number(id));
    if (!entry) return { ok: false, error: "That WebSocket is no longer open." };
    const toServer = direction !== "down";
    const frame = encodeWsFrame(text, toServer);
    try {
      const socket = toServer ? entry.upstream : entry.clientSocket;
      if (!socket) return { ok: false, error: "The WebSocket is not connected yet." };
      socket.write(frame);

      broadcast("proxy:ws", [{ id: Number(id), direction: toServer ? "up" : "down", kind: "text", text: String(text ?? ""), at: Date.now() }]);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error.message || error) };
    }
  });

  electron.ipcMain.handle("proxy:interceptDecision", async (_event, id, action, edited) => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    const entry = pendingIntercepts.get(Number(id));
    if (entry) entry.resolve({ action: action === "drop" ? "drop" : "forward", edited });
    return { ok: true };
  });

  electron.ipcMain.handle("proxy:responseDecision", async (_event, id, action, edited) => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    const entry = pendingResponseIntercepts.get(Number(id));
    if (entry) entry.resolve({ action: action === "drop" ? "drop" : "forward", edited });
    return { ok: true };
  });

  electron.ipcMain.handle("proxy:clear", async () => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    proxyLog.length = 0;
    return { ok: true };
  });

  electron.ipcMain.handle("proxy:replay", async (_event, request, options) => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;

    return sendRequestOnce(request, options && typeof options === "object" ? options : {});
  });

  electron.ipcMain.handle("proxy:runMacro", async (_event, macro) => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    const steps = Array.isArray(macro?.steps) ? macro.steps : [];
    const extract = Array.isArray(macro?.extract) ? macro.extract : [];
    const jar = new Map();
    const vars = new Map();
    const results = [];
    for (let i = 0; i < steps.length; i += 1) {
      const step = steps[i] ?? {};
      const url = fillTemplate(step.url, vars);
      const body = fillTemplate(step.body ?? "", vars);
      const headers = (step.headers ?? []).map(([name, value]) => [name, fillTemplate(value, vars)]);
      const cookie = cookieHeader(jar);
      const withCookie = cookie
        ? [...headers.filter(([name]) => name.toLowerCase() !== "cookie"), ["Cookie", cookie]]
        : headers;
      const reply = await sendRequestOnce({ method: step.method || "GET", url, headers: withCookie, body });
      if (!reply.ok) {
        results.push({ ok: false, error: reply.error });
        return { ok: false, error: reply.error, step: i, results, cookies: [...jar], tokens: [...vars] };
      }
      parseSetCookies(reply.headers, jar);
      for (const rule of extract) {
        const source =
          rule.source === "header" ? reply.headers.map(([name, value]) => `${name}: ${value}`).join("\n") : reply.body;
        try {
          const match = new RegExp(rule.pattern).exec(source);
          if (match) vars.set(rule.name, match[1] ?? match[0]);
        } catch {

        }
      }
      results.push({ ok: true, status: reply.status, ms: reply.ms });
    }
    return { ok: true, cookies: [...jar], tokens: [...vars], results };
  });

  electron.ipcMain.handle("proxy:caCert", async () => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    const ca = await loadOrMakeCa();
    return { ok: true, pem: ca.pem };
  });

  electron.ipcMain.handle("proxy:caCertPath", async () => {
    const gate = await requireInstalled("proxy");
    if (gate) return gate;
    await loadOrMakeCa();
    return { ok: true, path: PROXY_CA_CERT() };
  });
}
