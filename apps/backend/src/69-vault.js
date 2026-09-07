

const VAULT_FILE = () => node_path.join(electron.app.getPath("userData"), "vault.bin");

let vaultCache = null;

function vaultEmpty() {
  return { entries: [] };
}

async function readVault() {
  if (vaultCache) return vaultCache;
  try {
    const blob = await promises.readFile(VAULT_FILE());
    const parsed = JSON.parse(electron.safeStorage.decryptString(blob));
    vaultCache = parsed && Array.isArray(parsed.entries) ? parsed : vaultEmpty();
  } catch {
    vaultCache = vaultEmpty();
  }
  return vaultCache;
}

async function writeVault(next) {
  vaultCache = next;
  try {
    if (!electron.safeStorage.isEncryptionAvailable()) {
      return { ok: false, error: "This system cannot encrypt secrets, so the vault was not saved." };
    }
    await writeFileAtomic(VAULT_FILE(), electron.safeStorage.encryptString(JSON.stringify(next)));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error) };
  }
}

const VAULT_KINDS = new Set(["bearer", "header", "cookie", "basic"]);

function vaultPublic(entry) {

  return {
    id: entry.id,
    name: entry.name,
    kind: entry.kind,
    headerName: entry.headerName || "",
    note: entry.note || "",
    updatedAt: entry.updatedAt || 0,
  };
}

function vaultHeaders(entry) {
  if (!entry) return [];
  const secret = String(entry.secret || "");
  if (!secret) return [];
  if (entry.kind === "bearer") return [["Authorization", `Bearer ${secret}`]];
  if (entry.kind === "basic") return [["Authorization", `Basic ${Buffer.from(secret, "utf8").toString("base64")}`]];
  if (entry.kind === "cookie") return [["Cookie", secret]];
  return [[String(entry.headerName || "Authorization"), secret]];
}

let vaultSeq = 0;

function registerVaultHandlers() {
  electron.ipcMain.handle("vault:list", async () => {
    const vault = await readVault();
    return { ok: true, entries: vault.entries.map(vaultPublic) };
  });

  electron.ipcMain.handle("vault:save", async (_event, input) => {
    const source = input && typeof input === "object" ? input : {};
    const name = String(source.name || "").trim();
    if (!name) return { ok: false, error: "The credential needs a name." };
    const kind = VAULT_KINDS.has(source.kind) ? source.kind : "bearer";
    const secret = String(source.secret ?? "");

    const vault = await readVault();
    const entries = vault.entries.slice();
    const id = String(source.id || "");
    const at = entries.findIndex((entry) => entry.id === id);

    if (at >= 0) {
      entries[at] = {
        ...entries[at],
        name,
        kind,
        headerName: String(source.headerName || ""),
        note: String(source.note || ""),

        secret: secret || entries[at].secret,
        updatedAt: Date.now(),
      };
    } else {
      if (!secret) return { ok: false, error: "The credential needs a secret." };
      vaultSeq += 1;
      entries.push({
        id: `v-${Date.now()}-${vaultSeq}`,
        name,
        kind,
        headerName: String(source.headerName || ""),
        note: String(source.note || ""),
        secret,
        updatedAt: Date.now(),
      });
    }

    const written = await writeVault({ ...vault, entries });
    if (!written.ok) return written;
    return { ok: true, entries: entries.map(vaultPublic) };
  });

  electron.ipcMain.handle("vault:remove", async (_event, id) => {
    const vault = await readVault();
    const entries = vault.entries.filter((entry) => entry.id !== String(id || ""));
    const written = await writeVault({ ...vault, entries });
    if (!written.ok) return written;
    return { ok: true, entries: entries.map(vaultPublic) };
  });

  electron.ipcMain.handle("vault:headers", async (_event, id) => {
    const vault = await readVault();
    const entry = vault.entries.find((item) => item.id === String(id || ""));
    if (!entry) return { ok: false, error: "That credential is gone." };
    return { ok: true, headers: vaultHeaders(entry) };
  });
}
