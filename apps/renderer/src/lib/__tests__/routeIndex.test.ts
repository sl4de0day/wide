import { describe, expect, it } from "vitest";

import { detectRoutesInText, matchRoute, type RouteEntry } from "@/lib/routeIndex";

function entry(method: string, path: string, extra: Partial<RouteEntry> = {}): RouteEntry {
  return {
    method,
    path,
    file: "C:/app/routes.js",
    relativePath: "routes.js",
    line: 1,
    column: 1,
    framework: "Express/Node",
    ...extra,
  };
}

describe("detectRoutesInText", () => {
  it("finds Express routes with their method and path", () => {
    const hits = detectRoutesInText(
      ["app.get('/users', h);", "router.post(\"/users/:id/pay\", h);"].join("\n"),
      "routes.js",
    );
    expect(hits.map((hit) => [hit.method, hit.path])).toEqual([
      ["GET", "/users"],
      ["POST", "/users/:id/pay"],
    ]);
  });

  it("reports 1-based line numbers", () => {
    const hits = detectRoutesInText(["// header", "", "app.put('/a', h);"].join("\n"), "routes.js");
    expect(hits).toHaveLength(1);
    expect(hits[0].line).toBe(3);
  });

  it("treats app.all and Flask @app.route as any-method", () => {
    expect(detectRoutesInText("app.all('/x', h);", "routes.js")[0].method).toBe("GET");
    expect(detectRoutesInText("@app.route('/x')", "views.py")[0].method).toBe("GET");
  });

  it("reads FastAPI decorators", () => {
    const hits = detectRoutesInText("@app.post('/items/{id}')", "main.py");
    expect(hits[0]).toMatchObject({ method: "POST", path: "/items/{id}", framework: "FastAPI/Flask" });
  });

  it("only reads Django path() inside a urls.py", () => {
    expect(detectRoutesInText("path('admin/', views.admin)", "urls.py")).toHaveLength(1);
    expect(detectRoutesInText("path('admin/', views.admin)", "helpers.py")).toHaveLength(0);
  });

  it("ignores lines that are not route definitions", () => {
    expect(detectRoutesInText("const x = 1; // app.get is mentioned here", "a.js")).toHaveLength(0);
  });
});

describe("matchRoute", () => {
  const index = [
    entry("GET", "/users"),
    entry("GET", "/users/:id"),
    entry("POST", "/users/:id/pay"),
    entry("", "/health"),
  ];

  it("matches a static path", () => {
    expect(matchRoute(index, "GET", "/users")?.path).toBe("/users");
  });

  it("matches a path parameter", () => {
    expect(matchRoute(index, "GET", "/users/42")?.path).toBe("/users/:id");
  });

  it("prefers the static route over the parameterised one", () => {
    expect(matchRoute(index, "GET", "/users")?.path).toBe("/users");
  });

  it("respects the method", () => {
    expect(matchRoute(index, "POST", "/users/7/pay")?.path).toBe("/users/:id/pay");
    expect(matchRoute(index, "DELETE", "/users/7/pay")).toBeNull();
  });

  it("lets a method-less route answer any method", () => {
    expect(matchRoute(index, "PATCH", "/health")?.path).toBe("/health");
  });

  it("ignores the query string and trailing slash", () => {
    expect(matchRoute(index, "GET", "/users/42/?a=1")?.path).toBe("/users/:id");
  });

  it("returns null when nothing matches", () => {
    expect(matchRoute(index, "GET", "/nope/deeper")).toBeNull();
  });
});
