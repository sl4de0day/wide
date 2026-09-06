

const CODEBERG_HOST = "codeberg.org";

async function requireSourceControl() {
  if ((await extensionInstalled("codeberg")) || (await extensionInstalled("github"))) return null;
  return { installed: false, error: "That extension is not installed." };
}

const credentialHost = (host) => {
  const value = String(host || "").trim().toLowerCase();
  return /^[a-z0-9.-]+$/.test(value) ? value : CODEBERG_HOST;
};
const GIT_TIMEOUT_MS = 20000;

const GIT_NETWORK_TIMEOUT_MS = 120000;
const GIT_MAX_BUFFER = 16 * 1024 * 1024;

const gitEnv = () => ({
  ...process.env,
  GIT_TERMINAL_PROMPT: "0",
  GIT_OPTIONAL_LOCKS: "0",
  LC_ALL: "C",
});

function runGit(args, cwd, { input = null, timeout = GIT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = node_child_process.spawn("git", args, {
        cwd: cwd || undefined,
        env: gitEnv(),
        shell: false,
        windowsHide: true,
      });
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: "", stderr: String(error.message || error) });
      return;
    }

    let stdout = "";
    let stderr = "";
    let over = 0;
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(() => {
      killProcessTree(child);
      finish({ ok: false, code: -1, stdout, stderr, timedOut: true });
    }, timeout);

    child.stdout.on("data", (chunk) => {
      over += chunk.length;
      if (over <= GIT_MAX_BUFFER) stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 64 * 1024) stderr += chunk;
    });
    child.on("error", (error) =>
      finish({ ok: false, code: -1, stdout, stderr: String(error.message || error) })
    );
    child.on("close", (code) =>
      finish({ ok: code === 0, code: code ?? -1, stdout, stderr })
    );

    if (input !== null) {

      child.stdin.on("error", () => {});
      child.stdin.end(input);
    } else {
      child.stdin.end();
    }
  });
}

function classifyGitError(result) {
  const text = `${result.stderr}\n${result.stdout}`;
  if (result.timedOut) return "timeout";
  if (/could not read Username|Authentication failed|terminal prompts disabled|invalid credentials/i.test(text))
    return "auth";
  if (/repository .* not found|does not appear to be a git repository|Repository not found/i.test(text))
    return "no-remote-repo";
  if (/Could not resolve host|unable to access|Failed to connect|network is unreachable/i.test(text))
    return "network";
  if (/rejected].*(fetch first|non-fast-forward)|Updates were rejected/is.test(text))
    return "behind";
  if (/CONFLICT|Automatic merge failed|would be overwritten by merge/i.test(text))
    return "conflict";
  if (/no upstream|has no upstream branch/i.test(text)) return "no-upstream";
  if (/Please tell me who you are|unable to auto-detect email/i.test(text)) return "no-identity";
  if (/nothing to commit/i.test(text)) return "nothing-to-commit";
  return "";
}

function gitMessage(result) {
  const line = String(result.stderr || result.stdout)
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.length > 0);
  return line || "git failed";
}

const gitFailure = (result) => ({
  ok: false,
  reason: classifyGitError(result),
  error: gitMessage(result),
});

