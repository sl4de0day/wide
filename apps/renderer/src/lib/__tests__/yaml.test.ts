import { describe, expect, it } from "vitest";

import { importAny } from "@/lib/pitcher/import";
import { parseYaml } from "@/lib/yaml";

describe("parseYaml", () => {
  it("parses nested maps and scalar coercion", () => {
    const doc = parseYaml("info:\n  title: Demo\n  version: 3\n  stable: true\n") as Record<string, Record<string, unknown>>;
    expect(doc.info.title).toBe("Demo");
    expect(doc.info.version).toBe(3);
    expect(doc.info.stable).toBe(true);
  });

  it("parses sequences at the key indent and one level deeper", () => {
    const flat = parseYaml("tags:\n- pet\n- store\n") as { tags: string[] };
    expect(flat.tags).toEqual(["pet", "store"]);
    const nested = parseYaml("tags:\n  - pet\n  - store\n") as { tags: string[] };
    expect(nested.tags).toEqual(["pet", "store"]);
  });

  it("parses a sequence of maps", () => {
    const doc = parseYaml("servers:\n  - url: https://api.example.com\n    description: prod\n") as { servers: { url: string }[] };
    expect(doc.servers[0].url).toBe("https://api.example.com");
  });

  it("keeps quoted keys and strips trailing comments", () => {
    const doc = parseYaml('responses:\n  "200":\n    description: ok # trailing\n') as Record<string, Record<string, { description: string }>>;
    expect(doc.responses["200"].description).toBe("ok");
  });

  it("parses inline flow collections", () => {
    const doc = parseYaml("required: [id, name]\nmeta: { a: 1, b: two }\n") as { required: string[]; meta: Record<string, unknown> };
    expect(doc.required).toEqual(["id", "name"]);
    expect(doc.meta.a).toBe(1);
    expect(doc.meta.b).toBe("two");
  });
});

describe("OpenAPI YAML import", () => {
  const spec = [
    "openapi: 3.0.0",
    "info:",
    "  title: Pet API",
    "servers:",
    "  - url: https://api.example.com",
    "paths:",
    "  /pets/{petId}:",
    "    get:",
    "      operationId: getPet",
    "      tags:",
    "        - pets",
    "      parameters:",
    "        - name: verbose",
    "          in: query",
    "          required: true",
    "          schema:",
    "            type: boolean",
    "    post:",
    "      summary: Create a pet",
    "      requestBody:",
    "        content:",
    "          application/json:",
    "            schema:",
    "              type: object",
    "              properties:",
    "                name:",
    "                  type: string",
    "                age:",
    "                  type: integer",
    "",
  ].join("\n");

  it("detects the spec and builds requests with a baseUrl var", () => {
    const result = importAny(spec);
    expect(result.format).toBe("openapi");
    const collection = result.collections[0];
    expect(collection.vars.find((v) => v.key === "baseUrl")?.value).toBe("https://api.example.com");
    const folder = collection.nodes.find((n) => n.kind === "folder");
    expect(folder && folder.kind === "folder" ? folder.name : "").toBe("pets");
  });

  it("converts path templates and generates an example JSON body", () => {
    const result = importAny(spec);
    const folder = result.collections[0].nodes.find((n) => n.kind === "folder");
    const getReq = folder && folder.kind === "folder" ? folder.nodes.find((n) => n.kind === "request") : undefined;
    expect(getReq && getReq.kind === "request" ? getReq.request.url : "").toBe("{{baseUrl}}/pets/{{petId}}");

    const post = result.collections[0].nodes.find((n) => n.kind === "request");
    if (post && post.kind === "request") {
      expect(post.request.body.mode).toBe("raw");
      const body = JSON.parse(post.request.body.raw);
      expect(body).toEqual({ name: "", age: 0 });
    } else {
      throw new Error("expected a POST request node");
    }
  });
});
