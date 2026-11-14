import { autocompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { PostgreSQL, MySQL, SQLite, StandardSQL, sql } from "@codemirror/lang-sql";
import { bracketMatching, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Braces,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  FileCode2,
  GitFork,
  History,
  KeyRound,
  Link2,
  Lock,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  Sparkles,
  Table2,
  Terminal,
  Trash2,
  Wand2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { format as formatSql } from "sql-formatter";

import { codeHighlight, editorTheme } from "@/editor/theme";
import { bridge, type DbAuditFinding, type DbConnectionSummary, type DbEngine, type DbQueryResult, type DbSchemaSnapshot } from "@/lib/bridge";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useAi } from "@/stores/ai";
import { buildRowKeySignature, generateSqlDiffPreview, useDatabase, type DbSubView } from "@/stores/database";
import { useDecoder } from "@/stores/decoder";
import { useEditor } from "@/stores/editor";
import { toast } from "@/stores/toast";
import { useWorkspace } from "@/stores/workspace";

const JWT_RE = /^eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}(?:\.[A-Za-z0-9_-]*)?$/;

function dialectFor(engine?: DbEngine) {
  if (engine === "postgres") return PostgreSQL;
  if (engine === "mysql") return MySQL;
  if (engine === "sqlite") return SQLite;
  return StandardSQL;
}

function formatterLanguageFor(engine?: DbEngine): "sqlite" | "postgresql" | "mysql" | "sql" {
  if (engine === "postgres") return "postgresql";
  if (engine === "mysql") return "mysql";
  if (engine === "sqlite") return "sqlite";
  return "sql";
}

function buildCodeMirrorSchema(snapshot?: DbSchemaSnapshot) {
  if (!snapshot || snapshot.engine === "redis") return {};
  const map: Record<string, string[]> = {};
  for (const tbl of snapshot.tables) {
    map[tbl.name] = tbl.columns.map((c) => c.name);
    if (tbl.schema && tbl.schema !== "main") {
      map[`${tbl.schema}.${tbl.name}`] = tbl.columns.map((c) => c.name);
    }
  }
  for (const v of snapshot.views) {
    map[v.name] = v.columns.map((c) => c.name);
  }
  return map;
}

function formatCellDisplay(value: unknown): string {
  if (value === null) return "NULL";
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  return String(value);
}

function tryPrettyJson(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}")) && !(trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return null;
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return null;
  }
}

