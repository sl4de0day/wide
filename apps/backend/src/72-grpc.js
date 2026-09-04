

let grpcLib = null;
let protoLoaderLib = null;
let grpcLoadError = null;
function ensureGrpc() {
  if (grpcLib && protoLoaderLib) return true;
  if (grpcLoadError) return false;
  try {
    grpcLib = require("@grpc/grpc-js");
    protoLoaderLib = require("@grpc/proto-loader");
    return true;
  } catch (e) {
    grpcLoadError = String(e && e.message ? e.message : e);
    return false;
  }
}

const grpcObjects = new Map();
const grpcStreams = new Map();

const LOADER_OPTS = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true };

function nameOfType(ref) {
  try {
    if (ref && ref.type && ref.type.name) return ref.type.name;
  } catch {

  }
  return "";
}

function enumerateServices(def) {
  const services = [];
  for (const key of Object.keys(def)) {
    const entry = def[key];
    if (!entry || typeof entry !== "object") continue;
    const methodNames = Object.keys(entry).filter((m) => entry[m] && typeof entry[m] === "object" && typeof entry[m].path === "string");
    if (methodNames.length === 0) continue;
    services.push({
      name: key,
      methods: methodNames.map((m) => {
        const md = entry[m];
        return {
          name: m,
          requestStream: Boolean(md.requestStream),
          responseStream: Boolean(md.responseStream),
          requestType: nameOfType(md.requestType),
          responseType: nameOfType(md.responseType),
        };
      }),
    });
  }
  return services;
}

function getDeep(obj, dotted) {
  let cur = obj;
  for (const part of dotted.split(".")) {
    if (cur == null) return null;
    cur = cur[part];
  }
  return cur;
}

function makeMetadata(map) {
  const md = new grpcLib.Metadata();
  if (map) for (const k of Object.keys(map)) md.set(k, String(map[k]));
  return md;
}

function makeClient(loadId, target, serviceName, tls) {
  const grpcObject = grpcObjects.get(loadId);
  if (!grpcObject) throw new Error("Proto is not loaded. Load it first.");
  const ServiceCtor = getDeep(grpcObject, serviceName);
  if (typeof ServiceCtor !== "function") throw new Error(`Service ${serviceName} not found in proto.`);
  const creds = tls ? grpcLib.credentials.createSsl() : grpcLib.credentials.createInsecure();
  return new ServiceCtor(target, creds);
}

function resolveMethod(client, method) {
  if (typeof client[method] === "function") return method;
  const camel = method.charAt(0).toLowerCase() + method.slice(1);
  if (typeof client[camel] === "function") return camel;
  return null;
}

function grpcLoad(id, protoPath, protoSource) {
  if (!ensureGrpc()) return { ok: false, error: `gRPC is unavailable: ${grpcLoadError}` };
  let path = protoPath;
  let tempPath = null;
  try {
    if (!path && protoSource) {
      const os = require("node:os");
      const fs = require("node:fs");
      const nodePath = require("node:path");

      tempPath = nodePath.join(os.tmpdir(), `wide-grpc-${id}.proto`);
      fs.writeFileSync(tempPath, protoSource, "utf8");
      path = tempPath;
    }
    if (!path) return { ok: false, error: "No proto file or source given." };
    const def = protoLoaderLib.loadSync(path, LOADER_OPTS);
    const grpcObject = grpcLib.loadPackageDefinition(def);
    grpcObjects.set(id, grpcObject);
    return { ok: true, services: enumerateServices(def) };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  } finally {
    if (tempPath) {
      try {
        require("node:fs").unlinkSync(tempPath);
      } catch {

      }
    }
  }
}

function grpcUnary(loadId, target, service, method, message, metadata, tls) {
  if (!ensureGrpc()) return Promise.resolve({ ok: false, error: `gRPC is unavailable: ${grpcLoadError}` });
  return new Promise((resolve) => {
    let client;
    try {
      client = makeClient(loadId, target, service, tls);
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message ? e.message : e) });
      return;
    }
    const name = resolveMethod(client, method);
    if (!name) {
      resolve({ ok: false, error: `Method ${method} not found or is streaming.` });
      return;
    }
    const started = Date.now();
    try {
      client[name](message || {}, makeMetadata(metadata), (err, response) => {
        try {
          client.close();
        } catch {

        }
        if (err) resolve({ ok: false, error: `${err.code != null ? `[${err.code}] ` : ""}${err.details || err.message}`, ms: Date.now() - started });
        else resolve({ ok: true, response, ms: Date.now() - started });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  });
}

function grpcServerStream(id, loadId, target, service, method, message, metadata, tls) {
  if (!ensureGrpc()) return { ok: false, error: `gRPC is unavailable: ${grpcLoadError}` };

  if (grpcStreams.has(id)) cleanupStream(id);
  let client;
  try {
    client = makeClient(loadId, target, service, tls);
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
  const name = resolveMethod(client, method);
  if (!name) return { ok: false, error: `Method ${method} not found.` };
  try {
    const call = client[name](message || {}, makeMetadata(metadata));
    grpcStreams.set(id, { call, client });
    call.on("data", (data) => broadcast("grpc:event", { id, type: "data", data }));
    call.on("end", () => {
      broadcast("grpc:event", { id, type: "end" });
      cleanupStream(id);
    });
    call.on("error", (err) => {
      broadcast("grpc:event", { id, type: "error", error: `${err.code != null ? `[${err.code}] ` : ""}${err.details || err.message}` });
      cleanupStream(id);
    });
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

function cleanupStream(id) {
  const s = grpcStreams.get(id);
  if (s) {
    try {
      s.client.close();
    } catch {

    }
    grpcStreams.delete(id);
  }
}

function grpcCancel(id) {
  const s = grpcStreams.get(id);
  if (s) {
    try {
      s.call.cancel();
    } catch {

    }
    cleanupStream(id);
  }
  return { ok: true };
}

function closeAllGrpc() {
  for (const id of Array.from(grpcStreams.keys())) cleanupStream(id);
  grpcObjects.clear();
}

function registerGrpcHandlers() {
  electron.ipcMain.handle("grpc:load", async (_event, { id, protoPath, protoSource }) => grpcLoad(id, protoPath, protoSource));
  electron.ipcMain.handle("grpc:unary", async (_event, { loadId, target, service, method, message, metadata, tls }) => grpcUnary(loadId, target, service, method, message, metadata, tls));
  electron.ipcMain.handle("grpc:serverStream", async (_event, { id, loadId, target, service, method, message, metadata, tls }) => grpcServerStream(id, loadId, target, service, method, message, metadata, tls));
  electron.ipcMain.handle("grpc:cancel", async (_event, { id }) => grpcCancel(id));
}
