

export type DiffRow = { type: "same" | "add" | "del"; text: string };

const MAX_DP = 2500;

export function lineDiff(a: string, b: string): DiffRow[] {
  const A = a.split("\n");
  const B = b.split("\n");
  const n = A.length;
  const m = B.length;

  if (n > MAX_DP || m > MAX_DP) {
    const rows: DiffRow[] = [];
    const len = Math.max(n, m);
    for (let i = 0; i < len; i += 1) {
      if (i < n && i < m && A[i] === B[i]) rows.push({ type: "same", text: A[i] });
      else {
        if (i < n) rows.push({ type: "del", text: A[i] });
        if (i < m) rows.push({ type: "add", text: B[i] });
      }
    }
    return rows;
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      rows.push({ type: "same", text: A[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: "del", text: A[i] });
      i += 1;
    } else {
      rows.push({ type: "add", text: B[j] });
      j += 1;
    }
  }
  while (i < n) {
    rows.push({ type: "del", text: A[i] });
    i += 1;
  }
  while (j < m) {
    rows.push({ type: "add", text: B[j] });
    j += 1;
  }
  return rows;
}

export function diffCounts(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.type === "add") added += 1;
    else if (row.type === "del") removed += 1;
  }
  return { added, removed };
}

export function tokenDiff(a: string[], b: string[]): DiffRow[] {
  const n = a.length;
  const m = b.length;
  if (n > MAX_DP || m > MAX_DP) {
    const rows: DiffRow[] = [];
    const len = Math.max(n, m);
    for (let i = 0; i < len; i += 1) {
      if (i < n && i < m && a[i] === b[i]) rows.push({ type: "same", text: a[i] });
      else {
        if (i < n) rows.push({ type: "del", text: a[i] });
        if (i < m) rows.push({ type: "add", text: b[i] });
      }
    }
    return rows;
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { rows.push({ type: "same", text: a[i] }); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { rows.push({ type: "del", text: a[i] }); i += 1; }
    else { rows.push({ type: "add", text: b[j] }); j += 1; }
  }
  while (i < n) { rows.push({ type: "del", text: a[i] }); i += 1; }
  while (j < m) { rows.push({ type: "add", text: b[j] }); j += 1; }
  return rows;
}

export function wordDiff(a: string, b: string): DiffRow[] {
  return tokenDiff(a.split(/(\s+)/), b.split(/(\s+)/));
}

export function byteDiff(a: string, b: string): DiffRow[] {
  return tokenDiff([...a], [...b]);
}
