import { create } from "zustand";
import {
  bridge,
  type DbAuditFinding,
  type DbAuditSummary,
  type DbConnectionSummary,
  type DbDangerInfo,
  type DbDiscoveredSource,
  type DbEngine,
  type DbQueryResult,
  type DbRedisKeyItem,
  type DbRowChange,
  type DbSaveInput,
  type DbSavedQuery,
  type DbSchemaSnapshot,
  type DbTableMeta,
} from "@/lib/bridge";
import { useWorkspace } from "@/stores/workspace";
import { toast } from "@/stores/toast";

export type DbSubView = "console" | "grid" | "diagram" | "audit" | "redis";

export interface DbQueryHistoryEntry {
  id: string;
  connectionId: string;
  sql: string;
  durationMs: number;
  rowCount: number;
  error?: string;
  ranAt: number;
}

export interface PendingRowEdit {
  key: Record<string, unknown>;
  original: Record<string, unknown>;
  updates: Record<string, unknown>;
}

export function buildRowKeySignature(row: Record<string, unknown>, pkCols: string[]): { sig: string; key: Record<string, unknown> } | null {
  if (pkCols.length === 0) return null;
  const key: Record<string, unknown> = {};
  for (const col of pkCols) {
    if (!(col in row)) return null;
    key[col] = row[col];
  }
  return { sig: JSON.stringify(pkCols.map((c) => row[c])), key };
}

function sqlLiteralPreview(val: unknown): string {
  if (val === null || val === undefined) return "NULL";
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function quoteIdentPreview(engine: DbEngine, ident: string): string {
  return engine === "mysql" ? `\`${ident.replace(/`/g, "``")}\`` : `"${ident.replace(/"/g, '""')}"`;
}

export function generateSqlDiffPreview(engine: DbEngine, schemaName: string, tableName: string, changes: DbRowChange[]): string[] {
  const qualified = schemaName && (engine === "postgres" || engine === "mysql")
    ? `${quoteIdentPreview(engine, schemaName)}.${quoteIdentPreview(engine, tableName)}`
    : quoteIdentPreview(engine, tableName);

  return changes.map((c) => {
    if (c.kind === "insert") {
      const entries = Object.entries(c.values);
      const cols = entries.map(([k]) => quoteIdentPreview(engine, k)).join(", ");
      const vals = entries.map(([, v]) => sqlLiteralPreview(v)).join(", ");
      return `INSERT INTO ${qualified} (${cols}) VALUES (${vals});`;
    }
    if (c.kind === "update") {
      const setClause = Object.entries(c.set)
        .map(([k, v]) => `${quoteIdentPreview(engine, k)} = ${sqlLiteralPreview(v)}`)
        .join(", ");
      const whereClause = Object.entries(c.key)
        .map(([k, v]) => (v === null ? `${quoteIdentPreview(engine, k)} IS NULL` : `${quoteIdentPreview(engine, k)} = ${sqlLiteralPreview(v)}`))
        .join(" AND ");
      return `UPDATE ${qualified} SET ${setClause} WHERE ${whereClause};`;
    }
    const whereClause = Object.entries(c.key)
      .map(([k, v]) => (v === null ? `${quoteIdentPreview(engine, k)} IS NULL` : `${quoteIdentPreview(engine, k)} = ${sqlLiteralPreview(v)}`))
      .join(" AND ");
    return `DELETE FROM ${qualified} WHERE ${whereClause};`;
  });
}

interface DatabaseState {
  connections: DbConnectionSummary[];
  discovered: DbDiscoveredSource[];
  schemas: Record<string, DbSchemaSnapshot>;
  loadingConnections: boolean;
  connectingId: string | null;

  activeConnectionId: string | null;
  selectedTable: { schema: string; table: string } | null;
  subView: DbSubView;

  modalOpen: boolean;
  editingConnection: DbConnectionSummary | null;
  modalPrefill: Partial<DbSaveInput> | null;

  queryText: string;
  queryResult: DbQueryResult | null;
  queryError: string | null;
  queryRunning: boolean;
  dangerousPrompt: { connectionId: string; sql: string; info: DbDangerInfo } | null;
  history: DbQueryHistoryEntry[];
  savedQueries: DbSavedQuery[];