function parseStatus(stdout) {
  const branch = { name: "", upstream: "", ahead: 0, behind: 0, detached: false };
  const files = [];

  for (const raw of stdout.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (!line) continue;

    if (line.startsWith("# branch.head ")) {
      const head = line.slice("# branch.head ".length);

      branch.detached = head === "(detached)";
      branch.name = branch.detached ? "" : head;
      continue;
    }
    if (line.startsWith("# branch.upstream ")) {
      branch.upstream = line.slice("# branch.upstream ".length);
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const counts = line.slice("# branch.ab ".length).match(/\+(\d+)\s+-(\d+)/);
      if (counts) {
        branch.ahead = Number(counts[1]);
        branch.behind = Number(counts[2]);
      }
      continue;
    }

    if (line.startsWith("1 ")) {
      const parts = line.split(" ");
      const path = parts.slice(8).join(" ");
      files.push({ path, index: parts[1][0], work: parts[1][1] });
      continue;
    }

    if (line.startsWith("2 ")) {
      const parts = line.split(" ");
      const rest = parts.slice(9).join(" ");
      const [path, from] = rest.split("\t");
      files.push({ path, index: parts[1][0], work: parts[1][1], from: from || "" });
      continue;
    }

    if (line.startsWith("u ")) {
      const parts = line.split(" ");
      files.push({ path: parts.slice(10).join(" "), index: "U", work: "U" });
      continue;
    }
    if (line.startsWith("? ")) {
      files.push({ path: line.slice(2), index: "?", work: "?" });
    }

  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return { branch, files };
}

async function readIdentity(root) {
  const [name, email] = await Promise.all([
    runGit(["config", "--get", "user.name"], root),
    runGit(["config", "--get", "user.email"], root),
  ]);
  return {
    name: name.ok ? name.stdout.trim() : "",
    email: email.ok ? email.stdout.trim() : "",
  };
}

async function writeConfig(root, key, value, global) {
  const scope = global ? "--global" : "--local";
  const modern = await runGit(["config", "set", scope, key, value], root);
  if (modern.ok) return modern;
  if (/unknown subcommand|usage: git config/i.test(modern.stderr)) {
    return runGit(["config", scope, key, value], root);
  }
  return modern;
}

async function isRepository(root) {
  const result = await runGit(["rev-parse", "--is-inside-work-tree"], root);
  return result.ok && result.stdout.trim() === "true";
}

function registerCodebergHandlers() {

  electron.ipcMain.handle("codeberg:status", async (_event, root) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { installed: true, available: false, reason: "no-project" };

    const version = await runGit(["--version"], root);
    if (!version.ok) {
      return { installed: true, available: false, reason: "no-git" };
    }
    if (!(await isRepository(root))) {
      return { installed: true, available: true, repository: false };
    }

    const [status, remote, identity] = await Promise.all([
      runGit(["status", "--porcelain=v2", "--branch"], root),
      runGit(["remote", "get-url", "--all", "origin"], root),
      readIdentity(root),
    ]);
    if (!status.ok) {
      return { installed: true, available: true, repository: true, ...gitFailure(status) };
    }

    const parsed = parseStatus(status.stdout);
    const origin = remote.ok ? remote.stdout.trim().split("\n")[0].trim() : "";
    return {
      installed: true,
      available: true,
      repository: true,
      ok: true,
      branch: parsed.branch,
      files: parsed.files,
      remote: origin,

      codeberg: origin.includes(CODEBERG_HOST),
      identity,
    };
  });

  electron.ipcMain.handle("codeberg:stage", async (_event, root, paths) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    const list = (Array.isArray(paths) ? paths : []).filter((path) => typeof path === "string" && path);
    if (!root || list.length === 0) return { ok: false, error: "Nothing to stage." };

    const result = await runGit(["add", "--", ...list], root);
    return result.ok ? { ok: true } : gitFailure(result);
  });

  electron.ipcMain.handle("codeberg:unstage", async (_event, root, paths) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    const list = (Array.isArray(paths) ? paths : []).filter((path) => typeof path === "string" && path);
    if (!root || list.length === 0) return { ok: false, error: "Nothing to unstage." };

    const result = await runGit(["restore", "--staged", "--", ...list], root);
    return result.ok ? { ok: true } : gitFailure(result);
  });

  electron.ipcMain.handle("codeberg:commit", async (_event, root, message, amend) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    const text = String(message || "").trim();
    if (!root) return { ok: false, error: "No project is open." };
    if (!text) return { ok: false, error: "A commit needs a message." };

    const args = ["commit", "-m", text];
    if (amend) args.push("--amend");
    const result = await runGit(args, root);
    if (result.ok) {
      const head = await runGit(["log", "-1", "--pretty=%h %s"], root);
      return { ok: true, head: head.ok ? head.stdout.trim() : "" };
    }
    return gitFailure(result);
  });

  electron.ipcMain.handle("codeberg:push", async (_event, root, withTags) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };

    const head = await runGit(["symbolic-ref", "--short", "HEAD"], root);
    if (!head.ok) return { ok: false, reason: "detached", error: "HEAD is not on a branch." };
    const branch = head.stdout.trim();

    const result = await runGit(["push", "-u", "origin", branch], root, {
      timeout: GIT_NETWORK_TIMEOUT_MS,
    });
    if (!result.ok) return gitFailure(result);

    if (withTags) {

      const tags = await runGit(["push", "--tags", "origin"], root, {
        timeout: GIT_NETWORK_TIMEOUT_MS,
      });
      if (!tags.ok) return { ok: true, branch, tagsFailed: gitMessage(tags) };
    }
    return { ok: true, branch };
  });

  electron.ipcMain.handle("codeberg:pull", async (_event, root) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };

    const result = await runGit(["pull", "--ff-only"], root, {
      timeout: GIT_NETWORK_TIMEOUT_MS,
    });
    return result.ok ? { ok: true, output: result.stdout.trim() } : gitFailure(result);
  });

  electron.ipcMain.handle("codeberg:init", async (_event, root, branch) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };
    if (await isRepository(root)) return { ok: false, error: "This is already a repository." };

    const name = /^[A-Za-z0-9._\/-]{1,100}$/.test(String(branch || "")) ? String(branch) : "main";
    const result = await runGit(["init", "-b", name], root);
    return result.ok ? { ok: true, branch: name } : gitFailure(result);
  });

  electron.ipcMain.handle("codeberg:setRemote", async (_event, root, url) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };

    const address = String(url || "").trim();

    const https = /^https:\/\/[A-Za-z0-9.-]+\/[^\s]+$/.test(address);
    const ssh = /^(ssh:\/\/)?git@[A-Za-z0-9.-]+[:\/][^\s]+$/.test(address);
    if (!https && !ssh) {
      return { ok: false, error: "That is not a Codeberg repository address." };
    }

    if (/^https:\/\/[^\/@]+@/.test(address)) {
      return { ok: false, reason: "token-in-url", error: "Sign in instead of putting a token in the address." };
    }

    const existing = await runGit(["remote", "get-url", "origin"], root);
    const result = existing.ok
      ? await runGit(["remote", "set-url", "origin", address], root)
      : await runGit(["remote", "add", "origin", address], root);
    return result.ok ? { ok: true, remote: address } : gitFailure(result);
  });

  electron.ipcMain.handle("codeberg:identity", async (_event, root, name, email) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (name === undefined && email === undefined) {
      return { ok: true, identity: await readIdentity(root) };
    }
    const person = String(name || "").trim();
    const address = String(email || "").trim();
    if (!person || !address) return { ok: false, error: "A name and an email address are both needed." };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return { ok: false, error: "That is not an email address." };

    const wroteName = await writeConfig(root, "user.name", person, true);
    if (!wroteName.ok) return gitFailure(wroteName);
    const wroteEmail = await writeConfig(root, "user.email", address, true);
    if (!wroteEmail.ok) return gitFailure(wroteEmail);
    return { ok: true, identity: { name: person, email: address } };
  });

  electron.ipcMain.handle("codeberg:signIn", async (_event, username, token, host) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    const target = credentialHost(host);
    const user = String(username || "").trim();
    const secret = String(token || "");
    if (!user || !secret) return { ok: false, error: "A username and a token are both needed." };

    const helper = await runGit(["config", "--get", "credential.helper"], null);
    let configured = helper.ok && helper.stdout.trim().length > 0;
    if (!configured) {

      const set = await writeConfig(null, "credential.helper", "manager", true);
      configured = set.ok;
      if (!configured) return { ok: false, error: "Git has nowhere to keep the token." };
    }

    const result = await runGit(["credential", "approve"], null, {
      input: `protocol=https\nhost=${target}\nusername=${user}\npassword=${secret}\n\n`,
    });

    if (!result.ok) return gitFailure(result);
    return { ok: true, username: user, helperAdded: !helper.ok || !helper.stdout.trim() };
  });

  electron.ipcMain.handle("codeberg:signOut", async (_event, username, host) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    const target = credentialHost(host);
    const user = String(username || "").trim();
    const result = await runGit(["credential", "reject"], null, {
      input:
        `protocol=https\nhost=${target}\n` + (user ? `username=${user}\n` : "") + "\n",
    });
    return result.ok ? { ok: true } : gitFailure(result);
  });

  electron.ipcMain.handle("codeberg:signedIn", async (_event, host) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    const result = await runGit(["credential", "fill"], null, {
      input: `protocol=https\nhost=${credentialHost(host)}\n\n`,
      timeout: 5000,
    });
    if (!result.ok) return { ok: true, signedIn: false, username: "" };
    const user = result.stdout.match(/^username=(.*)$/m);

    return { ok: true, signedIn: Boolean(user), username: user ? user[1].trim() : "" };
  });

  electron.ipcMain.handle("codeberg:log", async (_event, root, limit) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };
    const count = Math.min(Math.max(Number(limit) || 20, 1), 200);

    const result = await runGit(
      ["log", `-${count}`, "--pretty=format:%h\x1f%an\x1f%ar\x1f%s", "--no-color"],
      root
    );
    if (!result.ok) {

      if (/does not have any commits yet|bad revision/i.test(result.stderr)) {
        return { ok: true, commits: [] };
      }
      return gitFailure(result);
    }
    const commits = result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, author, when, subject] = line.split("\x1f");
        return { hash, author, when, subject: subject || "" };
      });
    return { ok: true, commits };
  });

  electron.ipcMain.handle("codeberg:tag", async (_event, root, name, message, push) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };
    const tag = String(name || "").trim();

    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/.test(tag) || tag.includes("..")) {
      return { ok: false, error: "That is not a valid tag name." };
    }
    const result = await runGit(["tag", "-a", tag, "-m", String(message || tag)], root);
    if (!result.ok) return gitFailure(result);
    if (!push) return { ok: true, tag };

    const pushed = await runGit(["push", "origin", tag], root, {
      timeout: GIT_NETWORK_TIMEOUT_MS,
    });
    return pushed.ok ? { ok: true, tag, pushed: true } : { ok: true, tag, pushFailed: gitMessage(pushed) };
  });

  electron.ipcMain.handle("codeberg:diff", async (_event, root, path, staged) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };
    const file = String(path || "");
    if (!file) return { ok: false, error: "No file given." };
    const args = ["diff", "--no-color"];
    if (staged) args.push("--staged");
    args.push("--", file);
    const result = await runGit(args, root);
    return result.ok ? { ok: true, diff: result.stdout } : gitFailure(result);
  });

  electron.ipcMain.handle("codeberg:branches", async (_event, root) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };
    const result = await runGit(
      ["for-each-ref", "--format=%(HEAD)\x1f%(refname:short)", "refs/heads"],
      root,
    );
    if (!result.ok) return gitFailure(result);
    const branches = result.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [head, name] = line.split("\x1f");
        return { name: name || "", current: head === "*" };
      });
    return { ok: true, branches };
  });

  electron.ipcMain.handle("codeberg:switch", async (_event, root, name, create) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };
    const branch = String(name || "").trim();

    if (!/^[A-Za-z0-9][A-Za-z0-9._\/-]{0,99}$/.test(branch) || branch.includes(".."))
      return { ok: false, error: "That is not a valid branch name." };
    const args = create ? ["switch", "-c", branch] : ["switch", branch];
    const result = await runGit(args, root);
    return result.ok ? { ok: true, branch } : gitFailure(result);
  });

  electron.ipcMain.handle("codeberg:stash", async (_event, root, action, ref) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    if (!root) return { ok: false, error: "No project is open." };
    let args;
    if (action === "pop") args = ["stash", "pop"];
    else if (action === "apply") args = ["stash", "apply"];
    else if (action === "drop") args = ["stash", "drop", ...(typeof ref === "string" && ref ? [ref] : [])];
    else if (action === "list") args = ["stash", "list"];
    else args = ["stash", "push", "-u", ...(typeof ref === "string" && ref.trim() ? ["-m", ref.trim()] : [])];
    const result = await runGit(args, root);
    if (!result.ok) return gitFailure(result);
    if (action === "list") {
      const entries = result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          const at = line.indexOf(":");
          const ref2 = line.slice(0, at).trim();
          return { ref: ref2, description: line.slice(at + 1).trim() };
        });
      return { ok: true, entries };
    }
    return { ok: true, output: result.stdout.trim() };
  });

  electron.ipcMain.handle("codeberg:clone", async (_event, url, parentDir, folder) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    const remote = String(url || "").trim();
    if (!/^(https?:\/\/|git@|ssh:\/\/)/.test(remote)) {
      return { ok: false, error: "Enter an http(s), git@, or ssh URL." };
    }
    if (!parentDir || typeof parentDir !== "string") return { ok: false, error: "Choose where to clone it." };
    const name =
      typeof folder === "string" && /^[A-Za-z0-9._-]{1,100}$/.test(folder.trim())
        ? folder.trim()
        : (remote.split(/[\/]/).pop() || "repo").replace(/\.git$/, "");
    const target = node_path.join(parentDir, name);
    const result = await runGit(["clone", remote, target], parentDir, { timeout: GIT_NETWORK_TIMEOUT_MS });
    return result.ok ? { ok: true, path: target } : gitFailure(result);
  });

  electron.ipcMain.handle("codeberg:discard", async (_event, root, paths) => {
    const gate = await requireSourceControl();
    if (gate) return gate;
    const list = (Array.isArray(paths) ? paths : []).filter((p) => typeof p === "string" && p);
    if (!root || list.length === 0) return { ok: false, error: "Nothing to discard." };
    const result = await runGit(["restore", "--worktree", "--", ...list], root);
    return result.ok ? { ok: true } : gitFailure(result);
  });
}
