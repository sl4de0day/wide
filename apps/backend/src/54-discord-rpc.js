'use strict';

const DISCORD_CLIENT_ID = "1565739058045653133";
const DISCORD_RECONNECT_INTERVAL_MS = 15000;
const DISCORD_UPDATE_DEBOUNCE_MS = 1500;
const DISCORD_DEFAULT_LOGO = "https://raw.githubusercontent.com/sl4de0day/wide-ide/main/assets/logo.png";
const DISCORD_REPO_URL = "https://github.com/sl4de0day/wide-ide";

let discordSocket = null;
let discordConnected = false;
let discordConnecting = false;
let discordPendingActivity = null;
let discordLastActivity = null;
let discordReconnectTimer = null;
let discordDebounceTimer = null;
let discordBuffer = Buffer.alloc(0);

function getDiscordPipePaths() {
  if (process.platform === "win32") {
    const paths = [];
    for (let i = 0; i < 10; i++) {
      paths.push(`\\\\.\\pipe\\discord-ipc-${i}`);
    }
    return paths;
  }

  const env = process.env;
  const dirs = [
    env.XDG_RUNTIME_DIR,
    env.TMPDIR,
    env.TMP,
    env.TEMP,
    "/tmp",
  ].filter(Boolean);

  const paths = [];
  for (const dir of dirs) {
    for (let i = 0; i < 10; i++) {
      paths.push(node_path.join(dir, `discord-ipc-${i}`));
    }
    for (let i = 0; i < 10; i++) {
      paths.push(node_path.join(dir, "app", "com.discordapp.Discord", `discord-ipc-${i}`));
    }
  }
  return paths;
}

function sendDiscordFrame(opcode, data) {
  if (!discordSocket || !discordSocket.writable) return false;
  try {
    const jsonStr = JSON.stringify(data);
    const byteLen = Buffer.byteLength(jsonStr, "utf8");
    const packet = Buffer.allocUnsafe(8 + byteLen);
    packet.writeInt32LE(opcode, 0);
    packet.writeInt32LE(byteLen, 4);
    packet.write(jsonStr, 8, byteLen, "utf8");
    discordSocket.write(packet);
    return true;
  } catch (err) {
    return false;
  }
}

function sendDiscordHandshake() {
  sendDiscordFrame(0, { v: 1, client_id: DISCORD_CLIENT_ID });
}

function applyDiscordActivity(activity) {
  if (!discordConnected) {
    discordPendingActivity = activity;
    return;
  }
  discordLastActivity = activity;
  const pid = process.pid;
  if (!activity) {
    sendDiscordFrame(1, {
      cmd: "SET_ACTIVITY",
      args: { pid, activity: null },
      nonce: String(Date.now()),
    });
    return;
  }

  const buttons = [];
  if (activity.buttonUrl) {
    buttons.push({ label: activity.buttonLabel || "Wide IDE", url: activity.buttonUrl });
  }

  const assets = {
    large_image: activity.largeImage || DISCORD_DEFAULT_LOGO,
    large_text: activity.largeText || "Wide — Security-first IDE",
  };
  if (activity.smallImage) assets.small_image = activity.smallImage;
  if (activity.smallText) assets.small_text = activity.smallText;

  const payload = {
    cmd: "SET_ACTIVITY",
    args: {
      pid,
      activity: {
        details: activity.details || undefined,
        state: activity.state || undefined,
        timestamps: activity.startTimestamp ? { start: activity.startTimestamp } : undefined,
        assets,
        buttons: buttons.length > 0 ? buttons : undefined,
      },
    },
    nonce: String(Date.now()),
  };
  sendDiscordFrame(1, payload);
}

function queueDiscordActivity(activity) {
  discordPendingActivity = activity;
  if (discordDebounceTimer) clearTimeout(discordDebounceTimer);
  discordDebounceTimer = setTimeout(() => {
    discordDebounceTimer = null;
    applyDiscordActivity(discordPendingActivity);
  }, DISCORD_UPDATE_DEBOUNCE_MS);
}

