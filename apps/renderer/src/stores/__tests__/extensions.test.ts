import { beforeEach, describe, expect, it, vi } from "vitest";

import { bridge } from "@/lib/bridge";
import { useExtensions, withDeadline } from "../extensions";

vi.mock("@/editor/languages", () => ({
  preloadGrammar: vi.fn().mockResolvedValue(undefined),
}));

describe("withDeadline", () => {
  it("resolves with value when promise succeeds before timeout", async () => {
    const work = Promise.resolve("done");
    const result = await withDeadline(work, () => "timeout", 1000);
    expect(result).toBe("done");
  });

  it("resolves with fallback value when timeout expires", async () => {
    const work = new Promise<string>((resolve) => setTimeout(() => resolve("slow"), 100));
    const result = await withDeadline(work, () => "timed-out-fallback", 20);
    expect(result).toBe("timed-out-fallback");
  });

  it("rejects when the underlying work promise rejects (no hanging/freeze)", async () => {
    const error = new Error("Network crash");
    const work = Promise.reject(error);

    await expect(withDeadline(work, () => "fallback", 1000)).rejects.toThrow("Network crash");
  });
});

describe("useExtensions store lifecycle & stability", () => {
  beforeEach(() => {
    useExtensions.setState({
      installed: new Set<string>(),
      loading: false,
      busy: new Set<string>(),
      operations: {},
      servers: {},
      error: null,
    });
    vi.restoreAllMocks();
  });

  it("tracks stage during installation and cleans up busy states upon completion", async () => {
    let stageObservedDuringPrepare: string | undefined;

    vi.spyOn(bridge, "extensionPrepare").mockImplementation(async (id: string) => {
      stageObservedDuringPrepare = useExtensions.getState().operations[id]?.stage;
      return { ok: true, server: { command: "pyright", path: "/usr/bin/pyright", state: "present" } };
    });

    vi.spyOn(bridge, "extensionInstall").mockImplementation(async (id: string) => {
      const stage = useExtensions.getState().operations[id]?.stage;
      expect(stage).toBe("installing");
      return { ok: true, installed: [id] };
    });

    const success = await useExtensions.getState().install("python");
    expect(success).toBe(true);
    expect(stageObservedDuringPrepare).toBe("preparing");
    expect(useExtensions.getState().installed.has("python")).toBe(true);
    expect(useExtensions.getState().busy.has("python")).toBe(false);
    expect(useExtensions.getState().operations["python"]).toBeUndefined();
  });

  it("handles cancelled preparation without proceeding to installation", async () => {
    const installSpy = vi.spyOn(bridge, "extensionInstall");
    vi.spyOn(bridge, "extensionPrepare").mockResolvedValue({ ok: true, server: null, cancelled: true });

    const success = await useExtensions.getState().install("rust");
    expect(success).toBe(false);
    expect(installSpy).not.toHaveBeenCalled();
    expect(useExtensions.getState().busy.has("rust")).toBe(false);
    expect(useExtensions.getState().operations["rust"]).toBeUndefined();
  });

  it("never freezes busy state when prepare or install throws an exception", async () => {
    vi.spyOn(bridge, "extensionPrepare").mockRejectedValue(new Error("Host connection dropped"));

    const success = await useExtensions.getState().install("go");
    expect(success).toBe(false);
    expect(useExtensions.getState().error).toContain("Host connection dropped");
    expect(useExtensions.getState().busy.has("go")).toBe(false);
    expect(useExtensions.getState().operations["go"]).toBeUndefined();
  });

  it("sets operation stage to cancelling when cancel is called", async () => {
    const cancelSpy = vi.spyOn(bridge, "extensionCancelPrepare").mockResolvedValue({ ok: true, cancelled: true });
    useExtensions.setState({
      busy: new Set(["python"]),
      operations: { python: { stage: "preparing", startedAt: Date.now() } },
    });

    await useExtensions.getState().cancel("python");
    expect(useExtensions.getState().operations["python"]?.stage).toBe("cancelling");
    expect(cancelSpy).toHaveBeenCalledWith("python");
  });
});
