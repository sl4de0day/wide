
let dbVendorCache = null;

function dbLoadVendor() {
  if (dbVendorCache) return dbVendorCache;
  const candidates = [
    node_path.join(__dirname, "db-vendor.cjs"),
    node_path.resolve(__dirname, "..", "out", "main", "db-vendor.cjs"),
    node_path.resolve(__dirname, "..", "..", "sidecar", "db-vendor.cjs"),
  ];
  try {
    if (typeof appRoot === "function") {
      candidates.push(node_path.join(appRoot(), "out", "main", "db-vendor.cjs"));
      candidates.push(node_path.join(appRoot(), "sidecar", "db-vendor.cjs"));
    }
  } catch {
    void 0;
  }
  let lastError = null;
  for (const candidate of candidates) {
    try {
      const mod = require(candidate);
      if (mod && (mod.pg || mod.mysql || mod.Redis)) {
        dbVendorCache = mod;
        return mod;
      }
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`db-vendor.cjs is unavailable: ${String(lastError?.message || lastError || "not found")}`);
}

function dbLoadSqlite() {
  try {
    return require("node:sqlite");
  } catch (error) {
    throw new Error(`Built-in SQLite (node:sqlite) is unavailable in this runtime: ${String(error?.message || error)}`);
  }
}

const DB_ENGINES = new Set(["sqlite", "postgres", "mysql", "redis"]);
const DB_ENVIRONMENTS = new Set(["dev", "staging", "prod"]);
const DB_TLS_MODES = new Set(["disable", "prefer", "require", "verify-full"]);
const DB_DEFAULT_PORTS = { postgres: 5432, mysql: 3306, redis: 6379 };

const dbSessions = new Map();

function dbMetaPath() {
  return node_path.join(electron.app.getPath("userData"), "database-connections.json");
}

function dbVaultPath() {
  return node_path.join(electron.app.getPath("userData"), "database-vault.bin");
}

function dbRedactError(error) {
  const msg = String(error?.message || error || "Database operation failed");
  return msg.replace(/\b(postgres(?:ql)?|mysql|redis|rediss):\/\/([^:/@\s]+):([^@\s]+)@/gi, "$1://$2:***@");
}

function dbNormalizeScalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") {
    const num = Number(value);
    return Number.isSafeInteger(num) ? num : value.toString();
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    const buf = Buffer.from(value);
    if (buf.length > 256) {
      return `0x${buf.subarray(0, 256).toString("hex")}... (${buf.length} bytes)`;
    }
    return `0x${buf.toString("hex")}`;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? String(value) : value.toISOString();
  }
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return value;
}

function dbNormalizeRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map((row) => {
    const clean = {};
    if (row && typeof row === "object") {
      for (const [key, val] of Object.entries(row)) {
        clean[key] = dbNormalizeScalar(val);
      }
    }
    return clean;
  });
}