function handleDiscordIncomingData(chunk) {
  discordBuffer = Buffer.concat([discordBuffer, chunk]);
  while (discordBuffer.length >= 8) {
    const opcode = discordBuffer.readInt32LE(0);
    const length = discordBuffer.readInt32LE(4);
    if (discordBuffer.length < 8 + length) {
      break;
    }
    const payloadBytes = discordBuffer.subarray(8, 8 + length);
    discordBuffer = discordBuffer.subarray(8 + length);

    try {
      const msg = JSON.parse(payloadBytes.toString("utf8"));
      if (opcode === 1) {
        if (msg.evt === "READY") {
          discordConnected = true;
          discordConnecting = false;
          if (discordPendingActivity) {
            applyDiscordActivity(discordPendingActivity);
          }
        }
      } else if (opcode === 3) {
        sendDiscordFrame(4, msg);
      } else if (opcode === 2) {
        discordDisconnect();
      }
    } catch {}
  }
}

function discordDisconnect() {
  discordConnected = false;
  discordConnecting = false;
  if (discordSocket) {
    try {
      discordSocket.destroy();
    } catch {}
    discordSocket = null;
  }
  discordBuffer = Buffer.alloc(0);
}

async function tryConnectDiscordPipe(pipePath) {
  return new Promise((resolve) => {
    let settled = false;
    let sock;
    try {
      sock = node_net.connect(pipePath, () => {
        if (settled) return;
        settled = true;
        resolve(sock);
      });
    } catch {
      return resolve(null);
    }
    sock.once("error", () => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch {}
      resolve(null);
    });
    setTimeout(() => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch {}
      resolve(null);
    }, 1000);
  });
}

async function connectToDiscord() {
  if (discordConnected || discordConnecting) return;
  if (!(await extensionInstalled("discord-presence"))) return;

  discordConnecting = true;
  const pipes = getDiscordPipePaths();
  let activeSocket = null;

  for (const pipe of pipes) {
    activeSocket = await tryConnectDiscordPipe(pipe);
    if (activeSocket) break;
  }

  if (!activeSocket) {
    discordConnecting = false;
    scheduleDiscordReconnect();
    return;
  }

  discordSocket = activeSocket;
  discordSocket.on("data", handleDiscordIncomingData);
  discordSocket.on("error", () => {
    discordDisconnect();
    scheduleDiscordReconnect();
  });
  discordSocket.on("close", () => {
    discordDisconnect();
    scheduleDiscordReconnect();
  });

  sendDiscordHandshake();
}

function scheduleDiscordReconnect() {
  if (discordReconnectTimer) return;
  discordReconnectTimer = setTimeout(async () => {
    discordReconnectTimer = null;
    if (await extensionInstalled("discord-presence")) {
      connectToDiscord();
    }
  }, DISCORD_RECONNECT_INTERVAL_MS);
}

function discordRpcShutdown() {
  if (discordReconnectTimer) {
    clearTimeout(discordReconnectTimer);
    discordReconnectTimer = null;
  }
  if (discordDebounceTimer) {
    clearTimeout(discordDebounceTimer);
    discordDebounceTimer = null;
  }
  if (discordConnected && discordSocket) {
    try {
      sendDiscordFrame(1, {
        cmd: "SET_ACTIVITY",
        args: { pid: process.pid, activity: null },
        nonce: String(Date.now()),
      });
    } catch {}
  }
  discordDisconnect();
}

function registerDiscordRpcHandlers() {
  electron.ipcMain.handle("discord:status", async () => {
    const installed = await extensionInstalled("discord-presence");
    return { ok: true, connected: discordConnected, enabled: installed };
  });

  electron.ipcMain.handle("discord:setActivity", async (_event, activity) => {
    const installed = await extensionInstalled("discord-presence");
    if (!installed) return { ok: false, error: "Discord presence extension is not installed." };
    if (!discordConnected && !discordConnecting) {
      void connectToDiscord();
    }
    queueDiscordActivity(activity);
    return { ok: true };
  });

  electron.ipcMain.handle("discord:clear", async () => {
    discordPendingActivity = null;
    applyDiscordActivity(null);
    return { ok: true };
  });

  if (typeof onExtensionChange === "function") {
    onExtensionChange((installedSet) => {
      if (installedSet.has("discord-presence")) {
        if (!discordConnected && !discordConnecting) {
          void connectToDiscord();
        }
      } else {
        discordRpcShutdown();
      }
    });
  }

  readInstalled().then((installed) => {
    if (installed.has("discord-presence")) {
      void connectToDiscord();
    }
  }).catch(() => {});
}