function CellInspectorDrawer({
  cell,
  onClose,
}: {
  cell: { column: string; value: unknown } | null;
  onClose: () => void;
}) {
  const t = useT();
  if (!cell) return null;
  const str = cell.value === null || cell.value === undefined ? "" : String(cell.value);
  const prettyJson = tryPrettyJson(cell.value);
  const isJwt = JWT_RE.test(str.trim());

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(prettyJson ?? str);
      toast.success(t("Copied cell value."));
    } catch {
      void 0;
    }
  };

  return (
    <div className="flex w-80 shrink-0 flex-col border-l border-line bg-surface">
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[12px] font-medium text-ink">
          <Braces className="h-3.5 w-3.5 shrink-0 text-accent" />
          <span className="truncate">{cell.column}</span>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-hover hover:text-ink">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex items-center gap-1.5 border-b border-line px-3 py-1.5 text-[11px]">
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 text-ink hover:bg-hover"
        >
          <Copy className="h-3 w-3" />
          <span>{t("Copy")}</span>
        </button>
        {(isJwt || str.length > 0) && (
          <button
            type="button"
            onClick={() => useDecoder.getState().openDecoder(str)}
            className="flex items-center gap-1 rounded border border-accent/40 bg-accent/15 px-2 py-1 text-accent hover:bg-accent/25"
          >
            <KeyRound className="h-3 w-3" />
            <span>{isJwt ? t("Decode JWT") : t("Open in Decoder")}</span>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {cell.value === null ? (
          <span className="font-mono text-[12px] italic text-ink-3">NULL</span>
        ) : (
          <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-ink">
            {prettyJson ?? str}
          </pre>
        )}
      </div>
    </div>
  );
}

function SqlEditorPane({
  value,
  engine,
  schema,
  onChange,
  onRun,
}: {
  value: string;
  engine?: DbEngine;
  schema?: DbSchemaSnapshot;
  onChange: (next: string) => void;
  onRun: () => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const langComp = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  onChangeRef.current = onChange;
  onRunRef.current = onRun;

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;

    const runShortcut = Prec.highest(
      keymap.of([
        {
          key: "Mod-Enter",
          run: () => {
            onRunRef.current();
            return true;
          },
        },
      ])
    );

    const state = EditorState.create({
      doc: value,
      extensions: [
        runShortcut,
        lineNumbers(),
        history(),
        bracketMatching(),
        autocompletion(),
        editorTheme,
        syntaxHighlighting(codeHighlight),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        langComp.current.of(
          sql({
            dialect: dialectFor(engine),
            schema: buildCodeMirrorSchema(schema),
            upperCaseKeywords: true,
          })
        ),
        EditorView.updateListener.of((upd) => {
          if (upd.docChanged) {
            onChangeRef.current(upd.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: holder });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langComp.current.reconfigure(
        sql({
          dialect: dialectFor(engine),
          schema: buildCodeMirrorSchema(schema),
          upperCaseKeywords: true,
        })
      ),
    });
  }, [engine, schema]);

  return <div ref={holderRef} className="h-full min-h-[140px] w-full overflow-hidden bg-canvas" />;
}

function ResultTable({
  result,
  onSelectCell,
}: {
  result: DbQueryResult;
  onSelectCell: (cell: { column: string; value: unknown }) => void;
}) {
  if (result.columns.length === 0) {
    return (
      <div className="p-4 text-[12px] text-ink-2">
        Query executed successfully. Affected rows: <span className="font-mono font-semibold text-ink">{result.affectedRows ?? 0}</span> ({result.durationMs}ms)
      </div>
    );
  }
  return (
    <table className="w-full border-collapse text-left font-mono text-[11px]">
      <thead className="sticky top-0 z-10 bg-surface">
        <tr>
          <th className="border-b border-r border-line px-2 py-1.5 text-[10px] font-medium text-ink-3">#</th>
          {result.columns.map((col) => (
            <th key={col.name} className="border-b border-r border-line px-2.5 py-1.5 font-semibold text-ink">
              {col.name}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.rows.map((row, rIdx) => (
          <tr key={rIdx} className="hover:bg-hover/60">
            <td className="border-b border-r border-line px-2 py-1 text-[10px] text-ink-3">{rIdx + 1}</td>
            {result.columns.map((col) => {
              const val = row[col.name];
              return (
                <td
                  key={col.name}
                  onClick={() => onSelectCell({ column: col.name, value: val })}
                  className={cn(
                    "max-w-[320px] cursor-pointer truncate border-b border-r border-line px-2.5 py-1",
                    val === null ? "italic text-ink-3" : "text-ink"
                  )}
                >
                  {formatCellDisplay(val)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SqlConsoleSubView({ activeConn, schema }: { activeConn?: DbConnectionSummary; schema?: DbSchemaSnapshot }) {
  const t = useT();
  const root = useWorkspace((s) => s.root);
  const queryText = useDatabase((s) => s.queryText);
  const queryResult = useDatabase((s) => s.queryResult);
  const queryError = useDatabase((s) => s.queryError);
  const queryRunning = useDatabase((s) => s.queryRunning);
  const dangerousPrompt = useDatabase((s) => s.dangerousPrompt);
  const history = useDatabase((s) => s.history);
  const savedQueries = useDatabase((s) => s.savedQueries);

  const setQueryText = useDatabase((s) => s.setQueryText);
  const runQuery = useDatabase((s) => s.runQuery);
  const dismissDangerousPrompt = useDatabase((s) => s.dismissDangerousPrompt);
  const loadSavedQueries = useDatabase((s) => s.loadSavedQueries);
  const saveCurrentQuery = useDatabase((s) => s.saveCurrentQuery);

  const [inspectedCell, setInspectedCell] = useState<{ column: string; value: unknown } | null>(null);
  const [showSidebar, setShowSidebar] = useState<"history" | "saved" | null>(null);
  const [saveName, setSaveName] = useState("");
  const [showSaveBox, setShowSaveBox] = useState(false);

  useEffect(() => {
    void loadSavedQueries();
  }, [root, loadSavedQueries]);

  const handleFormat = () => {
    try {
      const formatted = formatSql(queryText, {
        language: formatterLanguageFor(activeConn?.engine),
        keywordCase: "upper",
      });
      setQueryText(formatted);
    } catch {
      toast.error(t("Could not format SQL query."));
    }
  };

  const handleExportResult = async (fmt: "csv" | "json" | "sql") => {
    if (!activeConn) return;
    const res = await bridge.dbExport(activeConn.id, { format: fmt, sql: queryText });
    if (!res.ok || res.content === undefined) {
      toast.error(res.error || "Export failed.");
      return;
    }
    try {
      await navigator.clipboard.writeText(res.content);
      toast.success(`Copied ${res.rowCount ?? 0} row(s) as ${fmt.toUpperCase()}.`);
    } catch {
      void 0;
    }
  };

  const handleSave = async () => {
    if (!saveName.trim()) return;
    const ok = await saveCurrentQuery(saveName.trim());
    if (ok) {
      setShowSaveBox(false);
      setSaveName("");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={!activeConn || queryRunning}
            onClick={() => void runQuery()}
            className="flex items-center gap-1 rounded bg-accent px-2.5 py-1 font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            <Play className="h-3 w-3" />
            <span>{queryRunning ? t("Running...") : t("Run")}</span>
            <span className="ml-1 text-[10px] opacity-75">Ctrl+↵</span>
          </button>
          <button
            type="button"
            disabled={!activeConn || queryRunning}
            onClick={() => void runQuery({ explain: true })}
            className="flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 text-ink-2 hover:bg-hover hover:text-ink disabled:opacity-40"
          >
            <Search className="h-3 w-3" />
            <span>EXPLAIN</span>
          </button>
          <button
            type="button"
            onClick={handleFormat}
            className="flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Wand2 className="h-3 w-3" />
            <span>{t("Format")}</span>
          </button>
          {root && (
            <button
              type="button"
              onClick={() => setShowSaveBox((v) => !v)}
              className="flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 text-ink-2 hover:bg-hover hover:text-ink"
            >
              <Save className="h-3 w-3" />
              <span>{t("Save Query")}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {queryResult && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void handleExportResult("csv")}
                className="rounded border border-line bg-raised px-2 py-1 text-[10px] text-ink-2 hover:text-ink"
              >
                CSV
              </button>
              <button
                type="button"
                onClick={() => void handleExportResult("json")}
                className="rounded border border-line bg-raised px-2 py-1 text-[10px] text-ink-2 hover:text-ink"
              >
                JSON
              </button>
              <button
                type="button"
                onClick={() => void handleExportResult("sql")}
                className="rounded border border-line bg-raised px-2 py-1 text-[10px] text-ink-2 hover:text-ink"
              >
                SQL
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => setShowSidebar((s) => (s === "saved" ? null : "saved"))}
            className={cn(
              "flex items-center gap-1 rounded border px-2 py-1",
              showSidebar === "saved" ? "border-accent bg-accent/15 text-accent" : "border-line bg-raised text-ink-2 hover:text-ink"
            )}
          >
            <FileCode2 className="h-3 w-3" />
            <span>{t("Saved")} ({savedQueries.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setShowSidebar((s) => (s === "history" ? null : "history"))}
            className={cn(
              "flex items-center gap-1 rounded border px-2 py-1",
              showSidebar === "history" ? "border-accent bg-accent/15 text-accent" : "border-line bg-raised text-ink-2 hover:text-ink"
            )}
          >
            <History className="h-3 w-3" />
            <span>{t("History")} ({history.length})</span>
          </button>
        </div>
      </div>

      {showSaveBox && (
        <div className="flex items-center gap-2 border-b border-line bg-raised px-3 py-1.5 text-[11px]">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="users-active-check"
            onKeyDown={(e) => e.key === "Enter" && void handleSave()}
            className="w-60 rounded border border-line bg-input px-2 py-1 font-mono text-ink outline-none focus:border-accent"
          />
          <button type="button" onClick={() => void handleSave()} className="rounded bg-accent px-2.5 py-1 text-white">
            {t("Save to .wide/queries")}
          </button>
          <button type="button" onClick={() => setShowSaveBox(false)} className="px-2 py-1 text-ink-3 hover:text-ink">
            {t("Cancel")}
          </button>
        </div>
      )}

      {dangerousPrompt && (
        <div className="flex items-center justify-between gap-3 border-b border-rose-500/40 bg-rose-500/15 px-3 py-2 text-[12px] text-rose-200">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400" />
            <div>
              <span className="font-semibold">{t("Dangerous SQL blocked for safety:")} </span>
              <span>{dangerousPrompt.info.reason}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={dismissDangerousPrompt}
              className="rounded border border-line bg-surface px-2.5 py-1 text-[11px] text-ink hover:bg-hover"
            >
              {t("Cancel")}
            </button>
            <button
              type="button"
              onClick={() => void runQuery({ sql: dangerousPrompt.sql, allowDangerous: true })}
              className="rounded bg-rose-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-rose-500"
            >
              {t("Execute Anyway")}
            </button>
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="h-48 shrink-0 border-b border-line">
            <SqlEditorPane
              value={queryText}
              engine={activeConn?.engine}
              schema={schema}
              onChange={setQueryText}
              onRun={() => void runQuery()}
            />
          </div>

          <div className="flex items-center justify-between border-b border-line bg-raised px-3 py-1 text-[11px] text-ink-2">
            <span>
              {queryResult
                ? `${queryResult.rowCount} row(s) · ${queryResult.durationMs}ms${queryResult.truncated ? ` (auto-limited to ${queryResult.appliedLimit})` : ""}`
                : t("Ready")}
            </span>
            {activeConn?.readOnly && (
              <span className="flex items-center gap-1 text-amber-400">
                <Lock className="h-3 w-3" />
                {t("Read-Only Lock Active")}
              </span>
            )}
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="min-w-0 flex-1 overflow-auto bg-canvas">
              {queryError ? (
                <div className="m-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 font-mono text-[11px] text-rose-300">
                  {queryError}
                </div>
              ) : queryResult ? (
                <ResultTable result={queryResult} onSelectCell={setInspectedCell} />
              ) : (
                <div className="p-6 text-center text-[12px] text-ink-3">
                  {t("Write a SQL statement above and press Run or Ctrl+Enter.")}
                </div>
              )}
            </div>
            <CellInspectorDrawer cell={inspectedCell} onClose={() => setInspectedCell(null)} />
          </div>
        </div>

        {showSidebar && (
          <div className="flex w-64 shrink-0 flex-col border-l border-line bg-surface text-[11px]">
            <div className="flex items-center justify-between border-b border-line px-3 py-2 font-semibold text-ink-2">
              <span>{showSidebar === "history" ? t("Query History") : t("Saved Queries")}</span>
              <button type="button" onClick={() => setShowSidebar(null)} className="text-ink-3 hover:text-ink">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
              {showSidebar === "history"
                ? history.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setQueryText(item.sql)}
                      className="w-full rounded border border-line/60 bg-raised p-2 text-left hover:border-accent"
                    >
                      <div className="line-clamp-2 font-mono text-[10px] text-ink">{item.sql}</div>
                      <div className="mt-1 flex justify-between text-[9px] text-ink-3">
                        <span>{item.rowCount} rows</span>
                        <span>{item.durationMs}ms</span>
                      </div>
                    </button>
                  ))
                : savedQueries.map((q) => (
                    <button
                      key={q.path}
                      type="button"
                      onClick={() => setQueryText(q.sql)}
                      className="w-full rounded border border-line/60 bg-raised p-2 text-left hover:border-accent"
                    >
                      <div className="font-medium text-ink">{q.name}.sql</div>
                      <div className="mt-0.5 line-clamp-2 font-mono text-[10px] text-ink-3">{q.sql}</div>
                    </button>
                  ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DataGridSubView({ activeConn, schema }: { activeConn?: DbConnectionSummary; schema?: DbSchemaSnapshot }) {
  const t = useT();
  const selectedTable = useDatabase((s) => s.selectedTable);
  const gridPage = useDatabase((s) => s.gridPage);
  const gridPageSize = useDatabase((s) => s.gridPageSize);
  const gridSort = useDatabase((s) => s.gridSort);
  const gridFilter = useDatabase((s) => s.gridFilter);
  const gridResult = useDatabase((s) => s.gridResult);
  const gridLoading = useDatabase((s) => s.gridLoading);
  const gridError = useDatabase((s) => s.gridError);
  const pendingEdits = useDatabase((s) => s.pendingEdits);
  const pendingDeletes = useDatabase((s) => s.pendingDeletes);
  const pendingInserts = useDatabase((s) => s.pendingInserts);
  const applyingChanges = useDatabase((s) => s.applyingChanges);

  const openTableGrid = useDatabase((s) => s.openTableGrid);
  const refreshGrid = useDatabase((s) => s.refreshGrid);
  const setGridPage = useDatabase((s) => s.setGridPage);
  const toggleGridSort = useDatabase((s) => s.toggleGridSort);
  const setGridFilter = useDatabase((s) => s.setGridFilter);
  const stageCellEdit = useDatabase((s) => s.stageCellEdit);
  const stageRowDelete = useDatabase((s) => s.stageRowDelete);
  const stageRowInsert = useDatabase((s) => s.stageRowInsert);
  const discardAllChanges = useDatabase((s) => s.discardAllChanges);
  const getPendingChanges = useDatabase((s) => s.getPendingChanges);
  const applyPendingChanges = useDatabase((s) => s.applyPendingChanges);

  const [editingCell, setEditingCell] = useState<{ sig: string; col: string; val: string } | null>(null);
  const [inspectedCell, setInspectedCell] = useState<{ column: string; value: unknown } | null>(null);
  const [showDiffPreview, setShowDiffPreview] = useState(false);

  const tableMeta = useMemo(() => {
    if (!schema || !selectedTable) return undefined;
    return schema.tables.find((tb) => tb.name === selectedTable.table && tb.schema === selectedTable.schema);
  }, [schema, selectedTable]);

  const pkCols = useMemo(
    () => (tableMeta?.columns || []).filter((c) => c.primaryKey).map((c) => c.name),
    [tableMeta]
  );

  const canEdit = Boolean(activeConn && !activeConn.readOnly && pkCols.length > 0 && tableMeta?.type !== "view");
  const pendingChanges = getPendingChanges();
  const sqlPreview = useMemo(() => {
    if (!activeConn || !selectedTable || pendingChanges.length === 0) return [];
    return generateSqlDiffPreview(activeConn.engine, selectedTable.schema, selectedTable.table, pendingChanges);
  }, [activeConn, selectedTable, pendingChanges]);

  const handleExport = async (format: "csv" | "json" | "sql") => {
    if (!activeConn || !selectedTable) return;
    const res = await bridge.dbExport(activeConn.id, {
      format,
      table: selectedTable.table,
      schema: selectedTable.schema,
    });
    if (!res.ok || res.content === undefined) {
      toast.error(res.error || "Export failed.");
      return;
    }
    try {
      await navigator.clipboard.writeText(res.content);
      toast.success(`Copied ${res.rowCount ?? 0} row(s) as ${format.toUpperCase()}.`);
    } catch {
      void 0;
    }
  };

  if (!activeConn) {
    return <div className="p-6 text-center text-[12px] text-ink-3">{t("Select a connection to browse tables.")}</div>;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-2">
          <select
            value={selectedTable ? `${selectedTable.schema}.${selectedTable.table}` : ""}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const dot = v.indexOf(".");
              const sc = dot >= 0 ? v.slice(0, dot) : "";
              const tb = dot >= 0 ? v.slice(dot + 1) : v;
              void openTableGrid(activeConn.id, sc, tb);
            }}
            className="rounded border border-line bg-input px-2 py-1 text-[11px] text-ink outline-none"
          >
            <option value="">{t("Select Table...")}</option>
            {(schema?.tables || []).map((tb) => (
              <option key={`${tb.schema}.${tb.name}`} value={`${tb.schema}.${tb.name}`}>
                {tb.schema && tb.schema !== "main" ? `${tb.schema}.${tb.name}` : tb.name} ({tb.rowCount ?? 0})
              </option>
            ))}
          </select>

          <div className="flex items-center rounded border border-line bg-input px-2">
            <Search className="h-3 w-3 text-ink-3" />
            <input
              type="text"
              value={gridFilter}
              onChange={(e) => setGridFilter(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void refreshGrid()}
              placeholder={t("Quick filter rows...")}
              className="w-44 bg-transparent px-1.5 py-1 text-[11px] text-ink outline-none"
            />
          </div>

          <button
            type="button"
            onClick={() => void refreshGrid()}
            className="rounded border border-line bg-raised p-1 text-ink-2 hover:text-ink"
            title={t("Refresh")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", gridLoading && "animate-spin")} />
          </button>

          {canEdit && tableMeta && (
            <button
              type="button"
              onClick={() => {
                const init: Record<string, unknown> = {};
                for (const c of tableMeta.columns) {
                  if (!c.autoIncrement) init[c.name] = c.nullable ? null : "";
                }
                stageRowInsert(init);
              }}
              className="flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 text-ink-2 hover:text-ink"
            >
              <Plus className="h-3 w-3" />
              <span>{t("Add Row")}</span>
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {!activeConn.readOnly && pkCols.length === 0 && selectedTable && (
            <span className="text-[10px] text-amber-400">{t("No Primary Key (read-only grid)")}</span>
          )}
          <button type="button" onClick={() => void handleExport("csv")} className="rounded border border-line bg-raised px-2 py-1 text-[10px] text-ink-2 hover:text-ink">
            <Download className="mr-1 inline h-3 w-3" />CSV
          </button>
          <button type="button" onClick={() => void handleExport("json")} className="rounded border border-line bg-raised px-2 py-1 text-[10px] text-ink-2 hover:text-ink">
            JSON
          </button>
          <button type="button" onClick={() => void handleExport("sql")} className="rounded border border-line bg-raised px-2 py-1 text-[10px] text-ink-2 hover:text-ink">
            SQL
          </button>

          <div className="ml-2 flex items-center gap-1">
            <button
              type="button"
              disabled={gridPage === 0}
              onClick={() => setGridPage(gridPage - 1)}
              className="rounded border border-line bg-raised p-1 text-ink-2 hover:text-ink disabled:opacity-40"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="px-1 font-mono text-[10px] text-ink-2">
              {t("Page")} {gridPage + 1}
            </span>
            <button
              type="button"
              disabled={!gridResult || gridResult.rows.length < gridPageSize}
              onClick={() => setGridPage(gridPage + 1)}
              className="rounded border border-line bg-raised p-1 text-ink-2 hover:text-ink disabled:opacity-40"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {pendingChanges.length > 0 && (
        <div className="flex items-center justify-between border-b border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-[11px]">
          <div className="flex items-center gap-2 text-amber-300">
            <span className="font-semibold">{pendingChanges.length} {t("pending transaction change(s)")}</span>
            <button
              type="button"
              onClick={() => setShowDiffPreview((v) => !v)}
              className="underline hover:text-white"
            >
              {showDiffPreview ? t("Hide SQL Preview") : t("Preview SQL Diff")}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={discardAllChanges}
              className="rounded border border-line bg-surface px-2.5 py-1 text-ink-2 hover:text-ink"
            >
              {t("Discard")}
            </button>
            <button
              type="button"
              disabled={applyingChanges}
              onClick={() => void applyPendingChanges()}
              className="flex items-center gap-1 rounded bg-emerald-600 px-2.5 py-1 font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              <Check className="h-3 w-3" />
              <span>{applyingChanges ? t("Committing...") : t("Commit Transaction")}</span>
            </button>
          </div>
        </div>
      )}

      {showDiffPreview && sqlPreview.length > 0 && (
        <div className="max-h-40 overflow-auto border-b border-line bg-canvas p-3 font-mono text-[11px] text-ink">
          <div className="mb-1 text-[10px] font-semibold uppercase text-ink-3">BEGIN TRANSACTION;</div>
          {sqlPreview.map((stmt, i) => (
            <div key={i} className="text-amber-300">{stmt}</div>
          ))}
          <div className="mt-1 text-[10px] font-semibold uppercase text-ink-3">COMMIT;</div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-auto bg-canvas">
          {gridError ? (
            <div className="m-3 rounded border border-rose-500/40 bg-rose-500/10 p-3 font-mono text-[11px] text-rose-300">
              {gridError}
            </div>
          ) : !selectedTable || !gridResult ? (
            <div className="p-6 text-center text-[12px] text-ink-3">
              {t("Pick a table from the sidebar or dropdown to inspect its data.")}
            </div>
          ) : (
            <table className="w-full border-collapse text-left font-mono text-[11px]">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr>
                  {canEdit && <th className="w-8 border-b border-r border-line px-2 py-1.5 text-[10px] text-ink-3" />}
                  {gridResult.columns.map((col) => (
                    <th
                      key={col.name}
                      onClick={() => toggleGridSort(col.name)}
                      className="cursor-pointer border-b border-r border-line px-2.5 py-1.5 font-semibold text-ink hover:bg-hover"
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span>{col.name}</span>
                        {gridSort?.column === col.name && (
                          gridSort.dir === "ASC" ? <ArrowUp className="h-3 w-3 text-accent" /> : <ArrowDown className="h-3 w-3 text-accent" />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pendingInserts.map((ins, iIdx) => (
                  <tr key={`ins-${iIdx}`} className="bg-emerald-500/10">
                    {canEdit && <td className="border-b border-r border-line px-2 py-1 text-[10px] font-bold text-emerald-400">+</td>}
                    {gridResult.columns.map((col) => (
                      <td key={col.name} className="border-b border-r border-line px-1.5 py-0.5">
                        <input
                          type="text"
                          value={ins[col.name] === null || ins[col.name] === undefined ? "" : String(ins[col.name])}
                          onChange={(e) => {
                            ins[col.name] = e.target.value;
                            useDatabase.setState({ pendingInserts: [...pendingInserts] });
                          }}
                          placeholder="NULL"
                          className="w-full bg-transparent px-1 py-0.5 font-mono text-[11px] text-ink outline-none focus:bg-input"
                        />
                      </td>
                    ))}
                  </tr>
                ))}

                {gridResult.rows.map((row, rIdx) => {
                  const sigInfo = buildRowKeySignature(row, pkCols);
                  const sig = sigInfo?.sig || "";
                  const isDeleted = Boolean(sig && pendingDeletes[sig]);
                  const staged = sig ? pendingEdits[sig] : undefined;

                  return (
                    <tr
                      key={sig || rIdx}
                      className={cn(
                        "hover:bg-hover/60",
                        isDeleted && "bg-rose-500/15 line-through opacity-60"
                      )}
                    >
                      {canEdit && (
                        <td className="border-b border-r border-line px-2 py-1 text-center">
                          {sigInfo && (
                            <button
                              type="button"
                              title={t("Stage Row Delete")}
                              onClick={() => stageRowDelete(sig, sigInfo.key)}
                              className={cn("text-ink-3 hover:text-rose-400", isDeleted && "text-rose-400")}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </td>
                      )}
                      {gridResult.columns.map((col) => {
                        const isUpdated = Boolean(staged && col.name in staged.updates);
                        const val = isUpdated ? staged!.updates[col.name] : row[col.name];
                        const isEditingThis = Boolean(editingCell && editingCell.sig === sig && editingCell.col === col.name);

                        return (
                          <td
                            key={col.name}
                            onClick={() => setInspectedCell({ column: col.name, value: val })}
                            onDoubleClick={() => {
                              if (!canEdit || !sigInfo || isDeleted) return;
                              setEditingCell({ sig, col: col.name, val: val === null ? "" : String(val) });
                            }}
                            className={cn(
                              "max-w-[300px] cursor-pointer truncate border-b border-r border-line px-2.5 py-1",
                              isUpdated && "bg-amber-500/15 text-amber-300",
                              val === null && "italic text-ink-3"
                            )}
                          >
                            {isEditingThis ? (
                              <input
                                autoFocus
                                type="text"
                                value={editingCell!.val}
                                onChange={(e) => setEditingCell({ sig, col: col.name, val: e.target.value })}
                                onBlur={() => {
                                  if (sigInfo) stageCellEdit(sig, sigInfo.key, row, col.name, editingCell!.val === "" ? null : editingCell!.val);
                                  setEditingCell(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    if (sigInfo) stageCellEdit(sig, sigInfo.key, row, col.name, editingCell!.val === "" ? null : editingCell!.val);
                                    setEditingCell(null);
                                  } else if (e.key === "Escape") {
                                    setEditingCell(null);
                                  }
                                }}
                                className="w-full rounded bg-input px-1 py-0.5 font-mono text-[11px] text-ink outline-none ring-1 ring-accent"
                              />
                            ) : (
                              formatCellDisplay(val)
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <CellInspectorDrawer cell={inspectedCell} onClose={() => setInspectedCell(null)} />
      </div>
    </div>
  );
}

function SchemaDiagramSubView({ activeConn, schema }: { activeConn?: DbConnectionSummary; schema?: DbSchemaSnapshot }) {
  const t = useT();
  const openTableGrid = useDatabase((s) => s.openTableGrid);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const dragRef = useRef<{ table: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  useEffect(() => {
    if (!schema) return;
    const init: Record<string, { x: number; y: number }> = {};
    const cols = 3;
    schema.tables.forEach((tbl, idx) => {
      init[tbl.name] = {
        x: 32 + (idx % cols) * 290,
        y: 32 + Math.floor(idx / cols) * 260,
      };
    });
    setPositions(init);
  }, [schema]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const { table, startX, startY, origX, origY } = dragRef.current;
      setPositions((prev) => ({
        ...prev,
        [table]: { x: Math.max(12, origX + (e.clientX - startX)), y: Math.max(12, origY + (e.clientY - startY)) },
      }));
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  if (!activeConn || !schema || schema.engine === "redis") {
    return <div className="p-6 text-center text-[12px] text-ink-3">{t("Load a SQL schema to inspect relationships.")}</div>;
  }

  const handleSendAllDdlToAi = async () => {
    const allDdl = schema.tables.map((tb) => tb.ddl || `CREATE TABLE ${tb.name} (...);`).join("\n\n");
    const sid = await useAi.getState().newSession();
    if (!sid) return;
    useAi.getState().setPendingDraft(sid, `Analyze this database schema for "${activeConn.name}" (${activeConn.engine}) and suggest indexes, normalization, and security improvements:\n\n\`\`\`sql\n${allDdl}\n\`\`\``);
    useEditor.getState().openAiChat(sid, `DB Schema: ${activeConn.name}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-1.5 text-[11px]">
        <span className="text-ink-2">
          {schema.tables.length} {t("Tables")} · {schema.foreignKeys.length} {t("Foreign Keys")} ({t("drag cards to arrange")})
        </span>
        <button
          type="button"
          onClick={() => void handleSendAllDdlToAi()}
          className="flex items-center gap-1 rounded border border-accent/40 bg-accent/15 px-2.5 py-1 text-accent hover:bg-accent/25"
        >
          <Sparkles className="h-3 w-3" />
          <span>{t("Analyze Schema with AI")}</span>
        </button>
      </div>

      <div className="relative flex-1 overflow-auto bg-canvas">
        <div className="relative min-h-[800px] min-w-[1000px]">
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <defs>
              <marker id="fk-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" className="text-accent" />
              </marker>
            </defs>
            {schema.foreignKeys.map((fk, idx) => {
              const fromPos = positions[fk.fromTable];
              const toPos = positions[fk.toTable];
              if (!fromPos || !toPos) return null;
              const x1 = fromPos.x + 240;
              const y1 = fromPos.y + 42;
              const x2 = toPos.x;
              const y2 = toPos.y + 42;
              const midX = (x1 + x2) / 2;
              return (
                <path
                  key={idx}
                  d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  markerEnd="url(#fk-arrow)"
                  className="text-accent/70"
                />
              );
            })}
          </svg>

          {schema.tables.map((tbl) => {
            const pos = positions[tbl.name] || { x: 24, y: 24 };
            return (
              <div
                key={`${tbl.schema}.${tbl.name}`}
                style={{ left: pos.x, top: pos.y }}
                className="absolute w-60 rounded border border-line bg-surface shadow-lg"
              >
                <div
                  onPointerDown={(e) => {
                    dragRef.current = { table: tbl.name, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y };
                  }}
                  onDoubleClick={() => void openTableGrid(activeConn.id, tbl.schema, tbl.name)}
                  className="flex cursor-grab items-center justify-between border-b border-line bg-raised px-2.5 py-1.5 text-[11px] font-semibold text-ink active:cursor-grabbing"
                >
                  <div className="flex items-center gap-1.5 truncate">
                    <Table2 className="h-3.5 w-3.5 shrink-0 text-accent" />
                    <span className="truncate">{tbl.name}</span>
                  </div>
                  <span className="text-[10px] font-normal text-ink-3">{tbl.rowCount ?? 0}</span>
                </div>
                <div className="max-h-44 overflow-y-auto p-1.5 text-[10px]">
                  {tbl.columns.map((col) => {
                    const isFk = schema.foreignKeys.some((fk) => fk.fromTable === tbl.name && fk.fromColumn === col.name);
                    return (
                      <div key={col.name} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 hover:bg-hover">
                        <div className="flex min-w-0 items-center gap-1">
                          {col.primaryKey && <KeyRound className="h-2.5 w-2.5 shrink-0 text-amber-400" />}
                          {isFk && <Link2 className="h-2.5 w-2.5 shrink-0 text-sky-400" />}
                          <span className="truncate text-ink">{col.name}</span>
                        </div>
                        <span className="shrink-0 font-mono text-[9px] text-ink-3">{col.dataType}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const SEV_STYLE: Record<DbAuditFinding["severity"], string> = {
  critical: "border-rose-500/50 bg-rose-500/15 text-rose-300",
  high: "border-orange-500/50 bg-orange-500/15 text-orange-300",
  medium: "border-amber-500/50 bg-amber-500/15 text-amber-300",
  low: "border-sky-500/40 bg-sky-500/10 text-sky-300",
  info: "border-line bg-raised text-ink-2",
};

function SecurityAuditSubView({ activeConn }: { activeConn?: DbConnectionSummary }) {
  const t = useT();
  const findings = useDatabase((s) => s.auditFindings);
  const summary = useDatabase((s) => s.auditSummary);
  const loading = useDatabase((s) => s.auditLoading);
  const runAudit = useDatabase((s) => s.runAudit);

  const handleAskAi = async () => {
    if (!activeConn || findings.length === 0) return;
    const sid = await useAi.getState().newSession();
    if (!sid) return;
    const report = findings.map((f) => `- [${f.severity.toUpperCase()}] ${f.title}: ${f.detail}`).join("\n");
    useAi.getState().setPendingDraft(sid, `Review these database security audit findings for "${activeConn.name}" (${activeConn.engine}) and propose remediation SQL/migration steps:\n\n${report}`);
    useEditor.getState().openAiChat(sid, `DB Audit: ${activeConn.name}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-2 text-[11px]">
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!activeConn || loading}
            onClick={() => activeConn && void runAudit(activeConn.id)}
            className="flex items-center gap-1.5 rounded bg-accent px-2.5 py-1 font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>{loading ? t("Auditing...") : t("Run Security Audit")}</span>
          </button>
          {summary && (
            <div className="flex items-center gap-1.5 text-[10px]">
              <span className="rounded bg-rose-500/15 px-1.5 py-0.5 text-rose-300">Critical: {summary.critical}</span>
              <span className="rounded bg-orange-500/15 px-1.5 py-0.5 text-orange-300">High: {summary.high}</span>
              <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-amber-300">Medium: {summary.medium}</span>
            </div>
          )}
        </div>
        {findings.length > 0 && (
          <button
            type="button"
            onClick={() => void handleAskAi()}
            className="flex items-center gap-1 rounded border border-accent/40 bg-accent/15 px-2.5 py-1 text-accent hover:bg-accent/25"
          >
            <Sparkles className="h-3 w-3" />
            <span>{t("Fix with AI")}</span>
          </button>
        )}
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {findings.length === 0 ? (
          <div className="py-10 text-center text-[12px] text-ink-3">
            {t("Run a security & privacy audit to check PII columns, weak password hashes, TLS settings, and encryption.")}
          </div>
        ) : (
          findings.map((f, idx) => (
            <div key={idx} className={cn("rounded border p-3 text-[12px]", SEV_STYLE[f.severity])}>
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">
                  <span className="mr-2 uppercase">[{f.severity}]</span>
                  {f.title}
                </div>
                <span className="font-mono text-[10px] opacity-80">{f.category}</span>
              </div>
              <p className="mt-1 text-[11px] opacity-90">{f.detail}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function RedisInspectorSubView({ activeConn }: { activeConn?: DbConnectionSummary }) {
  const t = useT();
  const pattern = useDatabase((s) => s.redisPattern);
  const cursor = useDatabase((s) => s.redisCursor);
  const items = useDatabase((s) => s.redisItems);
  const selected = useDatabase((s) => s.redisSelected);
  const loading = useDatabase((s) => s.redisLoading);
  const redisScan = useDatabase((s) => s.redisScan);
  const redisInspectKey = useDatabase((s) => s.redisInspectKey);
  const redisDeleteKey = useDatabase((s) => s.redisDeleteKey);
  const [patInput, setPatInput] = useState(pattern);

  useEffect(() => {
    setPatInput(pattern);
  }, [pattern]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between border-b border-line bg-surface px-3 py-1.5 text-[11px]">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={patInput}
            onChange={(e) => setPatInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void redisScan("0", patInput)}
            placeholder="*"
            className="w-48 rounded border border-line bg-input px-2 py-1 font-mono text-ink outline-none"
          />
          <button
            type="button"
            disabled={loading}
            onClick={() => void redisScan("0", patInput)}
            className="rounded bg-accent px-2.5 py-1 font-medium text-white hover:opacity-90"
          >
            {t("Scan Keys")}
          </button>
          {cursor !== "0" && (
            <button
              type="button"
              onClick={() => void redisScan(cursor, patInput)}
              className="rounded border border-line bg-raised px-2 py-1 text-ink-2 hover:text-ink"
            >
              {t("Next Cursor")} ({cursor})
            </button>
          )}
        </div>
        {activeConn?.readOnly && (
          <span className="flex items-center gap-1 text-amber-400">
            <Lock className="h-3 w-3" />
            {t("Read-Only Lock Active")}
          </span>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="w-1/2 overflow-y-auto border-r border-line bg-canvas p-2 font-mono text-[11px]">
          {items.length === 0 ? (
            <div className="p-4 text-center text-ink-3">{t("No keys loaded. Click Scan Keys.")}</div>
          ) : (
            items.map((item) => (
              <div
                key={item.key}
                onClick={() => void redisInspectKey(item.key)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 hover:bg-hover",
                  selected?.key === item.key && "bg-selected"
                )}
              >
                <span className="truncate text-ink">{item.key}</span>
                <div className="flex shrink-0 items-center gap-2 text-[10px] text-ink-3">
                  <span className="rounded bg-raised px-1 uppercase">{item.type}</span>
                  <span>TTL: {item.ttl}</span>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col bg-surface p-3 text-[12px]">
          {selected ? (
            <>
              <div className="mb-2 flex items-center justify-between border-b border-line pb-2">
                <div>
                  <div className="font-mono font-semibold text-ink">{selected.key}</div>
                  <div className="text-[10px] text-ink-3">
                    {selected.type} · TTL: {selected.ttl}
                  </div>
                </div>
                {!activeConn?.readOnly && (
                  <button
                    type="button"
                    onClick={() => void redisDeleteKey(selected.key)}
                    className="flex items-center gap-1 rounded border border-rose-500/40 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-300 hover:bg-rose-500/25"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>{t("Delete")}</span>
                  </button>
                )}
              </div>
              <pre className="flex-1 overflow-auto rounded border border-line bg-canvas p-3 font-mono text-[11px] text-ink">
                {typeof selected.value === "string"
                  ? tryPrettyJson(selected.value) ?? selected.value
                  : JSON.stringify(selected.value, null, 2)}
              </pre>
            </>
          ) : (
            <div className="m-auto text-ink-3">{t("Select a Redis key to inspect its value.")}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function DatabaseView() {
  const t = useT();
  const connections = useDatabase((s) => s.connections);
  const schemas = useDatabase((s) => s.schemas);
  const activeConnectionId = useDatabase((s) => s.activeConnectionId);
  const subView = useDatabase((s) => s.subView);

  const loadConnections = useDatabase((s) => s.loadConnections);
  const selectConnection = useDatabase((s) => s.selectConnection);
  const connectAndLoadSchema = useDatabase((s) => s.connectAndLoadSchema);
  const setSubView = useDatabase((s) => s.setSubView);
  const openModal = useDatabase((s) => s.openModal);

  useEffect(() => {
    void loadConnections();
  }, [loadConnections]);

  const activeConn = useMemo(
    () => connections.find((c) => c.id === activeConnectionId),
    [connections, activeConnectionId]
  );
  const activeSchema = activeConnectionId ? schemas[activeConnectionId] : undefined;

  useEffect(() => {
    if (activeConn && !activeSchema) {
      void connectAndLoadSchema(activeConn.id);
    }
  }, [activeConn?.id]);

  const tabs: Array<{ id: DbSubView; label: string; icon: typeof Terminal; hidden?: boolean }> = [
    { id: "console", label: t("SQL Console"), icon: Terminal, hidden: activeConn?.engine === "redis" },
    { id: "grid", label: t("Data Grid"), icon: Table2, hidden: activeConn?.engine === "redis" },
    { id: "diagram", label: t("Schema Diagram"), icon: GitFork, hidden: activeConn?.engine === "redis" },
    { id: "redis", label: t("Redis Inspector"), icon: Database, hidden: activeConn?.engine !== "redis" },
    { id: "audit", label: t("Security Audit"), icon: ShieldAlert },
  ];

  return (
    <div className="flex h-full w-full flex-col bg-canvas text-ink">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-3 py-2 text-[12px]">
        <div className="flex items-center gap-2">
          <Database className="h-4 w-4 text-accent" />
          <select
            value={activeConnectionId || ""}
            onChange={(e) => {
              const id = e.target.value || null;
              selectConnection(id);
              if (id && !schemas[id]) void connectAndLoadSchema(id);
            }}
            className="rounded border border-line bg-input px-2.5 py-1 text-[12px] text-ink outline-none focus:border-accent"
          >
            {connections.length === 0 ? (
              <option value="">{t("No Connections")}</option>
            ) : (
              connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.engine.toUpperCase()} · {c.environment})
                </option>
              ))
            )}
          </select>

          {activeConn?.readOnly && (
            <span className="flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
              <Lock className="h-2.5 w-2.5" />
              READ-ONLY
            </span>
          )}

          {activeConn?.serverVersion && (
            <span className="hidden text-[11px] text-ink-3 md:inline">{activeConn.serverVersion}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {tabs
            .filter((tab) => !tab.hidden)
            .map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSubView(tab.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded px-2.5 py-1 text-[11px] font-medium transition-colors",
                    subView === tab.id ? "bg-accent/15 text-accent" : "text-ink-2 hover:bg-hover hover:text-ink"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          <button
            type="button"
            onClick={() => openModal(null)}
            className="ml-2 flex items-center gap-1 rounded border border-line bg-raised px-2 py-1 text-[11px] text-ink-2 hover:text-ink"
          >
            <Plus className="h-3 w-3" />
            <span>{t("New")}</span>
          </button>
        </div>
      </div>

      {subView === "console" && activeConn?.engine !== "redis" && (
        <SqlConsoleSubView activeConn={activeConn} schema={activeSchema} />
      )}
      {subView === "grid" && activeConn?.engine !== "redis" && (
        <DataGridSubView activeConn={activeConn} schema={activeSchema} />
      )}
      {subView === "diagram" && activeConn?.engine !== "redis" && (
        <SchemaDiagramSubView activeConn={activeConn} schema={activeSchema} />
      )}
      {subView === "audit" && <SecurityAuditSubView activeConn={activeConn} />}
      {subView === "redis" && <RedisInspectorSubView activeConn={activeConn} />}
    </div>
  );
}
