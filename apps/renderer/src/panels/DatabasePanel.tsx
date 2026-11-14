import { useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Download,
  Edit3,
  Eye,
  FileCode2,
  FolderSearch,
  KeyRound,
  Link2,
  Lock,
  Play,
  Plug,
  PlugZap,
  Plus,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Table2,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { bridge, type DbConnectionSummary, type DbDiscoveredSource, type DbEngine, type DbEnvironment, type DbSaveInput, type DbTableMeta, type DbTlsMode } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { useAi } from "@/stores/ai";
import { useDatabase } from "@/stores/database";
import { useEditor } from "@/stores/editor";
import { toast } from "@/stores/toast";
import { useWorkspace } from "@/stores/workspace";
import { cn } from "@/lib/utils";

const ENV_BADGE: Record<DbEnvironment, string> = {
  dev: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
  staging: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  prod: "border-rose-500/40 bg-rose-500/15 text-rose-400",
};

const ENGINE_LABEL: Record<DbEngine, string> = {
  sqlite: "SQLite",
  postgres: "PG",
  mysql: "MySQL",
  redis: "Redis",
};

const DEFAULT_PORT: Record<DbEngine, number> = {
  sqlite: 0,
  postgres: 5432,
  mysql: 3306,
  redis: 6379,
};

function DatabaseConnectionModal() {
  const t = useT();
  const modalOpen = useDatabase((s) => s.modalOpen);
  const editing = useDatabase((s) => s.editingConnection);
  const prefill = useDatabase((s) => s.modalPrefill);
  const closeModal = useDatabase((s) => s.closeModal);
  const saveConnection = useDatabase((s) => s.saveConnection);

  const [engine, setEngine] = useState<DbEngine>("postgres");
  const [name, setName] = useState("");
  const [environment, setEnvironment] = useState<DbEnvironment>("dev");
  const [readOnly, setReadOnly] = useState(false);
  const [connectionString, setConnectionString] = useState("");
  const [filePath, setFilePath] = useState("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState<number>(5432);
  const [database, setDatabase] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [tlsMode, setTlsMode] = useState<DbTlsMode>("prefer");
  const [caPath, setCaPath] = useState("");
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState<number>(22);
  const [sshUser, setSshUser] = useState("");
  const [sshAuth, setSshAuth] = useState<"agent" | "key">("agent");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!modalOpen) return;
    setTestResult(null);
    if (editing) {
      setEngine(editing.engine);
      setName(editing.name);
      setEnvironment(editing.environment);
      setReadOnly(editing.readOnly);
      setConnectionString("");
      setFilePath(editing.filePath);
      setHost(editing.host || "127.0.0.1");
      setPort(editing.port || DEFAULT_PORT[editing.engine]);
      setDatabase(editing.database);
      setUsername(editing.username);
      setPassword("");
      setTlsMode(editing.tlsMode);
      setCaPath(editing.caPath);
      setSshEnabled(Boolean(editing.sshTunnel?.enabled));
      setSshHost(editing.sshTunnel?.host || "");
      setSshPort(editing.sshTunnel?.port || 22);
      setSshUser(editing.sshTunnel?.username || "");
      setSshAuth(editing.sshTunnel?.authMethod || "agent");
      setSshKeyPath(editing.sshTunnel?.privateKeyPath || "");
    } else {
      const nextEngine = prefill?.engine || "sqlite";
      const nextEnv = prefill?.environment || "dev";
      setEngine(nextEngine);
      setName(prefill?.name || "");
      setEnvironment(nextEnv);
      setReadOnly(prefill?.readOnly ?? nextEnv === "prod");
      setConnectionString(prefill?.connectionString || "");
      setFilePath(prefill?.filePath || "");
      setHost(prefill?.host || "127.0.0.1");
      setPort(prefill?.port || DEFAULT_PORT[nextEngine]);
      setDatabase(prefill?.database || (nextEngine === "redis" ? "0" : ""));
      setUsername(prefill?.username || "");
      setPassword(prefill?.password || "");
      setTlsMode(prefill?.tlsMode || "prefer");
      setCaPath("");
      setSshEnabled(false);
      setSshHost("");
      setSshPort(22);
      setSshUser("");
      setSshAuth("agent");
      setSshKeyPath("");
    }
  }, [modalOpen, editing, prefill]);

  if (!modalOpen) return null;

  const parseUriField = (raw: string) => {
    setConnectionString(raw);
    const trimmed = raw.trim();
    if (!trimmed) return;
    try {
      if (/^postgres(ql)?:\/\//i.test(trimmed) || /^mysql:\/\//i.test(trimmed) || /^rediss?:\/\//i.test(trimmed)) {
        const u = new URL(trimmed);
        const eng: DbEngine = u.protocol.startsWith("postgres") ? "postgres" : u.protocol.startsWith("mysql") ? "mysql" : "redis";
        setEngine(eng);
        setHost(u.hostname || "127.0.0.1");
        setPort(u.port ? Number(u.port) : DEFAULT_PORT[eng]);
        setUsername(decodeURIComponent(u.username || ""));
        if (u.password) setPassword(decodeURIComponent(u.password));
        setDatabase(decodeURIComponent((u.pathname || "").replace(/^\//, "")) || (eng === "redis" ? "0" : ""));
        if (u.protocol === "rediss:") setTlsMode("require");
        const sslm = u.searchParams.get("sslmode");
        if (sslm === "disable" || sslm === "prefer" || sslm === "require" || sslm === "verify-full") {
          setTlsMode(sslm);
        }
      } else if (/^sqlite:\/\//i.test(trimmed) || /\.(db|sqlite|sqlite3)$/i.test(trimmed)) {
        setEngine("sqlite");
        setFilePath(trimmed.replace(/^sqlite:\/\//i, ""));
      }
    } catch {
      void 0;
    }
  };

  const buildPayload = (): DbSaveInput => ({
    id: editing?.id,
    name: name.trim() || undefined,
    engine,
    environment,
    readOnly,
    filePath: engine === "sqlite" ? filePath.trim() : undefined,
    host: engine !== "sqlite" ? host.trim() : undefined,
    port: engine !== "sqlite" ? Number(port) || DEFAULT_PORT[engine] : undefined,
    database: engine !== "sqlite" ? database.trim() : undefined,
    username: engine !== "sqlite" ? username.trim() : undefined,
    password: password !== "" ? password : editing ? undefined : "",
    connectionString: connectionString.trim() ? connectionString.trim() : undefined,
    tlsMode,
    caPath: caPath.trim() || undefined,
    sshTunnel:
      engine !== "sqlite"
        ? {
            enabled: sshEnabled,
            host: sshHost.trim(),
            port: Number(sshPort) || 22,
            username: sshUser.trim(),
            authMethod: sshAuth,
            privateKeyPath: sshKeyPath.trim(),
          }
        : undefined,
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await bridge.dbTest(buildPayload());
      if (res.ok) {
        setTestResult({ ok: true, msg: `${res.serverVersion || "Connected"} (${res.latencyMs ?? 0}ms)` });
      } else {
        setTestResult({ ok: false, msg: res.error || "Connection test failed" });
      }
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const saved = await saveConnection(buildPayload());
      if (saved) {
        await useDatabase.getState().connectAndLoadSchema(saved.id);
        useEditor.getState().openDatabase();
      }
    } finally {
      setSaving(false);
    }
  };

  const handleBrowseSqlite = async () => {
    const picked = await bridge.openFile();
    if (picked?.path) {
      setFilePath(picked.path);
      if (!name) setName(picked.name || "SQLite");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={closeModal}>
      <div
        className="flex max-h-[88vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="flex items-center gap-2 text-[13px] font-medium text-ink">
            <Database className="h-4 w-4 text-accent" />
            <span>{editing ? t("Edit Database Connection") : t("New Database Connection")}</span>
          </div>
          <button type="button" onClick={closeModal} className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-3 overflow-y-auto p-4 text-[12px]">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-2">{t("Engine")}</label>
            <div className="grid grid-cols-4 gap-1.5">
              {(["sqlite", "postgres", "mysql", "redis"] as DbEngine[]).map((eng) => (
                <button
                  key={eng}
                  type="button"
                  onClick={() => {
                    setEngine(eng);
                    setPort(DEFAULT_PORT[eng]);
                    if (eng === "redis" && !database) setDatabase("0");
                  }}
                  className={cn(
                    "rounded border px-2 py-1.5 text-[11px] font-medium transition-colors",
                    engine === eng ? "border-accent bg-accent/15 text-accent" : "border-line bg-raised text-ink-2 hover:text-ink"
                  )}
                >
                  {eng === "sqlite" ? "SQLite" : eng === "postgres" ? "PostgreSQL" : eng === "mysql" ? "MySQL" : "Redis"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-2">{t("Paste Connection URI (optional)")}</label>
            <input
              type="text"
              value={connectionString}
              onChange={(e) => parseUriField(e.target.value)}
              placeholder="postgres://user:pass@localhost:5432/app?sslmode=require"
              className="w-full rounded border border-line bg-input px-2.5 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-ink-2">{t("Connection Name")}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="local-dev"
                className="w-full rounded border border-line bg-input px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-ink-2">{t("Environment")}</label>
              <select
                value={environment}
                onChange={(e) => {
                  const env = e.target.value as DbEnvironment;
                  setEnvironment(env);
                  if (env === "prod") setReadOnly(true);
                }}
                className="w-full rounded border border-line bg-input px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
              >
                <option value="dev">dev</option>
                <option value="staging">staging</option>
                <option value="prod">prod</option>
              </select>
            </div>
          </div>

          {engine === "sqlite" ? (
            <div>
              <label className="mb-1 block text-[11px] font-medium text-ink-2">{t("SQLite File Path")}</label>
              <div className="flex gap-1.5">
                <input
                  type="text"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="C:\project\dev.db"
                  className="min-w-0 flex-1 rounded border border-line bg-input px-2.5 py-1.5 font-mono text-[11px] text-ink outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={handleBrowseSqlite}
                  className="shrink-0 rounded border border-line bg-raised px-2.5 py-1 text-[11px] text-ink-2 hover:text-ink"
                >
                  {t("Browse")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="mb-1 block text-[11px] font-medium text-ink-2">{t("Host")}</label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="w-full rounded border border-line bg-input px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-ink-2">{t("Port")}</label>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                    className="w-full rounded border border-line bg-input px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-ink-2">
                    {engine === "redis" ? t("DB Index") : t("Database")}
                  </label>
                  <input
                    type="text"
                    value={database}
                    onChange={(e) => setDatabase(e.target.value)}
                    placeholder={engine === "redis" ? "0" : "postgres"}
                    className="w-full rounded border border-line bg-input px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-ink-2">{t("TLS Mode")}</label>
                  <select
                    value={tlsMode}
                    onChange={(e) => setTlsMode(e.target.value as DbTlsMode)}
                    className="w-full rounded border border-line bg-input px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                  >
                    <option value="disable">disable</option>
                    <option value="prefer">prefer</option>
                    <option value="require">require</option>
                    <option value="verify-full">verify-full</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-ink-2">{t("Username")}</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full rounded border border-line bg-input px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-ink-2">{t("Password")}</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={editing?.hasPassword ? "Saved in encrypted vault" : ""}
                    className="w-full rounded border border-line bg-input px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-accent"
                  />
                </div>
              </div>

              <div className="rounded border border-line bg-raised/60 p-2.5">
                <label className="flex cursor-pointer items-center gap-2 text-[11px] font-medium text-ink">
                  <input type="checkbox" checked={sshEnabled} onChange={(e) => setSshEnabled(e.target.checked)} />
                  <span>{t("SSH Bastion Tunnel")}</span>
                </label>
                {sshEnabled && (
                  <div className="mt-2.5 space-y-2 border-t border-line pt-2.5">
                    <div className="grid grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={sshHost}
                        onChange={(e) => setSshHost(e.target.value)}
                        placeholder="bastion.example.com"
                        className="col-span-2 rounded border border-line bg-input px-2 py-1 text-[11px] text-ink outline-none"
                      />
                      <input
                        type="number"
                        value={sshPort}
                        onChange={(e) => setSshPort(Number(e.target.value))}
                        placeholder="22"
                        className="rounded border border-line bg-input px-2 py-1 text-[11px] text-ink outline-none"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        value={sshUser}
                        onChange={(e) => setSshUser(e.target.value)}
                        placeholder="ssh username"
                        className="rounded border border-line bg-input px-2 py-1 text-[11px] text-ink outline-none"
                      />
                      <select
                        value={sshAuth}
                        onChange={(e) => setSshAuth(e.target.value as "agent" | "key")}
                        className="rounded border border-line bg-input px-2 py-1 text-[11px] text-ink outline-none"
                      >
                        <option value="agent">SSH Agent</option>
                        <option value="key">Private Key File</option>
                      </select>
                    </div>
                    {sshAuth === "key" && (
                      <input
                        type="text"
                        value={sshKeyPath}
                        onChange={(e) => setSshKeyPath(e.target.value)}
                        placeholder="~/.ssh/id_ed25519"
                        className="w-full rounded border border-line bg-input px-2 py-1 font-mono text-[11px] text-ink outline-none"
                      />
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          <label className="flex cursor-pointer items-center gap-2 rounded border border-line bg-raised/50 px-2.5 py-2 text-[11px] text-ink">
            <input type="checkbox" checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} />
            <Lock className="h-3.5 w-3.5 text-amber-400" />
            <span>{t("Read-Only Lock (blocks INSERT / UPDATE / DELETE / DDL)")}</span>
          </label>

          {testResult && (
            <div
              className={cn(
                "rounded border px-2.5 py-1.5 text-[11px]",
                testResult.ok ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"
              )}
            >
              {testResult.msg}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-line px-4 py-2.5">
          <button
            type="button"
            disabled={testing}
            onClick={handleTest}
            className="flex items-center gap-1.5 rounded border border-line bg-raised px-3 py-1.5 text-[11px] font-medium text-ink hover:bg-hover disabled:opacity-50"
          >
            <PlugZap className="h-3.5 w-3.5" />
            <span>{testing ? t("Testing...") : t("Test Connection")}</span>
          </button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={closeModal} className="rounded px-3 py-1.5 text-[11px] text-ink-2 hover:text-ink">
              {t("Cancel")}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {saving ? t("Saving...") : t("Save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function DatabasePanel() {
  const t = useT();
  const root = useWorkspace((s) => s.root);
  const connections = useDatabase((s) => s.connections);
  const discovered = useDatabase((s) => s.discovered);
  const schemas = useDatabase((s) => s.schemas);
  const connectingId = useDatabase((s) => s.connectingId);
  const activeConnectionId = useDatabase((s) => s.activeConnectionId);

  const loadConnections = useDatabase((s) => s.loadConnections);
  const discoverWorkspace = useDatabase((s) => s.discoverWorkspace);
  const connectAndLoadSchema = useDatabase((s) => s.connectAndLoadSchema);
  const disconnectConnection = useDatabase((s) => s.disconnectConnection);
  const deleteConnection = useDatabase((s) => s.deleteConnection);
  const openModal = useDatabase((s) => s.openModal);
  const openTableGrid = useDatabase((s) => s.openTableGrid);
  const setQueryText = useDatabase((s) => s.setQueryText);
  const setSubView = useDatabase((s) => s.setSubView);
  const selectConnection = useDatabase((s) => s.selectConnection);
  const runAudit = useDatabase((s) => s.runAudit);
  const saveConnection = useDatabase((s) => s.saveConnection);

  const [expandedConn, setExpandedConn] = useState<Record<string, boolean>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; conn: DbConnectionSummary; table: DbTableMeta } | null>(null);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  useEffect(() => {
    void discoverWorkspace(root);
  }, [root, discoverWorkspace]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [contextMenu]);

  const unaddedDiscovered = useMemo(() => {
    const existingFiles = new Set(connections.map((c) => c.filePath).filter(Boolean));
    return discovered.filter((d) => !(d.filePath && existingFiles.has(d.filePath)));
  }, [discovered, connections]);

  const handleQuickAddDiscovered = async (item: DbDiscoveredSource) => {
    if (item.autoAddable && item.engine === "sqlite" && item.filePath) {
      const saved = await saveConnection({
        name: item.label,
        engine: "sqlite",
        environment: "dev",
        readOnly: false,
        filePath: item.filePath,
      });
      if (saved) {
        await connectAndLoadSchema(saved.id);
        useEditor.getState().openDatabase();
      }
      return;
    }
    openModal(null, {
      engine: item.engine,
      name: item.label,
      host: item.host || "127.0.0.1",
      port: item.port || DEFAULT_PORT[item.engine],
      environment: "dev",
    });
  };

  const handleToggleConnection = async (conn: DbConnectionSummary) => {
    const next = !expandedConn[conn.id];
    setExpandedConn((prev) => ({ ...prev, [conn.id]: next }));
    selectConnection(conn.id);
    if (next && !schemas[conn.id]) {
      await connectAndLoadSchema(conn.id);
    }
  };

  const handleSendTableToAi = async (conn: DbConnectionSummary, tbl: DbTableMeta) => {
    const schema = schemas[conn.id];
    const fkList = (schema?.foreignKeys || []).filter((fk) => fk.fromTable === tbl.name || fk.toTable === tbl.name);
    const ddl =
      tbl.ddl ||
      `CREATE TABLE ${tbl.name} (\n  ${tbl.columns.map((c) => `${c.name} ${c.dataType}${c.primaryKey ? " PRIMARY KEY" : ""}${!c.nullable ? " NOT NULL" : ""}`).join(",\n  ")}\n);`;
    const prompt = `Here is the schema for table "${tbl.name}" on "${conn.name}" (${conn.engine}):\n\n\`\`\`sql\n${ddl}\n\`\`\`\n${
      fkList.length > 0 ? `\nForeign Keys:\n${fkList.map((fk) => `- ${fk.fromTable}.${fk.fromColumn} -> ${fk.toTable}.${fk.toColumn}`).join("\n")}\n` : ""
    }\nHelp me analyze indexes, security risks, and efficient queries for this table.`;

    const sid = await useAi.getState().newSession();
    if (!sid) {
      toast.error(t("Could not initialize AI session."));
      return;
    }
    useAi.getState().setPendingDraft(sid, prompt);
    useEditor.getState().openAiChat(sid, `DB: ${tbl.name}`);
  };

  const handleExportTable = async (conn: DbConnectionSummary, tbl: DbTableMeta, format: "csv" | "json" | "sql") => {
    const res = await bridge.dbExport(conn.id, { format, table: tbl.name, schema: tbl.schema });
    if (!res.ok || res.content === undefined) {
      toast.error(res.error || "Export failed.");
      return;
    }
    try {
      await navigator.clipboard.writeText(res.content);
      toast.success(`Copied ${res.rowCount ?? 0} row(s) as ${format.toUpperCase()} to clipboard.`);
    } catch {
      toast.success(`Exported ${res.rowCount ?? 0} row(s).`);
    }
  };

  const handleContextMenu = (e: MouseEvent, conn: DbConnectionSummary, table: DbTableMeta) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, conn, table });
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-ink select-none">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-2">{t("Database")}</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title={t("Open SQL Console")}
            onClick={() => useEditor.getState().openDatabase()}
            className="rounded p-1 text-ink-2 hover:bg-hover hover:text-ink"
          >
            <FileCode2 className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={t("Scan Workspace")}
            onClick={() => void discoverWorkspace(root)}
            className="rounded p-1 text-ink-2 hover:bg-hover hover:text-ink"
          >
            <FolderSearch className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={t("Refresh")}
            onClick={() => {
              void loadConnections();
              if (activeConnectionId) void connectAndLoadSchema(activeConnectionId);
            }}
            className="rounded p-1 text-ink-2 hover:bg-hover hover:text-ink"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            title={t("New Connection")}
            onClick={() => openModal(null)}
            className="rounded p-1 text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-1.5 py-2 text-[12px]">
        {unaddedDiscovered.length > 0 && (
          <div className="mb-2.5 rounded border border-line bg-raised/60 p-2">
            <div className="mb-1.5 flex items-center justify-between text-[10px] font-semibold uppercase tracking-wider text-ink-3">
              <span>{t("Workspace Detected")}</span>
              <span>{unaddedDiscovered.length}</span>
            </div>
            <div className="space-y-1">
              {unaddedDiscovered.map((item, idx) => (
                <div
                  key={`${item.relativePath}-${idx}`}
                  className="flex items-center justify-between gap-1.5 rounded px-1.5 py-1 text-[11px] hover:bg-hover"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-ink">{item.label}</div>
                    <div className="truncate text-[10px] text-ink-3">{item.relativePath}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleQuickAddDiscovered(item)}
                    className="shrink-0 rounded border border-accent/40 bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent hover:bg-accent/25"
                  >
                    {t("Add")}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {connections.length === 0 ? (
          <div className="px-2 py-6 text-center text-[11px] text-ink-3">
            <Database className="mx-auto mb-2 h-6 w-6 opacity-50" />
            <p>{t("No database connections yet.")}</p>
            <button
              type="button"
              onClick={() => openModal(null)}
              className="mt-2.5 rounded border border-line bg-raised px-3 py-1 text-[11px] text-ink hover:bg-hover"
            >
              {t("Add Connection")}
            </button>
          </div>
        ) : (
          <div className="space-y-1">
            {connections.map((conn) => {
              const isExpanded = Boolean(expandedConn[conn.id]);
              const isActive = activeConnectionId === conn.id;
              const schema = schemas[conn.id];
              const isBusy = connectingId === conn.id;

              return (
                <div key={conn.id} className="rounded">
                  <div
                    onClick={() => void handleToggleConnection(conn)}
                    className={cn(
                      "group flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1.5 hover:bg-hover",
                      isActive && "bg-selected/60"
                    )}
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                    )}
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        conn.connected ? "bg-emerald-400" : "bg-ink-3/40"
                      )}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium text-ink">{conn.name}</span>
                    <span className="rounded bg-raised px-1 py-0.5 text-[9px] font-mono text-ink-2">
                      {ENGINE_LABEL[conn.engine]}
                    </span>
                    <span className={cn("rounded border px-1 py-0.5 text-[9px] font-semibold uppercase", ENV_BADGE[conn.environment])}>
                      {conn.environment}
                    </span>
                    {conn.readOnly && <Lock className="h-3 w-3 shrink-0 text-amber-400" />}
                  </div>

                  <div className="flex items-center justify-end gap-1 px-2 pb-1 text-[10px] text-ink-3">
                    <button
                      type="button"
                      title={t("SQL Console")}
                      onClick={() => {
                        selectConnection(conn.id);
                        setSubView(conn.engine === "redis" ? "redis" : "console");
                        useEditor.getState().openDatabase();
                      }}
                      className="rounded p-0.5 hover:bg-hover hover:text-ink"
                    >
                      <Play className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title={t("Schema Security Audit")}
                      onClick={() => {
                        useEditor.getState().openDatabase();
                        void runAudit(conn.id);
                      }}
                      className="rounded p-0.5 hover:bg-hover hover:text-ink"
                    >
                      <ShieldAlert className="h-3 w-3" />
                    </button>
                    {conn.connected ? (
                      <button
                        type="button"
                        title={t("Disconnect")}
                        onClick={() => void disconnectConnection(conn.id)}
                        className="rounded p-0.5 hover:bg-hover hover:text-ink"
                      >
                        <Unplug className="h-3 w-3" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        title={t("Connect")}
                        onClick={() => void connectAndLoadSchema(conn.id)}
                        className="rounded p-0.5 hover:bg-hover hover:text-ink"
                      >
                        <Plug className="h-3 w-3" />
                      </button>
                    )}
                    <button
                      type="button"
                      title={t("Edit")}
                      onClick={() => openModal(conn)}
                      className="rounded p-0.5 hover:bg-hover hover:text-ink"
                    >
                      <Edit3 className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      title={t("Delete")}
                      onClick={() => void deleteConnection(conn.id)}
                      className="rounded p-0.5 hover:bg-hover hover:text-rose-400"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>

                  {isExpanded && (
                    <div className="ml-4 border-l border-line/70 pl-2 pb-1">
                      {isBusy && !schema && (
                        <div className="py-1 text-[11px] text-ink-3">{t("Loading schema...")}</div>
                      )}

                      {schema && conn.engine === "redis" && (
                        <div className="space-y-1 py-1 text-[11px]">
                          <div className="text-ink-2">
                            Keys: <span className="font-mono text-ink">{schema.dbSize ?? 0}</span>
                          </div>
                          {(schema.keyPrefixes || []).map((kp) => (
                            <button
                              key={kp.prefix}
                              type="button"
                              onClick={() => {
                                selectConnection(conn.id);
                                setSubView("redis");
                                useEditor.getState().openDatabase();
                                void useDatabase.getState().redisScan("0", kp.prefix === "(root)" ? "*" : kp.prefix);
                              }}
                              className="flex w-full items-center justify-between rounded px-1.5 py-0.5 text-left text-ink-2 hover:bg-hover hover:text-ink"
                            >
                              <span className="truncate font-mono">{kp.prefix}</span>
                              <span className="text-[10px] text-ink-3">{kp.count}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {schema && conn.engine !== "redis" && (
                        <div className="space-y-1">
                          {schema.tables.map((tbl) => {
                            const tblKey = `${conn.id}:${tbl.schema}.${tbl.name}`;
                            const tblExpanded = Boolean(expandedTables[tblKey]);
                            return (
                              <div key={tblKey}>
                                <div
                                  onClick={() => setExpandedTables((prev) => ({ ...prev, [tblKey]: !tblExpanded }))}
                                  onDoubleClick={() => {
                                    useEditor.getState().openDatabase();
                                    void openTableGrid(conn.id, tbl.schema, tbl.name);
                                  }}
                                  onContextMenu={(e) => handleContextMenu(e, conn, tbl)}
                                  className="flex cursor-pointer items-center justify-between gap-1 rounded px-1.5 py-1 text-[11px] hover:bg-hover"
                                >
                                  <div className="flex min-w-0 items-center gap-1.5">
                                    {tblExpanded ? (
                                      <ChevronDown className="h-3 w-3 shrink-0 text-ink-3" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3 shrink-0 text-ink-3" />
                                    )}
                                    <Table2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                                    <span className="truncate text-ink">{tbl.name}</span>
                                  </div>
                                  {tbl.rowCount !== undefined && (
                                    <span className="shrink-0 font-mono text-[10px] text-ink-3">{tbl.rowCount}</span>
                                  )}
                                </div>

                                {tblExpanded && (
                                  <div className="ml-4 space-y-0.5 border-l border-line/50 pl-2 py-0.5">
                                    {tbl.columns.map((col) => {
                                      const isFk = schema.foreignKeys.some(
                                        (fk) => fk.fromTable === tbl.name && fk.fromColumn === col.name
                                      );
                                      return (
                                        <div key={col.name} className="flex items-center justify-between gap-1 py-0.5 text-[10px]">
                                          <div className="flex min-w-0 items-center gap-1">
                                            {col.primaryKey && <KeyRound className="h-2.5 w-2.5 shrink-0 text-amber-400" />}
                                            {isFk && <Link2 className="h-2.5 w-2.5 shrink-0 text-sky-400" />}
                                            <span className="truncate text-ink-2">{col.name}</span>
                                          </div>
                                          <span className="shrink-0 font-mono text-[9px] text-ink-3">{col.dataType}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            );
                          })}

                          {schema.views.length > 0 && (
                            <div className="pt-1">
                              <div className="px-1.5 text-[10px] font-semibold uppercase text-ink-3">{t("Views")}</div>
                              {schema.views.map((v) => (
                                <div
                                  key={`${v.schema}.${v.name}`}
                                  onClick={() => {
                                    useEditor.getState().openDatabase();
                                    void openTableGrid(conn.id, v.schema, v.name);
                                  }}
                                  className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-[11px] text-ink-2 hover:bg-hover hover:text-ink"
                                >
                                  <Eye className="h-3 w-3 text-ink-3" />
                                  <span className="truncate">{v.name}</span>
                                </div>
                              ))}
                            </div>
                          )}

                          {schema.indexes.length > 0 && (
                            <div className="px-1.5 pt-1 text-[10px] text-ink-3">
                              {t("Indexes")}: {schema.indexes.length} · {t("Triggers")}: {schema.triggers.length}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {contextMenu && (
        <div
          style={{ left: contextMenu.x, top: contextMenu.y }}
          className="fixed z-50 min-w-[180px] rounded border border-line bg-surface py-1 text-[11px] shadow-xl"
        >
          <button
            type="button"
            onClick={() => {
              useEditor.getState().openDatabase();
              void openTableGrid(contextMenu.conn.id, contextMenu.table.schema, contextMenu.table.name);
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-hover"
          >
            <Table2 className="h-3.5 w-3.5" />
            <span>{t("Browse Data Grid")}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              const q = contextMenu.conn.engine === "mysql" ? `\`${contextMenu.table.name}\`` : `"${contextMenu.table.name}"`;
              selectConnection(contextMenu.conn.id);
              setSubView("console");
              setQueryText(`SELECT * FROM ${q} LIMIT 100;`);
              useEditor.getState().openDatabase();
              void useDatabase.getState().runQuery({ sql: `SELECT * FROM ${q} LIMIT 100;` });
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-hover"
          >
            <Play className="h-3.5 w-3.5" />
            <span>{t("Select Top 100")}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleExportTable(contextMenu.conn, contextMenu.table, "csv")}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-hover"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t("Export CSV")}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleExportTable(contextMenu.conn, contextMenu.table, "json")}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-hover"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t("Export JSON")}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleExportTable(contextMenu.conn, contextMenu.table, "sql")}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink hover:bg-hover"
          >
            <Download className="h-3.5 w-3.5" />
            <span>{t("Export SQL Inserts")}</span>
          </button>
          <div className="my-1 border-t border-line" />
          <button
            type="button"
            onClick={() => void handleSendTableToAi(contextMenu.conn, contextMenu.table)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-accent hover:bg-hover"
          >
            <Sparkles className="h-3.5 w-3.5" />
            <span>{t("Send Schema to AI")}</span>
          </button>
        </div>
      )}

      <DatabaseConnectionModal />
    </div>
  );
}
