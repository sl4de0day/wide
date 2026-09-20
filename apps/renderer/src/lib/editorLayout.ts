export type SplitDirection = "horizontal" | "vertical";

export interface EditorPane {
  id: string;
  activePath: string | null;
}

export interface LayoutLeafNode {
  type: "leaf";
  paneId: string;
}

export interface LayoutSplitNode {
  type: "split";
  id: string;
  direction: SplitDirection;
  ratio: number;
  children: [LayoutNode, LayoutNode];
}

export type LayoutNode = LayoutLeafNode | LayoutSplitNode;

export type GridPreset = "1x1" | "1x2" | "2x1" | "2x2" | "1x3" | "3x1";

let nextId = 1;
export function generatePaneId(): string {
  return `pane-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
}

export function generateSplitId(): string {
  return `split-${Date.now().toString(36)}-${(nextId++).toString(36)}`;
}

export function createInitialLayout(paneId: string): LayoutLeafNode {
  return { type: "leaf", paneId };
}

export function getLeafIds(node: LayoutNode): string[] {
  if (node.type === "leaf") return [node.paneId];
  return [...getLeafIds(node.children[0]), ...getLeafIds(node.children[1])];
}

export function countLeaves(node: LayoutNode): number {
  if (node.type === "leaf") return 1;
  return countLeaves(node.children[0]) + countLeaves(node.children[1]);
}

export function splitPaneInTree(
  root: LayoutNode,
  targetPaneId: string,
  direction: SplitDirection,
  newPaneId: string,
  ratio = 0.5,
): LayoutNode {
  if (root.type === "leaf") {
    if (root.paneId === targetPaneId) {
      return {
        type: "split",
        id: generateSplitId(),
        direction,
        ratio: Math.min(0.85, Math.max(0.15, ratio)),
        children: [
          { type: "leaf", paneId: targetPaneId },
          { type: "leaf", paneId: newPaneId },
        ],
      };
    }
    return root;
  }

  const left = splitPaneInTree(root.children[0], targetPaneId, direction, newPaneId, ratio);
  const right = splitPaneInTree(root.children[1], targetPaneId, direction, newPaneId, ratio);

  if (left === root.children[0] && right === root.children[1]) {
    return root;
  }

  return {
    ...root,
    children: [left, right],
  };
}

export function closePaneInTree(root: LayoutNode, targetPaneId: string): LayoutNode {
  if (root.type === "leaf") return root;
  if (root.children[0].type === "leaf" && root.children[0].paneId === targetPaneId) {
    return root.children[1];
  }
  if (root.children[1].type === "leaf" && root.children[1].paneId === targetPaneId) {
    return root.children[0];
  }

  const left = closePaneInTree(root.children[0], targetPaneId);
  const right = closePaneInTree(root.children[1], targetPaneId);

  if (left === root.children[0] && right === root.children[1]) {
    return root;
  }

  return {
    ...root,
    children: [left, right],
  };
}

export function setSplitRatioInTree(root: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (root.type === "leaf") return root;

  const clamped = Math.min(0.85, Math.max(0.15, ratio));

  if (root.id === splitId) {
    if (Math.abs(root.ratio - clamped) < 0.001) return root;
    return { ...root, ratio: clamped };
  }

  const left = setSplitRatioInTree(root.children[0], splitId, ratio);
  const right = setSplitRatioInTree(root.children[1], splitId, ratio);

  if (left === root.children[0] && right === root.children[1]) {
    return root;
  }

  return {
    ...root,
    children: [left, right],
  };
}

export function buildPresetLayout(preset: GridPreset, paneIds: string[]): LayoutNode {
  const p = (index: number) => paneIds[index] || generatePaneId();

  switch (preset) {
    case "1x1":
      return { type: "leaf", paneId: p(0) };

    case "1x2":
      return {
        type: "split",
        id: generateSplitId(),
        direction: "vertical",
        ratio: 0.5,
        children: [
          { type: "leaf", paneId: p(0) },
          { type: "leaf", paneId: p(1) },
        ],
      };

    case "2x1":
      return {
        type: "split",
        id: generateSplitId(),
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { type: "leaf", paneId: p(0) },
          { type: "leaf", paneId: p(1) },
        ],
      };

    case "2x2":
      return {
        type: "split",
        id: generateSplitId(),
        direction: "horizontal",
        ratio: 0.5,
        children: [
          {
            type: "split",
            id: generateSplitId(),
            direction: "vertical",
            ratio: 0.5,
            children: [
              { type: "leaf", paneId: p(0) },
              { type: "leaf", paneId: p(1) },
            ],
          },
          {
            type: "split",
            id: generateSplitId(),
            direction: "vertical",
            ratio: 0.5,
            children: [
              { type: "leaf", paneId: p(2) },
              { type: "leaf", paneId: p(3) },
            ],
          },
        ],
      };

    case "1x3":
      return {
        type: "split",
        id: generateSplitId(),
        direction: "vertical",
        ratio: 0.333,
        children: [
          { type: "leaf", paneId: p(0) },
          {
            type: "split",
            id: generateSplitId(),
            direction: "vertical",
            ratio: 0.5,
            children: [
              { type: "leaf", paneId: p(1) },
              { type: "leaf", paneId: p(2) },
            ],
          },
        ],
      };

    case "3x1":
      return {
        type: "split",
        id: generateSplitId(),
        direction: "horizontal",
        ratio: 0.333,
        children: [
          { type: "leaf", paneId: p(0) },
          {
            type: "split",
            id: generateSplitId(),
            direction: "horizontal",
            ratio: 0.5,
            children: [
              { type: "leaf", paneId: p(1) },
              { type: "leaf", paneId: p(2) },
            ],
          },
        ],
      };
  }
}

export function detectPreset(root: LayoutNode): GridPreset | "custom" {
  if (root.type === "leaf") return "1x1";

  if (root.direction === "vertical") {
    const [c0, c1] = root.children;
    if (c0.type === "leaf" && c1.type === "leaf") return "1x2";
    if (c0.type === "leaf" && c1.type === "split" && c1.direction === "vertical" &&
        c1.children[0].type === "leaf" && c1.children[1].type === "leaf") {
      return "1x3";
    }
  }

  if (root.direction === "horizontal") {
    const [c0, c1] = root.children;
    if (c0.type === "leaf" && c1.type === "leaf") return "2x1";
    if (c0.type === "split" && c0.direction === "vertical" &&
        c1.type === "split" && c1.direction === "vertical" &&
        c0.children[0].type === "leaf" && c0.children[1].type === "leaf" &&
        c1.children[0].type === "leaf" && c1.children[1].type === "leaf") {
      return "2x2";
    }
    if (c0.type === "leaf" && c1.type === "split" && c1.direction === "horizontal" &&
        c1.children[0].type === "leaf" && c1.children[1].type === "leaf") {
      return "3x1";
    }
  }

  return "custom";
}
