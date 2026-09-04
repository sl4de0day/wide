

const FORMAT_TIMEOUT_MS = 10_000;
const FORMAT_MAX_BYTES = 4 * 1024 * 1024;

const EXTERNAL_FORMATTERS = {
  go: { command: "gofmt", args: [] },
  rs: { command: "rustfmt", args: ["--emit=stdout", "--edition=2021", "--quiet"] },
  py: { command: "black", args: ["-q", "-"] },
  pyi: { command: "black", args: ["-q", "-"] },
  rb: { command: "rubocop", args: ["--stdin", "buffer.rb", "-a", "--stderr", "--format", "quiet"] },
  ex: { command: "mix", args: ["format", "-"] },
  exs: { command: "mix", args: ["format", "-"] },
  erl: { command: "erlfmt", args: ["-"] },
  hrl: { command: "erlfmt", args: ["-"] },
  scala: { command: "scalafmt", args: ["--stdin"] },
  kt: { command: "ktlint", args: ["--format", "--stdin", "--log-level=none"] },
  kts: { command: "ktlint", args: ["--format", "--stdin", "--log-level=none"] },
  php: { command: "php-cs-fixer", args: ["fix", "--using-cache=no", "--quiet", "-"] },
  sql: { command: "sqlformat", args: ["-", "--reindent"] },
  java: { command: "google-java-format", args: ["-"] },
  cs: { command: "dotnet", args: ["format", "--include", "-"] },
};

async function prettierParserFor(filePath) {
  try {
    const info = await prettier.getFileInfo(filePath, { resolveConfig: false });
    return info.inferredParser ?? null;
  } catch {
    return null;
  }
}

async function formatWithPrettier(filePath, text) {
  const parser = await prettierParserFor(filePath);
  if (!parser) return null;

  let options = {};
  try {
    options = (await prettier.resolveConfig(filePath)) ?? {};
  } catch (error) {
    return { ok: false, error: `The Prettier config could not be read: ${error.message}` };
  }
  try {
    const formatted = await prettier.format(text, { ...options, filepath: filePath, parser });
    return { ok: true, text: formatted, formatter: `prettier (${parser})` };
  } catch (error) {

    return { ok: false, error: String(error.message ?? error).split("\n").slice(0, 3).join("\n") };
  }
}

function runExternal(command, args, input, cwd) {
  return new Promise((resolve) => {
    let child;
    try {
      child = node_child_process.spawn(command, args, {
        cwd,
        windowsHide: true,

        shell: process.platform === "win32",
      });
    } catch (error) {
      resolve({ ok: false, error: `${command} could not be started: ${error.message}` });
      return;
    }

    const decoder = new StringDecoder("utf8");
    let out = "";
    let err = "";
    let size = 0;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      killProcessTree(child);
      finish({ ok: false, error: `${command} did not answer within ${FORMAT_TIMEOUT_MS / 1000}s.` });
    }, FORMAT_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > FORMAT_MAX_BYTES) {
        clearTimeout(timer);
        killProcessTree(child);
        finish({ ok: false, error: `${command} produced more than 4 MB.` });
        return;
      }
      out += decoder.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      err += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      finish({
        ok: false,
        error:
          error.code === "ENOENT"
            ? `${command} is not on PATH. Install it, or format this file elsewhere.`
            : `${command} failed: ${error.message}`,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      out += decoder.end();
      if (code !== 0) {
        finish({
          ok: false,
          error: `${command} exited ${code}: ${err.trim().split("\n").slice(0, 3).join("\n") || "no message"}`,
        });
        return;
      }
      if (!out.trim()) {
        finish({ ok: false, error: `${command} returned nothing; the buffer was left alone.` });
        return;
      }
      finish({ ok: true, text: out, formatter: command });
    });

    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

function registerFormatHandlers() {

  electron.ipcMain.handle("format:text", async (_event, filePath, text, root) => {
    if (typeof filePath !== "string" || typeof text !== "string") {
      return { ok: false, error: "Nothing to format." };
    }

    const viaPrettier = await formatWithPrettier(filePath, text);
    if (viaPrettier) return viaPrettier;

    const extension = node_path.extname(filePath).slice(1).toLowerCase();
    const external = EXTERNAL_FORMATTERS[extension];
    if (!external) {
      return { ok: false, error: `Wide has no formatter for .${extension} files.`, unsupported: true };
    }
    return runExternal(external.command, external.args, text, root || node_path.dirname(filePath));
  });

}
