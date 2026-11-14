import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRowKeySignature, generateSqlDiffPreview, useDatabase } from "../database";

describe("database store & diff preview helpers", () => {
  beforeEach(() => {
    useDatabase.setState({
      connections: [],
      discovered: [],
      schemas: {},
      activeConnectionId: null,
      selectedTable: null,
      subView: "console",
      pendingEdits: {},
      pendingDeletes: {},
      pendingInserts: [],
    });
  });

  it("builds deterministic row key signatures from primary key columns", () => {
    const row = { id: 42, org_id: "acme", name: "Alice" };
    const sig = buildRowKeySignature(row, ["org_id", "id"]);
    expect(sig).toEqual({
      sig: '["acme",42]',
      key: { org_id: "acme", id: 42 },
    });
    expect(buildRowKeySignature(row, [])).toBeNull();
  });

  it("generates accurate SQL diff previews for insert, update, and delete", () => {
    const sqls = generateSqlDiffPreview("sqlite", "main", "users", [
      { kind: "insert", schema: "main", table: "users", values: { name: "O'Brien", role: "admin" } },
      { kind: "update", schema: "main", table: "users", key: { id: 7 }, set: { role: "viewer" } },
      { kind: "delete", schema: "main", table: "users", key: { id: 9 } },
    ]);

    expect(sqls).toEqual([
      `INSERT INTO "users" ("name", "role") VALUES ('O''Brien', 'admin');`,
      `UPDATE "users" SET "role" = 'viewer' WHERE "id" = 7;`,
      `DELETE FROM "users" WHERE "id" = 9;`,
    ]);

    const mysqlSqls = generateSqlDiffPreview("mysql", "app", "items", [
      { kind: "update", schema: "app", table: "items", key: { id: 1 }, set: { title: "Demo" } },
    ]);
    expect(mysqlSqls[0]).toBe("UPDATE `app`.`items` SET `title` = 'Demo' WHERE `id` = 1;");
  });

  it("tracks staged row edits, inserts, and deletes cleanly in store", () => {
    useDatabase.setState({
      selectedTable: { schema: "main", table: "users" },
    });

    const store = useDatabase.getState();
    store.stageCellEdit("[1]", { id: 1 }, { id: 1, name: "Old" }, "name", "New");
    store.stageRowInsert({ name: "Added" });
    store.stageRowDelete("[2]", { id: 2 });

    const changes = useDatabase.getState().getPendingChanges();
    expect(changes).toHaveLength(3);
    expect(changes.map((c) => c.kind)).toEqual(["insert", "update", "delete"]);

    useDatabase.getState().stageCellEdit("[1]", { id: 1 }, { id: 1, name: "Old" }, "name", "Old");
    expect(useDatabase.getState().getPendingChanges().map((c) => c.kind)).toEqual(["insert", "delete"]);

    useDatabase.getState().discardAllChanges();
    expect(useDatabase.getState().getPendingChanges()).toHaveLength(0);
  });

  it("switches automatically to redis subView when selecting a Redis connection", () => {
    useDatabase.setState({
      connections: [
        {
          id: "pg1",
          name: "pg",
          engine: "postgres",
          environment: "dev",
          readOnly: false,
          filePath: "",
          host: "127.0.0.1",
          port: 5432,
          database: "app",
          username: "postgres",
          tlsMode: "prefer",
          caPath: "",
          sshTunnel: { enabled: false, host: "", port: 22, username: "", authMethod: "agent", privateKeyPath: "" },
          hasPassword: false,
          hasConnectionString: false,
          connected: false,
          serverVersion: "",
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: "rd1",
          name: "redis",
          engine: "redis",
          environment: "dev",
          readOnly: false,
          filePath: "",
          host: "127.0.0.1",
          port: 6379,
          database: "0",
          username: "",
          tlsMode: "disable",
          caPath: "",
          sshTunnel: { enabled: false, host: "", port: 22, username: "", authMethod: "agent", privateKeyPath: "" },
          hasPassword: false,
          hasConnectionString: false,
          connected: false,
          serverVersion: "",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      subView: "console",
    });

    vi.stubGlobal("window", {});
    useDatabase.getState().selectConnection("rd1");
    expect(useDatabase.getState().subView).toBe("redis");
    useDatabase.getState().selectConnection("pg1");
    expect(useDatabase.getState().subView).toBe("console");
  });
});