  gridPage: number;
  gridPageSize: number;
  gridSort: { column: string; dir: "ASC" | "DESC" } | null;
  gridFilter: string;
  gridResult: DbQueryResult | null;
  gridLoading: boolean;
  gridError: string | null;

  pendingEdits: Record<string, PendingRowEdit>;
  pendingDeletes: Record<string, Record<string, unknown>>;
  pendingInserts: Array<Record<string, unknown>>;
  applyingChanges: boolean;

  auditFindings: DbAuditFinding[];
  auditSummary: DbAuditSummary | null;
  auditLoading: boolean;

  redisPattern: string;
  redisCursor: string;
  redisItems: DbRedisKeyItem[];
  redisSelected: { key: string; type: string; ttl: number; value: unknown } | null;
  redisLoading: boolean;

  openModal(connection?: DbConnectionSummary | null, prefill?: Partial<DbSaveInput> | null): void;
  closeModal(): void;
  setSubView(view: DbSubView): void;
  setQueryText(sql: string): void;
  selectConnection(id: string | null): void;

  loadConnections(): Promise<void>;
  discoverWorkspace(root?: string | null): Promise<void>;
  saveConnection(input: DbSaveInput): Promise<DbConnectionSummary | null>;
  deleteConnection(id: string): Promise<boolean>;
  connectAndLoadSchema(id: string): Promise<DbSchemaSnapshot | null>;
  disconnectConnection(id: string): Promise<void>;

  openTableGrid(connectionId: string, schema: string, table: string): Promise<void>;
  refreshGrid(): Promise<void>;
  setGridPage(page: number): void;
  toggleGridSort(column: string): void;
  setGridFilter(filter: string): void;

  stageCellEdit(rowSig: string, key: Record<string, unknown>, original: Record<string, unknown>, column: string, value: unknown): void;
  stageRowDelete(rowSig: string, key: Record<string, unknown>): void;
  stageRowInsert(values: Record<string, unknown>): void;
  discardAllChanges(): void;
  getPendingChanges(): DbRowChange[];
  applyPendingChanges(): Promise<boolean>;

  runQuery(options?: { sql?: string; explain?: boolean; allowDangerous?: boolean }): Promise<void>;
  dismissDangerousPrompt(): void;
  loadSavedQueries(): Promise<void>;
  saveCurrentQuery(name: string): Promise<boolean>;

  runAudit(connectionId?: string): Promise<void>;

  redisScan(cursor?: string, pattern?: string): Promise<void>;
  redisInspectKey(key: string): Promise<void>;
  redisDeleteKey(key: string): Promise<void>;
}

const initialAudit: DbAuditSummary | null = null;

