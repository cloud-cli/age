import { exec } from "@cloud-cli/exec";
import { isIP } from "node:net";
import type { Context } from "../agents.mjs";
import { resolvePublicHost } from "./network-safety.mjs";

type WorkspaceContext = Pick<Context, "getPath" | "workspacePath">;

function repositoryPath(context: WorkspaceContext, path: string) {
  return context.getPath(path);
}

function validateRemote(remote: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remote) || remote === "." || remote === "..") {
    throw new Error("Remote must be a configured Git remote name");
  }
}

async function validateBranch(branch: string, options: { cwd: string }) {
  if (!branch || branch.startsWith("-")) {
    throw new Error("Invalid Git branch name");
  }
  await exec("git", ["check-ref-format", "--branch", branch], options);
}

// functions used by the workspace API via AI function calls to interact with a git repository
export async function CloneRepository(
  this: WorkspaceContext,
  /*string*/ repoUrl: string,
  /*string*/ targetPath: string,
) {
  "## Clones a public HTTPS Git repository into the specified workspace path. ##";
  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    throw new Error("Repository URL must be an HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Repository URL must use HTTPS without embedded credentials or query parameters");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) === 6) {
    throw new Error("IPv6 literal repository URLs are not supported");
  }
  const addresses = await resolvePublicHost(hostname);
  const address = addresses.find(({ family }) => family === 4);
  if (!address) {
    throw new Error("Git clone requires a public IPv4 destination");
  }
  const port = url.port || "443";
  const destination = repositoryPath(this, targetPath);
  const options = {
    cwd: this.getPath("."),
    env: {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: this.workspacePath,
      LANG: "C.UTF-8",
      GIT_ALLOW_PROTOCOL: "https",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  };
  const resolveConfig = `${hostname}:${port}:${address.address}`;
  const sh = await exec(
    "git",
    [
      "-c",
      `http.curloptResolve=${resolveConfig}`,
      "-c",
      "http.followRedirects=false",
      "-c",
      "http.sslVerify=true",
      "-c",
      "protocol.file.allow=never",
      "-c",
      "protocol.ext.allow=never",
      "-c",
      "core.hooksPath=/dev/null",
      "clone",
      "--",
      url.href,
      destination,
    ],
    options,
  );
  return sh.stdout;
}

export async function CommitChanges(this: WorkspaceContext, /*string*/ repoPath: string, /*string*/ message: string) {
  "## Commits all changes in the specified repository path with the given commit message. ##";
  const options = { cwd: this.getPath(".") };
  const path = repositoryPath(this, repoPath);
  const a = await exec("git", ["-C", path, "add", "--all"], options);
  const b = await exec("git", ["-C", path, "commit", "-m", message], options);
  return a.stdout + "\n" + b.stdout;
}

export async function PushChanges(
  this: WorkspaceContext,
  /*string*/ repoPath: string,
  /*string*/ remote = "origin",
  /*string*/ branch = "main",
) {
  "## Pushes committed changes from the specified repository path to the given remote and branch. ##";
  const options = { cwd: this.getPath(".") };
  validateRemote(remote);
  await validateBranch(branch, options);
  const path = repositoryPath(this, repoPath);
  const sh = await exec("git", ["-C", path, "push", remote, branch], options);
  return sh.stdout;
}

export async function PullChanges(
  this: WorkspaceContext,
  /*string*/ repoPath: string,
  /*string*/ remote = "origin",
  /*string*/ branch = "main",
) {
  "## Pulls the latest changes from the specified remote and branch into the given repository path. ##";
  const options = { cwd: this.getPath(".") };
  validateRemote(remote);
  await validateBranch(branch, options);
  const path = repositoryPath(this, repoPath);
  const sh = await exec("git", ["-C", path, "pull", remote, branch], options);
  return sh.stdout;
}
