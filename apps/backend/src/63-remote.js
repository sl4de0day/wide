

function registerRemoteHandlers() {

  electron.ipcMain.handle("remote:get", async () => {
    try {
      const config = await electron.hostRequest("remote:get", {});
      return { ok: true, config: config || {} };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });

  electron.ipcMain.handle("remote:set", async (_event, config) => {
    try {
      const saved = await electron.hostRequest("remote:set", config || {});
      return { ok: true, config: saved || {} };
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
  });
}
