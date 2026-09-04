

export interface GitProvider {

  id: string;

  name: string;

  host: string;

  addressExample: string;
}

const KNOWN: Readonly<Record<string, Omit<GitProvider, "host">>> = {
  "github.com": { id: "github", name: "GitHub", addressExample: "https://github.com/you/project.git" },
  "codeberg.org": { id: "codeberg", name: "Codeberg", addressExample: "https://codeberg.org/you/project.git" },
  "gitlab.com": { id: "gitlab", name: "GitLab", addressExample: "https://gitlab.com/you/project.git" },
  "bitbucket.org": { id: "bitbucket", name: "Bitbucket", addressExample: "https://bitbucket.org/you/project.git" },
};

export function hostOfRemote(remote: string | null | undefined): string | null {
  const url = (remote ?? "").trim();
  if (!url) return null;

  const scp = /^[^@/]+@([^:/]+):/.exec(url);
  if (scp) return scp[1].toLowerCase();

  const scheme = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]+@)?([^:/]+)/i.exec(url);
  if (scheme) return scheme[1].toLowerCase();
  return null;
}

export function providerFor(remote: string | null | undefined): GitProvider {
  const host = hostOfRemote(remote);
  if (host && KNOWN[host]) return { ...KNOWN[host], host };
  if (host) return { id: "git", name: "Git", host, addressExample: "https://host/you/project.git" };

  return { ...KNOWN["codeberg.org"], host: "" };
}

export function providerById(id: string): GitProvider {
  for (const [host, meta] of Object.entries(KNOWN)) {
    if (meta.id === id) return { ...meta, host };
  }
  return { ...KNOWN["codeberg.org"], host: "" };
}