async function dbReadConnectionsMeta() {
  try {
    const raw = await promises.readFile(dbMetaPath(), "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "string") : [];
  } catch {
    return [];
  }
}

async function dbWriteConnectionsMeta(list) {
  await writeFileAtomic(dbMetaPath(), JSON.stringify(list, null, 2), "utf8");
}

async function dbReadVaultMap() {
  try {
    const buf = await promises.readFile(dbVaultPath());
    if (!buf || buf.length < 2) return {};
    const flag = buf[0];
    const payload = buf.subarray(1);
    let json = "";
    if (flag === 1) {
      if (!electron.safeStorage?.isEncryptionAvailable?.()) {
        return {};
      }
      json = electron.safeStorage.decryptString(payload);
    } else {
      json = payload.toString("utf8");
    }
    const parsed = JSON.parse(json);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function dbWriteVaultMap(map) {
  const json = JSON.stringify(map || {});
  const canEncrypt = Boolean(electron.safeStorage?.isEncryptionAvailable?.());
  const payload = canEncrypt ? electron.safeStorage.encryptString(json) : Buffer.from(json, "utf8");
  const out = Buffer.concat([Buffer.from([canEncrypt ? 1 : 0]), Buffer.from(payload)]);
  await writeFileAtomic(dbVaultPath(), out);
}

function dbParseConnectionString(rawUri, fallbackEngine) {
  const trimmed = String(rawUri || "").trim();
  if (!trimmed) return {};
  if (/^(sqlite|file):\/\//i.test(trimmed)) {
    const cleaned = trimmed.replace(/^sqlite:\/\//i, "").replace(/^file:\/\//i, "");
    return { engine: "sqlite", filePath: cleaned };
  }
  if (/^postgres(ql)?:\/\//i.test(trimmed) || /^mysql:\/\//i.test(trimmed) || /^rediss?:\/\//i.test(trimmed)) {
    const u = new URL(trimmed);
    const proto = u.protocol.toLowerCase();
    const engine = proto.startsWith("postgres")
      ? "postgres"
      : proto.startsWith("mysql")
        ? "mysql"
        : "redis";
    const sslModeParam = (u.searchParams.get("sslmode") || u.searchParams.get("ssl-mode") || "").toLowerCase();
    let tlsMode = "prefer";
    if (proto === "rediss:") tlsMode = "require";
    else if (sslModeParam === "disable") tlsMode = "disable";
    else if (sslModeParam === "require") tlsMode = "require";
    else if (sslModeParam === "verify-full" || sslModeParam === "verify-ca") tlsMode = "verify-full";
    const dbPath = decodeURIComponent((u.pathname || "").replace(/^\//, ""));
    return {
      engine,
      host: u.hostname || "127.0.0.1",
      port: u.port ? Number(u.port) : DB_DEFAULT_PORTS[engine],
      username: u.username ? decodeURIComponent(u.username) : "",
      password: u.password ? decodeURIComponent(u.password) : undefined,
      database: dbPath || (engine === "redis" ? "0" : ""),
      tlsMode,
    };
  }
  if (fallbackEngine === "sqlite" || /\.(db|sqlite|sqlite3)$/i.test(trimmed)) {
    return { engine: "sqlite", filePath: trimmed };
  }
  return {};
}

function dbMaskSummary(meta, vaultEntry) {
  const session = dbSessions.get(meta.id);
  const secrets = vaultEntry || {};
  return {
    id: meta.id,
    name: meta.name,
    engine: meta.engine,
    environment: meta.environment || "dev",
    readOnly: Boolean(meta.readOnly),
    filePath: meta.filePath || "",
    host: meta.host || "",
    port: meta.port || DB_DEFAULT_PORTS[meta.engine] || 0,
    database: meta.database || "",
    username: meta.username || "",
    tlsMode: meta.tlsMode || "prefer",
    caPath: meta.caPath || "",
    sshTunnel: meta.sshTunnel
      ? {
          enabled: Boolean(meta.sshTunnel.enabled),
          host: String(meta.sshTunnel.host || ""),
          port: Number(meta.sshTunnel.port || 22),
          username: String(meta.sshTunnel.username || ""),
          authMethod: meta.sshTunnel.authMethod || "agent",
          privateKeyPath: String(meta.sshTunnel.privateKeyPath || ""),
          hasPassphrase: Boolean(secrets.sshPassphrase),
        }
      : { enabled: false, host: "", port: 22, username: "", authMethod: "agent", privateKeyPath: "", hasPassphrase: false },
    hasPassword: Boolean(secrets.password),
    hasConnectionString: Boolean(secrets.connectionString),
    connected: Boolean(session),
    serverVersion: session?.serverVersion || meta.lastServerVersion || "",
    createdAt: meta.createdAt || 0,
    updatedAt: meta.updatedAt || 0,
  };
}

function dbValidateConnectionInput(input, existingMeta, existingSecret) {
  const parsedFromUri = input.connectionString ? dbParseConnectionString(input.connectionString, input.engine) : {};
  const engine = String(input.engine || parsedFromUri.engine || existingMeta?.engine || "sqlite").toLowerCase();
  if (!DB_ENGINES.has(engine)) {
    throw new Error(`Unsupported database engine: ${engine}`);
  }
  const envRaw = String(input.environment || existingMeta?.environment || "dev").toLowerCase();
  const environment = DB_ENVIRONMENTS.has(envRaw) ? envRaw : "dev";
  const readOnly = input.readOnly !== undefined ? Boolean(input.readOnly) : environment === "prod" ? true : Boolean(existingMeta?.readOnly);
  const tlsRaw = String(input.tlsMode || parsedFromUri.tlsMode || existingMeta?.tlsMode || "prefer").toLowerCase();
  const tlsMode = DB_TLS_MODES.has(tlsRaw) ? tlsRaw : "prefer";

  const sshIn = input.sshTunnel || existingMeta?.sshTunnel || {};
  const sshTunnel = {
    enabled: Boolean(sshIn.enabled),
    host: String(sshIn.host || "").trim(),
    port: Math.max(1, Math.min(65535, Number(sshIn.port || 22) || 22)),
    username: String(sshIn.username || "").trim(),
    authMethod: sshIn.authMethod === "key" ? "key" : "agent",
    privateKeyPath: String(sshIn.privateKeyPath || "").trim(),
  };

  const now = Date.now();
  const id = String(input.id || existingMeta?.id || `db_${node_crypto.randomUUID()}`);
  const filePath = engine === "sqlite" ? String(input.filePath || parsedFromUri.filePath || existingMeta?.filePath || "").trim() : "";
  const host = engine === "sqlite" ? "" : String(input.host || parsedFromUri.host || existingMeta?.host || "127.0.0.1").trim();
  const port = engine === "sqlite" ? 0 : Math.max(1, Math.min(65535, Number(input.port || parsedFromUri.port || existingMeta?.port || DB_DEFAULT_PORTS[engine]) || DB_DEFAULT_PORTS[engine]));
  const database = engine === "sqlite" ? "" : String(input.database ?? parsedFromUri.database ?? existingMeta?.database ?? (engine === "redis" ? "0" : "")).trim();
  const username = engine === "sqlite" ? "" : String(input.username ?? parsedFromUri.username ?? existingMeta?.username ?? "").trim();
  const defaultName =
    engine === "sqlite"
      ? node_path.basename(filePath || "sqlite.db")
      : `${engine}://${host}${database ? "/" + database : ""}`;

  const meta = {
    id,
    name: String(input.name || existingMeta?.name || defaultName).trim() || defaultName,
    engine,
    environment,
    readOnly,
    filePath,
    host,
    port,
    database,
    username,
    tlsMode,
    caPath: String(input.caPath ?? existingMeta?.caPath ?? "").trim(),
    sshTunnel,
    lastServerVersion: existingMeta?.lastServerVersion || "",
    createdAt: existingMeta?.createdAt || now,
    updatedAt: now,
  };

  const secret = { ...(existingSecret || {}) };
  if (input.password !== undefined) {
    const pw = String(input.password);
    if (pw === "") delete secret.password;
    else secret.password = pw;
  } else if (parsedFromUri.password !== undefined) {
    secret.password = parsedFromUri.password;
  }
  if (input.connectionString !== undefined) {
    const uri = String(input.connectionString).trim();
    if (uri === "") delete secret.connectionString;
    else secret.connectionString = uri;
  }
  if (input.sshTunnel?.passphrase !== undefined) {
    const pp = String(input.sshTunnel.passphrase);
    if (pp === "") delete secret.sshPassphrase;
    else secret.sshPassphrase = pp;
  }

  return { meta, secret };
}

function dbPickFreePort() {
  return new Promise((resolve, reject) => {
    const srv = node_net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => {
        if (port > 0) resolve(port);
        else reject(new Error("Could not allocate local port for SSH tunnel."));
      });
    });
  });
}

function dbCheckTcpOpen(host, port, timeoutMs = 400) {
  return new Promise((resolve) => {
    const socket = node_net.connect({ host, port });
    let done = false;
    const finish = (ok) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        void 0;
      }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.on("connect", () => finish(true));
    socket.on("timeout", () => finish(false));
    socket.on("error", () => finish(false));
  });
}

function dbValidateSshField(label, val, allowEmpty = false) {
  const s = String(val || "").trim();
  if (!s) {
    if (allowEmpty) return "";
    throw new Error(`SSH tunnel ${label} is required.`);
  }
  if (s.startsWith("-") || /[\s\0\r\n]/.test(s)) {
    throw new Error(`Invalid SSH tunnel ${label}.`);
  }
  return s;
}

async function dbOpenSshTunnel(meta, remoteHost, remotePort) {
  const cfg = meta.sshTunnel;
  if (!cfg?.enabled) return null;
  const sshHost = dbValidateSshField("host", cfg.host);
  const sshUser = dbValidateSshField("username", cfg.username);
  const targetHost = dbValidateSshField("target host", remoteHost || "127.0.0.1");
  const localPort = await dbPickFreePort();

  const args = [
    "-N",
    "-T",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-p",
    String(Number(cfg.port || 22)),
    "-L",
    `127.0.0.1:${localPort}:${targetHost}:${remotePort}`,
  ];
  if (cfg.authMethod === "key" && cfg.privateKeyPath) {
    if (String(cfg.privateKeyPath).startsWith("-") || /[\0\r\n]/.test(cfg.privateKeyPath)) {
      throw new Error("Invalid SSH private key path.");
    }
    args.push("-i", cfg.privateKeyPath);
  }
  args.push(`${sshUser}@${sshHost}`);

  const child = node_child_process.spawn("ssh", args, {
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  let stderrText = "";
  let exited = false;
  let exitCode = null;
  child.stderr?.on("data", (chunk) => {
    stderrText = (stderrText + chunk.toString("utf8")).slice(-2000);
  });
  child.on("exit", (code) => {
    exited = true;
    exitCode = code;
  });

  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`SSH tunnel exited (${exitCode ?? "unknown"}): ${stderrText.trim() || "Authentication or forwarding failed."}`);
    }
    const open = await dbCheckTcpOpen("127.0.0.1", localPort, 300);
    if (open) {
      return { child, localHost: "127.0.0.1", localPort };
    }
    await new Promise((r) => setTimeout(r, 150));
  }

  try {
    killProcessTree(child);
  } catch {
    void 0;
  }
  throw new Error(`SSH tunnel timed out waiting for port forward (${stderrText.trim() || "no response"}).`);
}

function dbBuildTlsOptions(meta) {
  const mode = String(meta.tlsMode || "prefer").toLowerCase();
  if (mode === "disable") return false;
  const ssl = {};
  if (mode === "verify-full") {
    ssl.rejectUnauthorized = true;
  } else {
    ssl.rejectUnauthorized = false;
  }
  if (meta.caPath) {
    ssl.ca = node_fs.readFileSync(meta.caPath, "utf8");
  }
  return ssl;
}

async function dbOpenDriverSession(meta, secret) {
  let tunnel = null;
  try {
    const connectHost = meta.sshTunnel?.enabled ? "127.0.0.1" : meta.host || "127.0.0.1";
    let connectPort = meta.port || DB_DEFAULT_PORTS[meta.engine] || 0;
    if (meta.engine !== "sqlite" && meta.sshTunnel?.enabled) {
      tunnel = await dbOpenSshTunnel(meta, meta.host || "127.0.0.1", connectPort);
      connectPort = tunnel.localPort;
    }

    if (meta.engine === "sqlite") {
      if (!meta.filePath) throw new Error("SQLite file path is required.");
      if (meta.readOnly && !exists(meta.filePath)) {
        throw new Error(`SQLite database file not found: ${meta.filePath}`);
      }
      const { DatabaseSync } = dbLoadSqlite();
      const db = new DatabaseSync(meta.filePath, { readOnly: Boolean(meta.readOnly) });
      const verRow = db.prepare("SELECT sqlite_version() AS v").get();
      return {
        engine: "sqlite",
        client: db,
        tunnel,
        serverVersion: `SQLite ${verRow?.v || ""}`.trim(),
        async query(sql, params = []) {
          const stmt = db.prepare(sql);
          if (stmt.columns && stmt.columns().length > 0) {
            const cols = stmt.columns().map((c) => ({ name: c.name, type: c.type || undefined }));
            const rows = dbNormalizeRows(stmt.all(...params));
            return { columns: cols, rows, changes: 0 };
          }
          const info = stmt.run(...params);
          return { columns: [], rows: [], changes: Number(info?.changes || 0) };
        },
        async close() {
          try {
            db.close();
          } catch {
            void 0;
          }
        },
      };
    }

    const vendor = dbLoadVendor();

    if (meta.engine === "postgres") {
      const Client = vendor.pg.Client;
      const sslOpt = dbBuildTlsOptions(meta);
      const client = new Client({
        host: connectHost,
        port: connectPort,
        database: meta.database || "postgres",
        user: meta.username || undefined,
        password: secret?.password || undefined,
        ssl: sslOpt,
        connectionTimeoutMillis: 10000,
      });
      await client.connect();
      const verRes = await client.query("SELECT version() AS v");
      const rawVer = String(verRes.rows?.[0]?.v || "PostgreSQL").split(" on ")[0];
      return {
        engine: "postgres",
        client,
        tunnel,
        serverVersion: rawVer,
        async query(sql, params = []) {
          const res = await client.query(sql, params);
          const cols = (res.fields || []).map((f) => ({ name: f.name, type: String(f.dataTypeID || "") }));
          return {
            columns: cols,
            rows: dbNormalizeRows(res.rows || []),
            changes: Number(res.rowCount || 0),
          };
        },
        async close() {
          try {
            await client.end();
          } catch {
            void 0;
          }
        },
      };
    }

    if (meta.engine === "mysql") {
      const sslOpt = dbBuildTlsOptions(meta);
      const cfg = {
        host: connectHost,
        port: connectPort,
        database: meta.database || undefined,
        user: meta.username || undefined,
        password: secret?.password || undefined,
        connectTimeout: 10000,
        multipleStatements: false,
      };
      if (sslOpt) cfg.ssl = sslOpt;
      const conn = await vendor.mysql.createConnection(cfg);
      const [verRows] = await conn.query("SELECT VERSION() AS v");
      return {
        engine: "mysql",
        client: conn,
        tunnel,
        serverVersion: `MySQL ${verRows?.[0]?.v || ""}`.trim(),
        async query(sql, params = []) {
          const [res, fields] = params && params.length > 0 ? await conn.execute(sql, params) : await conn.query(sql);
          if (Array.isArray(res)) {
            const cols = (fields || []).map((f) => ({ name: f.name, type: String(f.columnType || f.type || "") }));
            return { columns: cols, rows: dbNormalizeRows(res), changes: res.length };
          }
          return { columns: [], rows: [], changes: Number(res?.affectedRows || 0) };
        },
        async close() {
          try {
            await conn.end();
          } catch {
            void 0;
          }
        },
      };
    }

    if (meta.engine === "redis") {
      const Redis = vendor.Redis;
      const dbIndex = Number.isFinite(Number(meta.database)) && meta.database !== "" ? Number(meta.database) : 0;
      const sslOpt = dbBuildTlsOptions(meta);
      const client = new Redis({
        host: connectHost,
        port: connectPort,
        username: meta.username || undefined,
        password: secret?.password || undefined,
        db: dbIndex,
        tls: sslOpt || undefined,
        lazyConnect: true,
        connectTimeout: 8000,
        maxRetriesPerRequest: 1,
      });
      client.on("error", () => void 0);
      await client.connect();
      const info = await client.info("server");
      const m = /redis_version:([^\r\n]+)/.exec(String(info || ""));
      return {
        engine: "redis",
        client,
        tunnel,
        serverVersion: `Redis ${m ? m[1].trim() : ""}`.trim(),
        async query() {
          throw new Error("Use redis command interface for Redis connections.");
        },
        async close() {
          try {
            await client.quit();
          } catch {
            try {
              client.disconnect();
            } catch {
              void 0;
            }
          }
        },
      };
    }

    throw new Error(`Unsupported engine: ${meta.engine}`);
  } catch (error) {
    if (tunnel?.child) {
      try {
        killProcessTree(tunnel.child);
      } catch {
        void 0;
      }
    }
    throw error;
  }
}

async function dbCloseSessionEntry(id) {
  const entry = dbSessions.get(id);
  if (!entry) return;
  dbSessions.delete(id);
  try {
    await entry.close();
  } catch {
    void 0;
  }
  if (entry.tunnel?.child) {
    try {
      killProcessTree(entry.tunnel.child);
    } catch {
      void 0;
    }
  }
}

async function dbEnsureSession(id) {
  const existing = dbSessions.get(id);
  const metas = await dbReadConnectionsMeta();
  const meta = metas.find((m) => m.id === id);
  if (!meta) throw new Error(`Connection not found: ${id}`);
  if (existing) {
    existing.meta = meta;
    return existing;
  }
  const vault = await dbReadVaultMap();
  const session = await dbOpenDriverSession(meta, vault[id] || {});
  session.meta = meta;
  dbSessions.set(id, session);
  if (session.serverVersion && meta.lastServerVersion !== session.serverVersion) {
    meta.lastServerVersion = session.serverVersion;
    await dbWriteConnectionsMeta(metas);
  }
  return session;
}

function dbStripSqlCommentsAndLiterals(sql) {
  let out = "";
  let i = 0;
  const s = String(sql || "");
  while (i < s.length) {
    const ch = s[i];
    const next = s[i + 1];
    if (ch === "-" && next === "-") {
      while (i < s.length && s[i] !== "\n") i++;
      out += " ";
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < s.length && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      out += " ";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      const q = ch;
      i++;
      while (i < s.length) {
        if (s[i] === "\\" && i + 1 < s.length) {
          i += 2;
          continue;
        }
        if (s[i] === q) {
          if (s[i + 1] === q) {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      out += " _LIT_ ";
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function dbAnalyzeSql(sql) {
  const stripped = dbStripSqlCommentsAndLiterals(sql).trim();
  const noTrailingSemi = stripped.replace(/;+$/, "").trim();
  const hasMultipleStatements = noTrailingSemi.includes(";");
  const firstMatch = /^([a-zA-Z_]+)/.exec(noTrailingSemi);
  const keyword = (firstMatch?.[1] || "").toUpperCase();

  let readOnly = false;
  if (!hasMultipleStatements) {
    if (keyword === "SELECT" || keyword === "SHOW" || keyword === "DESCRIBE" || keyword === "DESC" || keyword === "EXPLAIN") {
      readOnly = !/\b(INTO\s+OUTFILE|INTO\s+DUMPFILE)\b/i.test(noTrailingSemi);
    } else if (keyword === "WITH") {
      readOnly = !/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|TRUNCATE|REPLACE|GRANT|REVOKE)\b/i.test(noTrailingSemi);
    } else if (keyword === "PRAGMA") {
      readOnly = !noTrailingSemi.includes("=") && !/\bWRITABLE_SCHEMA\b/i.test(noTrailingSemi);
    }
  }

  let dangerous = null;
  if (/\b(DROP|TRUNCATE)\b/i.test(noTrailingSemi)) {
    dangerous = {
      level: "critical",
      statementType: /\bDROP\b/i.test(noTrailingSemi) ? "DROP" : "TRUNCATE",
      reason: "Destructive schema/table deletion detected (DROP / TRUNCATE).",
    };
  } else if (/\bALTER\b/i.test(noTrailingSemi) || /\b(GRANT|REVOKE)\b/i.test(noTrailingSemi)) {
    dangerous = {
      level: "high",
      statementType: /\bALTER\b/i.test(noTrailingSemi) ? "ALTER" : "PRIVILEGE",
      reason: "Schema alteration or permission change detected (ALTER / GRANT / REVOKE).",
    };
  } else if (/\bDELETE\s+FROM\b/i.test(noTrailingSemi) && !/\bWHERE\b/i.test(noTrailingSemi)) {
    dangerous = {
      level: "critical",
      statementType: "DELETE",
      reason: "Unconditional DELETE without a WHERE clause will remove every row.",
    };
  } else if (/\bUPDATE\b/i.test(noTrailingSemi) && /\bSET\b/i.test(noTrailingSemi) && !/\bWHERE\b/i.test(noTrailingSemi)) {
    dangerous = {
      level: "critical",
      statementType: "UPDATE",
      reason: "Unconditional UPDATE without a WHERE clause will overwrite every row.",
    };
  } else if (hasMultipleStatements && !readOnly) {
    dangerous = {
      level: "high",
      statementType: "MULTI",
      reason: "Multiple SQL statements with write/DDL operations.",
    };
  }

  const isSelectQuery =
    !hasMultipleStatements &&
    (keyword === "SELECT" || (keyword === "WITH" && readOnly)) &&
    !/\b(LIMIT|FETCH\s+FIRST|FOR\s+UPDATE|FOR\s+SHARE)\b/i.test(noTrailingSemi);

  return { keyword, readOnly, dangerous, isSelectQuery, hasMultipleStatements };
}

function dbPrepareExecutableSql(sql, engine, options = {}) {
  const trimmed = String(sql || "").trim().replace(/;+\s*$/, "");
  if (!trimmed) throw new Error("SQL query is empty.");
  const analysis = dbAnalyzeSql(trimmed);
  if (options.explain) {
    if (engine === "sqlite") return { execSql: `EXPLAIN QUERY PLAN ${trimmed}`, analysis, appliedLimit: null };
    if (engine === "postgres") return { execSql: `EXPLAIN (FORMAT TEXT) ${trimmed}`, analysis, appliedLimit: null };
    return { execSql: `EXPLAIN ${trimmed}`, analysis, appliedLimit: null };
  }
  const limit = Math.max(1, Math.min(5000, Number(options.limit || 500) || 500));
  if (analysis.isSelectQuery && !options.noAutoLimit) {
    return {
      execSql: `${trimmed}\nLIMIT ${limit + 1}`,
      analysis,
      appliedLimit: limit,
    };
  }
  return { execSql: trimmed, analysis, appliedLimit: null };
}

function dbQuoteIdent(engine, ident) {
  const s = String(ident || "");
  if (!s || s.includes("\0")) throw new Error(`Invalid SQL identifier: ${ident}`);
  if (engine === "mysql") {
    return "`" + s.replace(/`/g, "``") + "`";
  }
  return '"' + s.replace(/"/g, '""') + '"';
}

function dbQualifyTable(engine, schema, table) {
  if (schema && engine === "postgres") {
    return `${dbQuoteIdent(engine, schema)}.${dbQuoteIdent(engine, table)}`;
  }
  if (schema && engine === "mysql") {
    return `${dbQuoteIdent(engine, schema)}.${dbQuoteIdent(engine, table)}`;
  }
  return dbQuoteIdent(engine, table);
}

async function dbIntrospectSchema(session) {
  const engine = session.engine;

  if (engine === "redis") {
    const client = session.client;
    const dbSize = await client.dbsize();
    const scanRes = await client.scan("0", "COUNT", "200");
    const keys = Array.isArray(scanRes?.[1]) ? scanRes[1] : [];
    const prefixMap = new Map();
    for (const k of keys.slice(0, 120)) {
      const idx = k.indexOf(":");
      const prefix = idx > 0 ? k.slice(0, idx + 1) + "*" : "(root)";
      const entry = prefixMap.get(prefix) || { prefix, count: 0, sampleTypes: [] };
      entry.count += 1;
      prefixMap.set(prefix, entry);
    }
    return {
      engine: "redis",
      database: String(session.meta.database || "0"),
      serverVersion: session.serverVersion,
      dbSize: Number(dbSize || 0),
      schemas: ["default"],
      tables: [],
      views: [],
      indexes: [],
      triggers: [],
      foreignKeys: [],
      keyPrefixes: Array.from(prefixMap.values()),
    };
  }

  if (engine === "sqlite") {
    const master = await session.query(
      "SELECT name, type, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name"
    );
    const tables = [];
    const views = [];
    const indexes = [];
    const triggers = [];
    const foreignKeys = [];

    for (const item of master.rows) {
      if (item.type === "table") {
        const quoted = dbQuoteIdent("sqlite", item.name);
        const colRes = await session.query(`PRAGMA table_info(${quoted})`);
        const fkRes = await session.query(`PRAGMA foreign_key_list(${quoted})`);
        let rowCount = 0;
        try {
          const cntRes = await session.query(`SELECT COUNT(*) AS c FROM ${quoted}`);
          rowCount = Number(cntRes.rows?.[0]?.c || 0);
        } catch {
          void 0;
        }
        const columns = colRes.rows.map((c) => ({
          name: String(c.name),
          dataType: String(c.type || "ANY"),
          nullable: Number(c.notnull) === 0,
          defaultValue: c.dflt_value !== null && c.dflt_value !== undefined ? String(c.dflt_value) : null,
          primaryKey: Number(c.pk) > 0,
          autoIncrement: Number(c.pk) > 0 && /\bAUTOINCREMENT\b/i.test(String(item.sql || "")),
        }));
        tables.push({
          schema: "main",
          name: String(item.name),
          type: "table",
          rowCount,
          columns,
          ddl: String(item.sql || ""),
        });
        for (const fk of fkRes.rows) {
          foreignKeys.push({
            name: `fk_${item.name}_${fk.from}`,
            fromSchema: "main",
            fromTable: String(item.name),
            fromColumn: String(fk.from),
            toSchema: "main",
            toTable: String(fk.table),
            toColumn: String(fk.to),
            onUpdate: String(fk.on_update || ""),
            onDelete: String(fk.on_delete || ""),
          });
        }
      } else if (item.type === "view") {
        const quoted = dbQuoteIdent("sqlite", item.name);
        let columns = [];
        try {
          const colRes = await session.query(`PRAGMA table_info(${quoted})`);
          columns = colRes.rows.map((c) => ({
            name: String(c.name),
            dataType: String(c.type || "ANY"),
            nullable: true,
            defaultValue: null,
            primaryKey: false,
          }));
        } catch {
          void 0;
        }
        views.push({ schema: "main", name: String(item.name), type: "view", columns, ddl: String(item.sql || "") });
      } else if (item.type === "index") {
        indexes.push({
          schema: "main",
          table: String(item.tbl_name || ""),
          name: String(item.name),
          unique: /\bCREATE\s+UNIQUE\s+INDEX\b/i.test(String(item.sql || "")),
          definition: String(item.sql || ""),
        });
      } else if (item.type === "trigger") {
        triggers.push({
          schema: "main",
          table: String(item.tbl_name || ""),
          name: String(item.name),
          definition: String(item.sql || ""),
        });
      }
    }

    return {
      engine: "sqlite",
      database: session.meta.filePath || "main",
      serverVersion: session.serverVersion,
      schemas: ["main"],
      tables,
      views,
      indexes,
      triggers,
      foreignKeys,
    };
  }

  if (engine === "postgres") {
    const tblRes = await session.query(`
      SELECT t.table_schema, t.table_name, t.table_type,
             COALESCE(c.reltuples::bigint, 0) AS est_rows
      FROM information_schema.tables t
      LEFT JOIN pg_namespace n ON n.nspname = t.table_schema
      LEFT JOIN pg_class c ON c.relname = t.table_name AND c.relnamespace = n.oid
      WHERE t.table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY t.table_schema, t.table_name
    `);
    const colRes = await session.query(`
      SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
      ORDER BY table_schema, table_name, ordinal_position
    `);
    const pkRes = await session.query(`
      SELECT tc.table_schema, tc.table_name, kcu.column_name, tc.constraint_type
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    `);
    const fkRes = await session.query(`
      SELECT tc.constraint_name, tc.table_schema AS from_schema, tc.table_name AS from_table,
             kcu.column_name AS from_column, ccu.table_schema AS to_schema,
             ccu.table_name AS to_table, ccu.column_name AS to_column,
             rc.update_rule, rc.delete_rule
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema
      LEFT JOIN information_schema.referential_constraints rc
        ON rc.constraint_name = tc.constraint_name AND rc.constraint_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
    `);
    const idxRes = await session.query(`
      SELECT schemaname, tablename, indexname, indexdef
      FROM pg_indexes
      WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
      ORDER BY schemaname, tablename, indexname
    `);
    const trigRes = await session.query(`
      SELECT trigger_schema, event_object_table, trigger_name, action_statement
      FROM information_schema.triggers
      WHERE trigger_schema NOT IN ('pg_catalog', 'information_schema')
    `);

    const pkSet = new Set(pkRes.rows.filter((r) => r.constraint_type === "PRIMARY KEY").map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));
    const uniqSet = new Set(pkRes.rows.filter((r) => r.constraint_type === "UNIQUE").map((r) => `${r.table_schema}.${r.table_name}.${r.column_name}`));

    const colsByTable = new Map();
    for (const c of colRes.rows) {
      const k = `${c.table_schema}.${c.table_name}`;
      if (!colsByTable.has(k)) colsByTable.set(k, []);
      colsByTable.get(k).push({
        name: c.column_name,
        dataType: c.data_type,
        nullable: c.is_nullable === "YES",
        defaultValue: c.column_default,
        primaryKey: pkSet.has(`${k}.${c.column_name}`),
        unique: uniqSet.has(`${k}.${c.column_name}`),
      });
    }

    const tables = [];
    const views = [];
    const schemaSet = new Set();
    for (const t of tblRes.rows) {
      schemaSet.add(t.table_schema);
      const cols = colsByTable.get(`${t.table_schema}.${t.table_name}`) || [];
      const ddl = `CREATE TABLE ${t.table_schema}.${t.table_name} (\n  ${cols.map((c) => `${c.name} ${c.dataType}${c.primaryKey ? " PRIMARY KEY" : ""}${!c.nullable ? " NOT NULL" : ""}`).join(",\n  ")}\n);`;
      if (t.table_type === "VIEW") {
        views.push({ schema: t.table_schema, name: t.table_name, type: "view", columns: cols });
      } else {
        tables.push({ schema: t.table_schema, name: t.table_name, type: "table", rowCount: Math.max(0, Number(t.est_rows || 0)), columns: cols, ddl });
      }
    }

    return {
      engine: "postgres",
      database: session.meta.database || "postgres",
      serverVersion: session.serverVersion,
      schemas: Array.from(schemaSet),
      tables,
      views,
      indexes: idxRes.rows.map((i) => ({
        schema: i.schemaname,
        table: i.tablename,
        name: i.indexname,
        unique: /UNIQUE\s+INDEX/i.test(String(i.indexdef || "")),
        definition: i.indexdef,
      })),
      triggers: trigRes.rows.map((tr) => ({
        schema: tr.trigger_schema,
        table: tr.event_object_table,
        name: tr.trigger_name,
        definition: tr.action_statement,
      })),
      foreignKeys: fkRes.rows.map((fk) => ({
        name: fk.constraint_name,
        fromSchema: fk.from_schema,
        fromTable: fk.from_table,
        fromColumn: fk.from_column,
        toSchema: fk.to_schema,
        toTable: fk.to_table,
        toColumn: fk.to_column,
        onUpdate: fk.update_rule,
        onDelete: fk.delete_rule,
      })),
    };
  }

  if (engine === "mysql") {
    const dbName = session.meta.database;
    const schemaFilter = dbName ? "table_schema = ?" : "table_schema NOT IN ('mysql','information_schema','performance_schema','sys')";
    const params = dbName ? [dbName] : [];
    const tblRes = await session.query(
      `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, TABLE_TYPE AS table_type, TABLE_ROWS AS est_rows
       FROM information_schema.tables WHERE ${schemaFilter} ORDER BY table_schema, table_name`,
      params
    );
    const colRes = await session.query(
      `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, COLUMN_NAME AS column_name,
              COLUMN_TYPE AS data_type, IS_NULLABLE AS is_nullable, COLUMN_DEFAULT AS column_default,
              COLUMN_KEY AS column_key, EXTRA AS extra
       FROM information_schema.columns WHERE ${schemaFilter} ORDER BY table_schema, table_name, ORDINAL_POSITION`,
      params
    );
    const fkRes = await session.query(
      `SELECT k.CONSTRAINT_NAME AS constraint_name, k.TABLE_SCHEMA AS from_schema, k.TABLE_NAME AS from_table,
              k.COLUMN_NAME AS from_column, k.REFERENCED_TABLE_SCHEMA AS to_schema,
              k.REFERENCED_TABLE_NAME AS to_table, k.REFERENCED_COLUMN_NAME AS to_column
       FROM information_schema.key_column_usage k
       WHERE ${schemaFilter.replace(/table_schema/g, "k.TABLE_SCHEMA")} AND k.REFERENCED_TABLE_NAME IS NOT NULL`,
      params
    );
    const idxRes = await session.query(
      `SELECT TABLE_SCHEMA AS table_schema, TABLE_NAME AS table_name, INDEX_NAME AS index_name,
              NON_UNIQUE AS non_unique, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.statistics
       WHERE ${schemaFilter.replace(/table_schema/g, "TABLE_SCHEMA")}
       GROUP BY TABLE_SCHEMA, TABLE_NAME, INDEX_NAME, NON_UNIQUE`,
      params
    );
    const trigRes = await session.query(
      `SELECT TRIGGER_SCHEMA AS trigger_schema, EVENT_OBJECT_TABLE AS event_object_table,
              TRIGGER_NAME AS trigger_name, ACTION_STATEMENT AS action_statement
       FROM information_schema.triggers
       WHERE ${dbName ? "TRIGGER_SCHEMA = ?" : "TRIGGER_SCHEMA NOT IN ('mysql','sys')"}`,
      params
    );

    const colsByTable = new Map();
    for (const c of colRes.rows) {
      const k = `${c.table_schema}.${c.table_name}`;
      if (!colsByTable.has(k)) colsByTable.set(k, []);
      colsByTable.get(k).push({
        name: c.column_name,
        dataType: c.data_type,
        nullable: c.is_nullable === "YES",
        defaultValue: c.column_default,
        primaryKey: c.column_key === "PRI",
        unique: c.column_key === "UNI",
        autoIncrement: String(c.extra || "").includes("auto_increment"),
      });
    }

    const tables = [];
    const views = [];
    const schemaSet = new Set();
    for (const t of tblRes.rows) {
      schemaSet.add(t.table_schema);
      const cols = colsByTable.get(`${t.table_schema}.${t.table_name}`) || [];
      const ddl = `CREATE TABLE \`${t.table_name}\` (\n  ${cols.map((c) => `\`${c.name}\` ${c.dataType}${c.primaryKey ? " PRIMARY KEY" : ""}${!c.nullable ? " NOT NULL" : ""}`).join(",\n  ")}\n);`;
      if (String(t.table_type).toUpperCase().includes("VIEW")) {
        views.push({ schema: t.table_schema, name: t.table_name, type: "view", columns: cols });
      } else {
        tables.push({ schema: t.table_schema, name: t.table_name, type: "table", rowCount: Number(t.est_rows || 0), columns: cols, ddl });
      }
    }

    return {
      engine: "mysql",
      database: dbName || Array.from(schemaSet)[0] || "mysql",
      serverVersion: session.serverVersion,
      schemas: Array.from(schemaSet),
      tables,
      views,
      indexes: idxRes.rows.map((i) => ({
        schema: i.table_schema,
        table: i.table_name,
        name: i.index_name,
        unique: Number(i.non_unique) === 0,
        definition: `${i.index_name} (${i.cols || ""})`,
      })),
      triggers: trigRes.rows.map((tr) => ({
        schema: tr.trigger_schema,
        table: tr.event_object_table,
        name: tr.trigger_name,
        definition: tr.action_statement,
      })),
      foreignKeys: fkRes.rows.map((fk) => ({
        name: fk.constraint_name,
        fromSchema: fk.from_schema,
        fromTable: fk.from_table,
        fromColumn: fk.from_column,
        toSchema: fk.to_schema,
        toTable: fk.to_table,
        toColumn: fk.to_column,
      })),
    };
  }

  throw new Error(`Schema introspection unsupported for engine: ${engine}`);
}

function dbFormatSqlLiteral(val) {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function dbBuildParameterizedMutation(engine, change) {
  const tableRef = dbQualifyTable(engine, change.schema, change.table);
  const ph = (index) => (engine === "postgres" ? `$${index}` : "?");

  if (change.kind === "insert") {
    const entries = Object.entries(change.values || {});
    if (entries.length === 0) throw new Error("Insert requires at least one column.");
    const cols = entries.map(([k]) => dbQuoteIdent(engine, k)).join(", ");
    const params = entries.map(([, v]) => v);
    const holders = entries.map((_, idx) => ph(idx + 1)).join(", ");
    const preview = `INSERT INTO ${tableRef} (${cols}) VALUES (${entries.map(([, v]) => dbFormatSqlLiteral(v)).join(", ")});`;
    return { sql: `INSERT INTO ${tableRef} (${cols}) VALUES (${holders})`, params, preview };
  }

  if (change.kind === "update") {
    const setEntries = Object.entries(change.set || {});
    const keyEntries = Object.entries(change.key || {});
    if (setEntries.length === 0) throw new Error("Update requires at least one modified column.");
    if (keyEntries.length === 0) throw new Error("Update requires a primary key condition.");
    const params = [];
    const setClauses = setEntries.map(([k, v]) => {
      params.push(v);
      return `${dbQuoteIdent(engine, k)} = ${ph(params.length)}`;
    });
    const whereClauses = keyEntries.map(([k, v]) => {
      if (v === null) return `${dbQuoteIdent(engine, k)} IS NULL`;
      params.push(v);
      return `${dbQuoteIdent(engine, k)} = ${ph(params.length)}`;
    });
    const previewSet = setEntries.map(([k, v]) => `${dbQuoteIdent(engine, k)} = ${dbFormatSqlLiteral(v)}`).join(", ");
    const previewWhere = keyEntries.map(([k, v]) => (v === null ? `${dbQuoteIdent(engine, k)} IS NULL` : `${dbQuoteIdent(engine, k)} = ${dbFormatSqlLiteral(v)}`)).join(" AND ");
    return {
      sql: `UPDATE ${tableRef} SET ${setClauses.join(", ")} WHERE ${whereClauses.join(" AND ")}`,
      params,
      preview: `UPDATE ${tableRef} SET ${previewSet} WHERE ${previewWhere};`,
    };
  }

  if (change.kind === "delete") {
    const keyEntries = Object.entries(change.key || {});
    if (keyEntries.length === 0) throw new Error("Delete requires a primary key condition.");
    const params = [];
    const whereClauses = keyEntries.map(([k, v]) => {
      if (v === null) return `${dbQuoteIdent(engine, k)} IS NULL`;
      params.push(v);
      return `${dbQuoteIdent(engine, k)} = ${ph(params.length)}`;
    });
    const previewWhere = keyEntries.map(([k, v]) => (v === null ? `${dbQuoteIdent(engine, k)} IS NULL` : `${dbQuoteIdent(engine, k)} = ${dbFormatSqlLiteral(v)}`)).join(" AND ");
    return {
      sql: `DELETE FROM ${tableRef} WHERE ${whereClauses.join(" AND ")}`,
      params,
      preview: `DELETE FROM ${tableRef} WHERE ${previewWhere};`,
    };
  }

  throw new Error(`Unsupported change kind: ${change.kind}`);
}

async function dbDiscoverWorkspace(root) {
  if (!root || !exists(root)) return [];
  const findings = [];
  const skipDirs = new Set(["node_modules", ".git", "dist", "out", "build", "target", ".venv", "__pycache__", ".next"]);

  async function walk(dir, depth) {
    if (depth > 4 || findings.length >= 60) return;
    let entries = [];
    try {
      entries = await promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (findings.length >= 60) break;
      if (skipDirs.has(entry.name)) continue;
      if (/^\.env(\.|$)/i.test(entry.name)) continue;
      const fullPath = node_path.join(dir, entry.name);
      const rel = node_path.relative(root, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        await walk(fullPath, depth + 1);
        continue;
      }
      if (/\.(db|sqlite|sqlite3)$/i.test(entry.name)) {
        findings.push({
          kind: "sqlite-file",
          engine: "sqlite",
          label: entry.name,
          relativePath: rel,
          filePath: fullPath,
          autoAddable: true,
        });
      } else if (entry.name === "schema.prisma") {
        try {
          const text = await promises.readFile(fullPath, "utf8");
          const m = /datasource\s+\w+\s*\{[\s\S]*?provider\s*=\s*"([^"]+)"/i.exec(text);
          const provider = String(m?.[1] || "").toLowerCase();
          const engine = provider.includes("postgres") ? "postgres" : provider.includes("mysql") ? "mysql" : provider.includes("sqlite") ? "sqlite" : "postgres";
          findings.push({
            kind: "prisma-schema",
            engine,
            label: `Prisma (${provider || "datasource"})`,
            relativePath: rel,
            hint: "Credentials are referenced via env() — enter connection details or paste URI manually.",
            autoAddable: false,
          });
        } catch {
          void 0;
        }
      } else if (/^drizzle\.config\.(ts|js|mjs|cjs)$/i.test(entry.name)) {
        try {
          const text = await promises.readFile(fullPath, "utf8");
          const m = /dialect\s*:\s*["'`](postgres(?:ql)?|mysql|sqlite)["'`]/i.exec(text);
          const d = String(m?.[1] || "").toLowerCase();
          const engine = d.includes("postgres") ? "postgres" : d.includes("mysql") ? "mysql" : "sqlite";
          findings.push({
            kind: "drizzle-config",
            engine,
            label: `Drizzle (${d || "sql"})`,
            relativePath: rel,
            hint: "Detected Drizzle configuration (.env is intentionally not auto-read).",
            autoAddable: false,
          });
        } catch {
          void 0;
        }
      } else if (/^(docker-compose|compose)\.(ya?ml)$/i.test(entry.name)) {
        try {
          const text = await promises.readFile(fullPath, "utf8");
          const lines = text.split(/\r?\n/);
          let currentService = "";
          let currentEngine = null;
          let currentPort = null;
          const pushService = () => {
            if (!currentEngine) return;
            findings.push({
              kind: "docker-compose",
              engine: currentEngine,
              label: `Docker: ${currentService || currentEngine}`,
              relativePath: rel,
              host: "127.0.0.1",
              port: currentPort || DB_DEFAULT_PORTS[currentEngine],
              hint: `Port ${currentPort || DB_DEFAULT_PORTS[currentEngine]} in ${rel}`,
              autoAddable: false,
            });
          };
          for (const line of lines) {
            const svcMatch = /^\s{2}([a-zA-Z0-9_-]+):\s*$/.exec(line);
            if (svcMatch) {
              pushService();
              currentService = svcMatch[1];
              currentEngine = null;
              currentPort = null;
              continue;
            }
            const imgMatch = /^\s*image:\s*["']?([^"'\s#]+)/i.exec(line);
            if (imgMatch) {
              const img = imgMatch[1].toLowerCase();
              if (img.includes("postgres")) currentEngine = "postgres";
              else if (img.includes("mysql") || img.includes("mariadb")) currentEngine = "mysql";
              else if (img.includes("redis") || img.includes("valkey")) currentEngine = "redis";
            }
            const portMatch = /^\s*-\s*["']?(?:\d+\.\d+\.\d+\.\d+:)?(\d{2,5}):(\d{2,5})["']?/.exec(line);
            if (portMatch) {
              currentPort = Number(portMatch[1]);
            }
          }
          pushService();
        } catch {
          void 0;
        }
      }
    }
  }

  await walk(root, 0);
  return findings;
}

const PII_COL_RE = /(email|phone|mobile|tel|ssn|national_id|tckn|tc_kimlik|passport|credit_card|card_num|cvv|iban|tax_id|birth_date|dob|address)/i;
const SECRET_COL_RE = /(password|passwd|pwd|pass_hash|secret|api_key|access_token|refresh_token|private_key|auth_token)/i;

async function dbRunSecurityAudit(session) {
  const meta = session.meta;
  const schema = await dbIntrospectSchema(session);
  const findings = [];
  const pushFinding = (severity, category, title, detail, table = "", column = "") => {
    findings.push({ severity, category, title, detail, table, column });
  };

  if (meta.engine !== "sqlite") {
    const isLocal = ["127.0.0.1", "localhost", "::1"].includes(String(meta.host || "").toLowerCase());
    if (meta.tlsMode === "disable") {
      pushFinding(
        isLocal ? "medium" : "critical",
        "transport",
        "TLS encryption is disabled",
        `Connection "${meta.name}" has tlsMode=disable; credentials and query traffic travel in plaintext.`
      );
    } else if (meta.tlsMode === "prefer" && !isLocal) {
      pushFinding(
        "medium",
        "transport",
        "TLS certificate verification not enforced",
        `Connection "${meta.name}" uses tlsMode=prefer/require without verify-full CA pinning.`
      );
    }
  } else if (meta.filePath && exists(meta.filePath)) {
    try {
      const fd = await promises.open(meta.filePath, "r");
      const buf = Buffer.alloc(16);
      await fd.read(buf, 0, 16, 0);
      await fd.close();
      if (buf.toString("ascii", 0, 15) === "SQLite format 3") {
        pushFinding(
          meta.environment === "prod" ? "high" : "info",
          "storage",
          "Unencrypted SQLite database file",
          "Standard SQLite format 3 header detected; file is stored unencrypted on disk (not SQLCipher)."
        );
      }
    } catch {
      void 0;
    }
  }

  if (meta.environment === "prod" && !meta.readOnly) {
    pushFinding(
      "high",
      "access",
      "Production database is writable",
      `Connection "${meta.name}" is tagged prod without Read-Only Lock enabled.`
    );
  }

  for (const tbl of schema.tables || []) {
    const hasPk = (tbl.columns || []).some((c) => c.primaryKey);
    if (!hasPk) {
      pushFinding(
        "medium",
        "integrity",
        "Table missing PRIMARY KEY",
        `Table "${tbl.name}" has no primary key, which blocks safe row-diff editing and hurts integrity.`,
        tbl.name
      );
    }

    const secretCols = [];
    for (const col of tbl.columns || []) {
      if (SECRET_COL_RE.test(col.name)) {
        secretCols.push(col.name);
        pushFinding(
          "high",
          "credentials",
          "Sensitive credential/hash column",
          `Column "${tbl.name}.${col.name}" holds credential or secret material; ensure strong KDF/hashing and omit from logs/AI.`,
          tbl.name,
          col.name
        );
      } else if (PII_COL_RE.test(col.name)) {
        pushFinding(
          "medium",
          "pii",
          "Personal Identifiable Information (PII) column",
          `Column "${tbl.name}.${col.name}" appears to store PII; verify encryption at rest, masking, and retention policies.`,
          tbl.name,
          col.name
        );
      }
    }

    for (const colName of secretCols.slice(0, 3)) {
      try {
        const tblRef = dbQualifyTable(session.engine, tbl.schema, tbl.name);
        const colRef = dbQuoteIdent(session.engine, colName);
        const sampleRes = await session.query(
          `SELECT ${colRef} AS v FROM ${tblRef} WHERE ${colRef} IS NOT NULL LIMIT 10`
        );
        let sawWeak = "";
        let sawPlain = false;
        let sawStrong = false;
        for (const r of sampleRes.rows || []) {
          const val = String(r.v ?? "");
          if (!val) continue;
          if (/^\$2[aby]\$\d{2}\$/.test(val) || /^\$argon2(i|d|id)\$/i.test(val) || /^\$scrypt\$/i.test(val)) {
            sawStrong = true;
          } else if (/^[a-f0-9]{32}$/i.test(val)) {
            sawWeak = "32-char hex (MD5-like)";
          } else if (/^[a-f0-9]{40}$/i.test(val)) {
            sawWeak = "40-char hex (unsalted SHA-1-like)";
          } else if (/^[a-f0-9]{64}$/i.test(val)) {
            sawWeak = "64-char hex (unsalted SHA-256-like)";
          } else if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(val)) {
            sawWeak = "Unencrypted JWT token stored in column";
          } else if (val.length < 28 && !val.startsWith("$")) {
            sawPlain = true;
          }
        }
        if (sawPlain) {
          pushFinding(
            "critical",
            "crypto",
            "Potential plaintext passwords or short secrets",
            `Non-hashed short values detected in "${tbl.name}.${colName}" (values masked for safety).`,
            tbl.name,
            colName
          );
        } else if (sawWeak && !sawStrong) {
          pushFinding(
            "critical",
            "crypto",
            "Weak / unsalted password hash format detected",
            `${sawWeak} pattern observed in "${tbl.name}.${colName}". Migrate to Argon2id or bcrypt.`,
            tbl.name,
            colName
          );
        }
      } catch {
        void 0;
      }
    }
  }

  const summary = { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) {
    if (summary[f.severity] !== undefined) summary[f.severity] += 1;
  }
  return { findings, summary };
}

function dbCsvCell(val) {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function dbSerializeExport(format, table, columns, rows) {
  const colNames = (columns || []).map((c) => c.name);
  if (format === "json") {
    return JSON.stringify(rows || [], null, 2);
  }
  if (format === "csv") {
    const header = colNames.map(dbCsvCell).join(",");
    const body = (rows || []).map((r) => colNames.map((c) => dbCsvCell(r[c])).join(","));
    return [header, ...body].join("\n");
  }
  if (format === "sql") {
    const tblName = table || "exported_table";
    const colList = colNames.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(", ");
    return (rows || [])
      .map((r) => {
        const vals = colNames.map((c) => dbFormatSqlLiteral(r[c])).join(", ");
        return `INSERT INTO "${String(tblName).replace(/"/g, '""')}" (${colList}) VALUES (${vals});`;
      })
      .join("\n");
  }
  throw new Error(`Unsupported export format: ${format}`);
}

function dbQueriesDir(root) {
  return node_path.join(root, ".wide", "queries");
}

function dbSanitizeQueryName(name) {
  const clean = String(name || "")
    .trim()
    .replace(/\.sql$/i, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return clean || "query";
}

function dbRedactAiRow(row) {
  const out = {};
  for (const [k, v] of Object.entries(row || {})) {
    out[k] = SECRET_COL_RE.test(k) && v !== null ? "[redacted-secret-column]" : v;
  }
  return out;
}

async function aiDbListConnections() {
  const metas = await dbReadConnectionsMeta();
  const vault = await dbReadVaultMap();
  return metas.map((m) => dbMaskSummary(m, vault[m.id]));
}

async function aiDbInspectSchema(connectionId) {
  const session = await dbEnsureSession(String(connectionId || ""));
  const schema = await dbIntrospectSchema(session);
  if (schema.engine === "redis") {
    return {
      engine: "redis",
      database: schema.database,
      dbSize: schema.dbSize,
      keyPrefixes: (schema.keyPrefixes || []).slice(0, 30),
    };
  }
  return {
    engine: schema.engine,
    database: schema.database,
    tables: (schema.tables || []).slice(0, 60).map((t) => ({
      schema: t.schema,
      name: t.name,
      rowCount: t.rowCount,
      columns: (t.columns || []).map((c) => `${c.name}:${c.dataType}${c.primaryKey ? "(PK)" : ""}${!c.nullable ? " NOT NULL" : ""}`),
    })),
    foreignKeys: (schema.foreignKeys || []).slice(0, 60),
  };
}

async function aiDbQueryReadonly(connectionId, sql, limit = 100) {
  const session = await dbEnsureSession(String(connectionId || ""));
  if (session.engine === "redis") {
    throw new Error("ai_db_query_readonly only supports SQL connections.");
  }
  const trimmed = String(sql || "").trim().replace(/;+\s*$/, "");
  const analysis = dbAnalyzeSql(trimmed);
  if (!analysis.readOnly || analysis.dangerous) {
    throw new Error("AI database queries are strictly read-only (SELECT / WITH SELECT / SHOW / EXPLAIN only).");
  }
  const capped = Math.max(1, Math.min(200, Number(limit || 100) || 100));
  const prep = dbPrepareExecutableSql(trimmed, session.engine, { limit: capped });
  const t0 = Date.now();
  const res = await session.query(prep.execSql, []);
  const truncated = prep.appliedLimit !== null && res.rows.length > prep.appliedLimit;
  const rows = (truncated ? res.rows.slice(0, prep.appliedLimit) : res.rows).map(dbRedactAiRow);
  return {
    columns: res.columns,
    rows,
    rowCount: rows.length,
    truncated,
    durationMs: Date.now() - t0,
  };
}

async function disposeDatabases() {
  const ids = Array.from(dbSessions.keys());
  for (const id of ids) {
    await dbCloseSessionEntry(id);
  }
}

function registerDatabaseHandlers() {
  electron.ipcMain.handle("db:list", async () => {
    try {
      const metas = await dbReadConnectionsMeta();
      const vault = await dbReadVaultMap();
      return { ok: true, connections: metas.map((m) => dbMaskSummary(m, vault[m.id])) };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:save", async (_event, input = {}) => {
    try {
      const metas = await dbReadConnectionsMeta();
      const vault = await dbReadVaultMap();
      const idx = metas.findIndex((m) => m.id === input.id);
      const existingMeta = idx >= 0 ? metas[idx] : null;
      const existingSecret = existingMeta ? vault[existingMeta.id] : null;
      const { meta, secret } = dbValidateConnectionInput(input, existingMeta, existingSecret);

      if (idx >= 0) metas[idx] = meta;
      else metas.push(meta);

      if (Object.keys(secret).length > 0) vault[meta.id] = secret;
      else delete vault[meta.id];

      await dbWriteConnectionsMeta(metas);
      await dbWriteVaultMap(vault);
      await dbCloseSessionEntry(meta.id);

      return { ok: true, connection: dbMaskSummary(meta, secret) };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:delete", async (_event, id) => {
    try {
      const targetId = String(id || "");
      await dbCloseSessionEntry(targetId);
      const metas = await dbReadConnectionsMeta();
      const filtered = metas.filter((m) => m.id !== targetId);
      const vault = await dbReadVaultMap();
      delete vault[targetId];
      await dbWriteConnectionsMeta(filtered);
      await dbWriteVaultMap(vault);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:test", async (_event, input = {}) => {
    let tempSession = null;
    try {
      const metas = await dbReadConnectionsMeta();
      const vault = await dbReadVaultMap();
      const existingMeta = input.id ? metas.find((m) => m.id === input.id) : null;
      const existingSecret = existingMeta ? vault[existingMeta.id] : null;
      const { meta, secret } = dbValidateConnectionInput(input, existingMeta, existingSecret);
      const started = Date.now();
      tempSession = await dbOpenDriverSession(meta, secret);
      return { ok: true, latencyMs: Date.now() - started, serverVersion: tempSession.serverVersion };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    } finally {
      if (tempSession) {
        try {
          await tempSession.close();
        } catch {
          void 0;
        }
        if (tempSession.tunnel?.child) {
          try {
            killProcessTree(tempSession.tunnel.child);
          } catch {
            void 0;
          }
        }
      }
    }
  });

  electron.ipcMain.handle("db:discover", async (_event, root) => {
    try {
      const items = await dbDiscoverWorkspace(String(root || ""));
      return { ok: true, items };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:connect", async (_event, id) => {
    try {
      const session = await dbEnsureSession(String(id || ""));
      return { ok: true, connected: true, serverVersion: session.serverVersion };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:disconnect", async (_event, id) => {
    try {
      await dbCloseSessionEntry(String(id || ""));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:schema", async (_event, id) => {
    try {
      const session = await dbEnsureSession(String(id || ""));
      const schema = await dbIntrospectSchema(session);
      return { ok: true, schema };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:query", async (_event, id, sql, options = {}) => {
    try {
      const session = await dbEnsureSession(String(id || ""));
      if (session.engine === "redis") {
        return { ok: false, error: "Use Redis inspector for Redis/Valkey connections." };
      }
      const rawSql = String(sql || "");
      const { execSql, analysis, appliedLimit } = dbPrepareExecutableSql(rawSql, session.engine, options);
      if (session.meta.readOnly && !analysis.readOnly) {
        return {
          ok: false,
          readOnlyBlocked: true,
          error: "Connection is locked in Read-Only mode. Write/DDL statements are blocked.",
        };
      }
      if (analysis.dangerous && !options?.allowDangerous) {
        return {
          ok: false,
          dangerous: analysis.dangerous,
          error: analysis.dangerous.reason,
        };
      }
      const started = Date.now();
      const params = Array.isArray(options?.params) ? options.params : [];
      const res = await session.query(execSql, params);
      const durationMs = Date.now() - started;
      const truncated = appliedLimit !== null && res.rows.length > appliedLimit;
      const finalRows = truncated ? res.rows.slice(0, appliedLimit) : res.rows;
      return {
        ok: true,
        result: {
          columns: res.columns,
          rows: finalRows,
          rowCount: res.columns.length > 0 ? finalRows.length : res.changes,
          affectedRows: res.changes,
          durationMs,
          appliedLimit,
          truncated,
          isExplain: Boolean(options?.explain),
          statementType: analysis.keyword || "SQL",
        },
      };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:applyChanges", async (_event, id, changes = []) => {
    try {
      const session = await dbEnsureSession(String(id || ""));
      if (session.meta.readOnly) {
        return { ok: false, readOnlyBlocked: true, error: "Connection is locked in Read-Only mode." };
      }
      if (!Array.isArray(changes) || changes.length === 0) {
        return { ok: false, error: "No pending changes to apply." };
      }
      if (session.engine === "redis") {
        return { ok: false, error: "Transactional row diff is only supported on SQL connections." };
      }

      const statements = changes.map((c) => dbBuildParameterizedMutation(session.engine, c));
      const sqlPreview = statements.map((s) => s.preview);

      await session.query(session.engine === "mysql" ? "START TRANSACTION" : "BEGIN", []);
      try {
        let applied = 0;
        for (const st of statements) {
          const r = await session.query(st.sql, st.params);
          applied += Number(r.changes || 1);
        }
        await session.query("COMMIT", []);
        return { ok: true, applied, sqlPreview };
      } catch (err) {
        try {
          await session.query("ROLLBACK", []);
        } catch {
          void 0;
        }
        throw err;
      }
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:export", async (_event, id, options = {}) => {
    try {
      const session = await dbEnsureSession(String(id || ""));
      if (session.engine === "redis") {
        return { ok: false, error: "Tabular export is not supported on Redis connections." };
      }
      const format = String(options.format || "csv").toLowerCase();
      let sourceSql = String(options.sql || "").trim();
      if (!sourceSql && options.table) {
        const tbl = dbQualifyTable(session.engine, options.schema, options.table);
        sourceSql = `SELECT * FROM ${tbl}`;
      }
      if (!sourceSql) return { ok: false, error: "Table or SQL query is required for export." };
      const analysis = dbAnalyzeSql(sourceSql);
      if (!analysis.readOnly) {
        return { ok: false, error: "Export only permits read-only SELECT queries." };
      }
      const prep = dbPrepareExecutableSql(sourceSql, session.engine, { limit: 5000 });
      const res = await session.query(prep.execSql, []);
      const rows = prep.appliedLimit !== null && res.rows.length > prep.appliedLimit ? res.rows.slice(0, prep.appliedLimit) : res.rows;
      const content = dbSerializeExport(format, options.table || "query_result", res.columns, rows);

      if (options.outputPath) {
        const target = String(options.outputPath);
        if (options.root && !isInside(options.root, target)) {
          return { ok: false, error: "Export path is outside workspace root." };
        }
        await writeFileAtomic(target, content, "utf8");
        return { ok: true, filePath: target, rowCount: rows.length };
      }
      return { ok: true, content, rowCount: rows.length };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:audit", async (_event, id) => {
    try {
      const session = await dbEnsureSession(String(id || ""));
      const audit = await dbRunSecurityAudit(session);
      return { ok: true, ...audit };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:listSavedQueries", async (_event, root) => {
    try {
      if (!root) return { ok: true, queries: [] };
      const dir = dbQueriesDir(String(root));
      if (!exists(dir)) return { ok: true, queries: [] };
      const entries = await promises.readdir(dir, { withFileTypes: true });
      const queries = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".sql")) continue;
        const full = node_path.join(dir, entry.name);
        if (!isInside(root, full)) continue;
        const [sql, stat] = await Promise.all([promises.readFile(full, "utf8"), promises.stat(full)]);
        queries.push({
          name: entry.name.replace(/\.sql$/i, ""),
          fileName: entry.name,
          path: full,
          sql,
          updatedAt: stat.mtimeMs,
        });
      }
      queries.sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, queries };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:saveQuery", async (_event, root, name, sql) => {
    try {
      if (!root) return { ok: false, error: "Workspace root is required." };
      const clean = dbSanitizeQueryName(name);
      const dir = dbQueriesDir(String(root));
      const full = node_path.join(dir, `${clean}.sql`);
      if (!isInside(root, full)) return { ok: false, error: "Target query path escapes workspace root." };
      await writeFileAtomic(full, String(sql || ""), "utf8");
      return { ok: true, path: full, name: clean };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });

  electron.ipcMain.handle("db:redisCommand", async (_event, id, action, params = {}) => {
    try {
      const session = await dbEnsureSession(String(id || ""));
      if (session.engine !== "redis") {
        return { ok: false, error: "Connection is not Redis/Valkey." };
      }
      const client = session.client;
      if (action === "scan") {
        const cursor = String(params.cursor || "0");
        const pattern = String(params.pattern || "*").trim() || "*";
        const count = Math.max(10, Math.min(200, Number(params.count || 100) || 100));
        const res = await client.scan(cursor, "MATCH", pattern, "COUNT", String(count));
        const nextCursor = String(res?.[0] || "0");
        const rawKeys = Array.isArray(res?.[1]) ? res[1] : [];
        const items = [];
        for (const k of rawKeys.slice(0, 100)) {
          const [type, ttl] = await Promise.all([client.type(k), client.ttl(k)]);
          items.push({ key: k, type, ttl: Number(ttl) });
        }
        return { ok: true, cursor: nextCursor, items };
      }
      if (action === "get") {
        const key = String(params.key || "");
        if (!key) return { ok: false, error: "Key is required." };
        const [type, ttl] = await Promise.all([client.type(key), client.ttl(key)]);
        let value = null;
        if (type === "string") value = await client.get(key);
        else if (type === "hash") value = await client.hgetall(key);
        else if (type === "list") value = await client.lrange(key, 0, 199);
        else if (type === "set") value = await client.smembers(key);
        else if (type === "zset") value = await client.zrange(key, 0, 199, "WITHSCORES");
        else if (type === "stream") value = await client.xrange(key, "-", "+", "COUNT", "50");
        return { ok: true, key, type, ttl: Number(ttl), value };
      }
      if (action === "info") {
        const info = await client.info();
        return { ok: true, info: String(info || "") };
      }
      if (action === "del") {
        if (session.meta.readOnly) {
          return { ok: false, readOnlyBlocked: true, error: "Connection is locked in Read-Only mode." };
        }
        const key = String(params.key || "");
        if (!key) return { ok: false, error: "Key is required." };
        const deleted = await client.del(key);
        return { ok: true, deleted: Number(deleted || 0) };
      }
      return { ok: false, error: `Unsupported Redis action: ${action}` };
    } catch (error) {
      return { ok: false, error: dbRedactError(error) };
    }
  });
}