export const useDatabase = create<DatabaseState>((set, get) => ({
  connections: [],
  discovered: [],
  schemas: {},
  loadingConnections: false,
  connectingId: null,

  activeConnectionId: null,
  selectedTable: null,
  subView: "console",

  modalOpen: false,
  editingConnection: null,
  modalPrefill: null,

  queryText: "SELECT 1 AS status;",
  queryResult: null,
  queryError: null,
  queryRunning: false,
  dangerousPrompt: null,
  history: [],
  savedQueries: [],

  gridPage: 0,
  gridPageSize: 100,
  gridSort: null,
  gridFilter: "",
  gridResult: null,
  gridLoading: false,
  gridError: null,

  pendingEdits: {},
  pendingDeletes: {},
  pendingInserts: [],
  applyingChanges: false,

  auditFindings: [],
  auditSummary: initialAudit,
  auditLoading: false,

  redisPattern: "*",
  redisCursor: "0",
  redisItems: [],
  redisSelected: null,
  redisLoading: false,

  openModal: (connection = null, prefill = null) =>
    set({ modalOpen: true, editingConnection: connection, modalPrefill: prefill }),

  closeModal: () => set({ modalOpen: false, editingConnection: null, modalPrefill: null }),

  setSubView: (subView) => set({ subView }),

  setQueryText: (queryText) => set({ queryText }),

  selectConnection: (id) => {
    const conn = get().connections.find((c) => c.id === id);
    const nextSubView: DbSubView =
      conn?.engine === "redis"
        ? "redis"
        : get().subView === "redis"
          ? "console"
          : get().subView;
    set({ activeConnectionId: id, subView: nextSubView });
  },

  loadConnections: async () => {
    set({ loadingConnections: true });
    try {
      const res = await bridge.dbList();
      if (res.ok && Array.isArray(res.connections)) {
        const current = get().activeConnectionId;
        const stillExists = res.connections.some((c) => c.id === current);
        set({
          connections: res.connections,
          activeConnectionId: stillExists ? current : res.connections[0]?.id ?? null,
        });
      }
    } finally {
      set({ loadingConnections: false });
    }
  },

  discoverWorkspace: async (explicitRoot) => {
    const root = explicitRoot ?? useWorkspace.getState().root;
    if (!root) {
      set({ discovered: [] });
      return;
    }
    const res = await bridge.dbDiscover(root);
    if (res.ok && Array.isArray(res.items)) {
      set({ discovered: res.items });
    }
  },

  saveConnection: async (input) => {
    const res = await bridge.dbSave(input);
    if (!res.ok || !res.connection) {
      toast.error(res.error || "Failed to save database connection.");
      return null;
    }
    await get().loadConnections();
    set({ activeConnectionId: res.connection.id, modalOpen: false, editingConnection: null, modalPrefill: null });
    toast.success(`Saved database connection "${res.connection.name}".`);
    return res.connection;
  },

  deleteConnection: async (id) => {
    const res = await bridge.dbDelete(id);
    if (!res.ok) {
      toast.error(res.error || "Failed to delete connection.");
      return false;
    }
    set((state) => {
      const nextSchemas = { ...state.schemas };
      delete nextSchemas[id];
      return {
        schemas: nextSchemas,
        activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
      };
    });
    await get().loadConnections();
    return true;
  },

  connectAndLoadSchema: async (id) => {
    set({ connectingId: id });
    try {
      const res = await bridge.dbSchema(id, { refresh: true });
      if (!res.ok || !res.schema) {
        toast.error(res.error || "Could not load database schema.");
        return null;
      }
      set((state) => ({
        schemas: { ...state.schemas, [id]: res.schema! },
        activeConnectionId: id,
        subView: res.schema!.engine === "redis" ? "redis" : state.subView === "redis" ? "console" : state.subView,
      }));
      await get().loadConnections();
      if (res.schema.engine === "redis") {
        void get().redisScan("0", get().redisPattern);
      }
      return res.schema;
    } finally {
      set({ connectingId: null });
    }
  },

  disconnectConnection: async (id) => {
    await bridge.dbDisconnect(id);
    await get().loadConnections();
  },

  openTableGrid: async (connectionId, schema, table) => {
    set({
      activeConnectionId: connectionId,
      selectedTable: { schema, table },
      subView: "grid",
      gridPage: 0,
      gridSort: null,
      gridFilter: "",
      pendingEdits: {},
      pendingDeletes: {},
      pendingInserts: [],
    });
    await get().refreshGrid();
  },

  refreshGrid: async () => {
    const { activeConnectionId, selectedTable, connections, gridPage, gridPageSize, gridSort, gridFilter, schemas } = get();
    if (!activeConnectionId || !selectedTable) return;
    const conn = connections.find((c) => c.id === activeConnectionId);
    if (!conn || conn.engine === "redis") return;

    const qual =
      selectedTable.schema && (conn.engine === "postgres" || conn.engine === "mysql")
        ? `${quoteIdentPreview(conn.engine, selectedTable.schema)}.${quoteIdentPreview(conn.engine, selectedTable.table)}`
        : quoteIdentPreview(conn.engine, selectedTable.table);

    let where = "";
    const trimmedFilter = gridFilter.trim();
    if (trimmedFilter) {
      const schemaObj = schemas[activeConnectionId];
      const tblMeta: DbTableMeta | undefined = schemaObj?.tables.find(
        (t) => t.name === selectedTable.table && t.schema === selectedTable.schema
      );
      const cols = (tblMeta?.columns || []).slice(0, 12);
      if (cols.length > 0) {
        const escaped = trimmedFilter.replace(/'/g, "''");
        const conds = cols.map((c) => `CAST(${quoteIdentPreview(conn.engine, c.name)} AS TEXT) LIKE '%${escaped}%'`);
        const mysqlConds = cols.map((c) => `CAST(${quoteIdentPreview("mysql", c.name)} AS CHAR) LIKE '%${escaped}%'`);
        where = ` WHERE ${(conn.engine === "mysql" ? mysqlConds : conds).join(" OR ")}`;
      }
    }

    const order = gridSort
      ? ` ORDER BY ${quoteIdentPreview(conn.engine, gridSort.column)} ${gridSort.dir}`
      : "";
    const offset = Math.max(0, gridPage * gridPageSize);
    const sql = `SELECT * FROM ${qual}${where}${order} LIMIT ${gridPageSize} OFFSET ${offset}`;

    set({ gridLoading: true, gridError: null });
    try {
      const res = await bridge.dbQuery(activeConnectionId, sql, { noAutoLimit: true });
      if (!res.ok || !res.result) {
        set({ gridError: res.error || "Failed to load table rows." });
        return;
      }
      set({ gridResult: res.result });
    } finally {
      set({ gridLoading: false });
    }
  },

  setGridPage: (page) => {
    set({ gridPage: Math.max(0, page) });
    void get().refreshGrid();
  },

  toggleGridSort: (column) => {
    const cur = get().gridSort;
    const next =
      cur && cur.column === column
        ? cur.dir === "ASC"
          ? { column, dir: "DESC" as const }
          : null
        : { column, dir: "ASC" as const };
    set({ gridSort: next, gridPage: 0 });
    void get().refreshGrid();
  },

  setGridFilter: (gridFilter) => {
    set({ gridFilter, gridPage: 0 });
  },

  stageCellEdit: (rowSig, key, original, column, value) =>
    set((state) => {
      const next = { ...state.pendingEdits };
      const existing = next[rowSig] ? { ...next[rowSig], updates: { ...next[rowSig].updates } } : { key, original, updates: {} as Record<string, unknown> };
      if (original[column] === value) {
        delete existing.updates[column];
      } else {
        existing.updates[column] = value;
      }
      if (Object.keys(existing.updates).length === 0) delete next[rowSig];
      else next[rowSig] = existing;
      return { pendingEdits: next };
    }),

  stageRowDelete: (rowSig, key) =>
    set((state) => {
      const next = { ...state.pendingDeletes };
      if (next[rowSig]) delete next[rowSig];
      else next[rowSig] = key;
      return { pendingDeletes: next };
    }),

  stageRowInsert: (values) =>
    set((state) => ({ pendingInserts: [...state.pendingInserts, values] })),

  discardAllChanges: () => set({ pendingEdits: {}, pendingDeletes: {}, pendingInserts: [] }),

  getPendingChanges: () => {
    const { selectedTable, pendingEdits, pendingDeletes, pendingInserts } = get();
    if (!selectedTable) return [];
    const changes: DbRowChange[] = [];
    for (const values of pendingInserts) {
      changes.push({ kind: "insert", schema: selectedTable.schema, table: selectedTable.table, values });
    }
    for (const [sig, edit] of Object.entries(pendingEdits)) {
      if (pendingDeletes[sig]) continue;
      if (Object.keys(edit.updates).length > 0) {
        changes.push({
          kind: "update",
          schema: selectedTable.schema,
          table: selectedTable.table,
          key: edit.key,
          set: edit.updates,
        });
      }
    }
    for (const key of Object.values(pendingDeletes)) {
      changes.push({ kind: "delete", schema: selectedTable.schema, table: selectedTable.table, key });
    }
    return changes;
  },

  applyPendingChanges: async () => {
    const { activeConnectionId } = get();
    if (!activeConnectionId) return false;
    const changes = get().getPendingChanges();
    if (changes.length === 0) return false;
    set({ applyingChanges: true });
    try {
      const res = await bridge.dbApplyChanges(activeConnectionId, changes);
      if (!res.ok) {
        toast.error(res.error || "Failed to apply transaction.");
        return false;
      }
      toast.success(`Committed ${changes.length} change(s) inside transaction.`);
      set({ pendingEdits: {}, pendingDeletes: {}, pendingInserts: [] });
      await get().refreshGrid();
      void get().connectAndLoadSchema(activeConnectionId);
      return true;
    } finally {
      set({ applyingChanges: false });
    }
  },

  runQuery: async (options = {}) => {
    const { activeConnectionId, queryText } = get();
    if (!activeConnectionId) {
      toast.error("Select a database connection first.");
      return;
    }
    const sql = (options.sql ?? queryText).trim();
    if (!sql) return;

    set({ queryRunning: true, queryError: null, dangerousPrompt: null });
    try {
      const res = await bridge.dbQuery(activeConnectionId, sql, {
        explain: options.explain,
        allowDangerous: options.allowDangerous,
      });
      if (!res.ok) {
        if (res.dangerous) {
          set({ dangerousPrompt: { connectionId: activeConnectionId, sql, info: res.dangerous } });
          return;
        }
        set({ queryError: res.error || "Query failed." });
        return;
      }
      if (res.result) {
        set((state) => ({
          queryResult: res.result!,
          queryError: null,
          history: [
            {
              id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
              connectionId: activeConnectionId,
              sql,
              durationMs: res.result!.durationMs,
              rowCount: res.result!.rowCount,
              ranAt: Date.now(),
            },
            ...state.history.slice(0, 49),
          ],
        }));
      }
    } finally {
      set({ queryRunning: false });
    }
  },

  dismissDangerousPrompt: () => set({ dangerousPrompt: null }),

  loadSavedQueries: async () => {
    const root = useWorkspace.getState().root;
    if (!root) {
      set({ savedQueries: [] });
      return;
    }
    const res = await bridge.dbListSavedQueries(root);
    if (res.ok && Array.isArray(res.queries)) {
      set({ savedQueries: res.queries });
    }
  },

  saveCurrentQuery: async (name) => {
    const root = useWorkspace.getState().root;
    if (!root) {
      toast.error("Open a workspace folder to save queries to .wide/queries.");
      return false;
    }
    const res = await bridge.dbSaveQuery(root, name, get().queryText);
    if (!res.ok) {
      toast.error(res.error || "Failed to save query.");
      return false;
    }
    toast.success(`Saved .wide/queries/${res.name}.sql`);
    await get().loadSavedQueries();
    return true;
  },

  runAudit: async (explicitId) => {
    const id = explicitId ?? get().activeConnectionId;
    if (!id) return;
    set({ auditLoading: true, activeConnectionId: id, subView: "audit" });
    try {
      const res = await bridge.dbAudit(id);
      if (!res.ok) {
        toast.error(res.error || "Security audit failed.");
        return;
      }
      set({ auditFindings: res.findings || [], auditSummary: res.summary || null });
    } finally {
      set({ auditLoading: false });
    }
  },

  redisScan: async (cursor = "0", pattern) => {
    const id = get().activeConnectionId;
    if (!id) return;
    const pat = pattern ?? get().redisPattern;
    set({ redisLoading: true, redisPattern: pat });
    try {
      const res = await bridge.dbRedisCommand(id, "scan", { cursor, pattern: pat, count: 100 });
      if (!res.ok) {
        toast.error(res.error || "Redis SCAN failed.");
        return;
      }
      set({
        redisCursor: res.cursor || "0",
        redisItems: res.items || [],
      });
    } finally {
      set({ redisLoading: false });
    }
  },

  redisInspectKey: async (key) => {
    const id = get().activeConnectionId;
    if (!id) return;
    const res = await bridge.dbRedisCommand(id, "get", { key });
    if (!res.ok) {
      toast.error(res.error || "Failed to read key.");
      return;
    }
    set({
      redisSelected: {
        key: res.key || key,
        type: res.type || "string",
        ttl: res.ttl ?? -1,
        value: res.value,
      },
    });
  },

  redisDeleteKey: async (key) => {
    const id = get().activeConnectionId;
    if (!id) return;
    const res = await bridge.dbRedisCommand(id, "del", { key });
    if (!res.ok) {
      toast.error(res.error || "Failed to delete Redis key.");
      return;
    }
    toast.success(`Deleted Redis key "${key}".`);
    set({ redisSelected: null });
    await get().redisScan("0", get().redisPattern);
  },
}));
