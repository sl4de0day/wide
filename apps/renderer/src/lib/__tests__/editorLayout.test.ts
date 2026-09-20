import { describe, expect, it } from "vitest";
import {
  buildPresetLayout,
  closePaneInTree,
  countLeaves,
  createInitialLayout,
  detectPreset,
  getLeafIds,
  setSplitRatioInTree,
  splitPaneInTree,
} from "../editorLayout";

describe("editorLayout", () => {
  it("creates initial layout as single leaf", () => {
    const layout = createInitialLayout("p1");
    expect(layout.type).toBe("leaf");
    expect(getLeafIds(layout)).toEqual(["p1"]);
    expect(countLeaves(layout)).toBe(1);
    expect(detectPreset(layout)).toBe("1x1");
  });

  it("splits a pane vertically (side-by-side columns)", () => {
    const root = createInitialLayout("p1");
    const split = splitPaneInTree(root, "p1", "vertical", "p2");
    expect(split.type).toBe("split");
    expect(getLeafIds(split)).toEqual(["p1", "p2"]);
    expect(countLeaves(split)).toBe(2);
    expect(detectPreset(split)).toBe("1x2");
  });

  it("splits a pane horizontally (stacked rows)", () => {
    const root = createInitialLayout("p1");
    const split = splitPaneInTree(root, "p1", "horizontal", "p2");
    expect(split.type).toBe("split");
    expect(getLeafIds(split)).toEqual(["p1", "p2"]);
    expect(countLeaves(split)).toBe(2);
    expect(detectPreset(split)).toBe("2x1");
  });

  it("supports simultaneous multi-directional splits (e.g. 2x2 grid via splits)", () => {
    const root = createInitialLayout("p1");
    const s1 = splitPaneInTree(root, "p1", "horizontal", "p2");
    const s2 = splitPaneInTree(s1, "p1", "vertical", "p3");
    const s3 = splitPaneInTree(s2, "p2", "vertical", "p4");

    expect(countLeaves(s3)).toBe(4);
    expect(getLeafIds(s3)).toEqual(["p1", "p3", "p2", "p4"]);
    expect(detectPreset(s3)).toBe("2x2");
  });

  it("builds 2x2 grid preset directly", () => {
    const preset = buildPresetLayout("2x2", ["a", "b", "c", "d"]);
    expect(countLeaves(preset)).toBe(4);
    expect(getLeafIds(preset)).toEqual(["a", "b", "c", "d"]);
    expect(detectPreset(preset)).toBe("2x2");
  });

  it("builds 1x3 and 3x1 presets directly", () => {
    const c3 = buildPresetLayout("1x3", ["a", "b", "c"]);
    expect(countLeaves(c3)).toBe(3);
    expect(getLeafIds(c3)).toEqual(["a", "b", "c"]);
    expect(detectPreset(c3)).toBe("1x3");

    const r3 = buildPresetLayout("3x1", ["a", "b", "c"]);
    expect(countLeaves(r3)).toBe(3);
    expect(getLeafIds(r3)).toEqual(["a", "b", "c"]);
    expect(detectPreset(r3)).toBe("3x1");
  });

  it("closes a pane and collapses the parent split", () => {
    const root = buildPresetLayout("1x2", ["p1", "p2"]);
    const afterClose = closePaneInTree(root, "p2");
    expect(afterClose.type).toBe("leaf");
    expect(getLeafIds(afterClose)).toEqual(["p1"]);
  });

  it("closes a pane in a 2x2 grid down to 3 panes", () => {
    const grid = buildPresetLayout("2x2", ["p1", "p2", "p3", "p4"]);
    const afterClose = closePaneInTree(grid, "p4");
    expect(countLeaves(afterClose)).toBe(3);
    expect(getLeafIds(afterClose)).toEqual(["p1", "p2", "p3"]);
  });

  it("updates split ratio with clamping", () => {
    const root = buildPresetLayout("1x2", ["p1", "p2"]);
    if (root.type !== "split") throw new Error("expected split");

    const updated = setSplitRatioInTree(root, root.id, 0.7);
    if (updated.type !== "split") throw new Error("expected split");
    expect(updated.ratio).toBe(0.7);

    const clamped = setSplitRatioInTree(root, root.id, 0.99);
    if (clamped.type !== "split") throw new Error("expected split");
    expect(clamped.ratio).toBe(0.85);
  });
});
