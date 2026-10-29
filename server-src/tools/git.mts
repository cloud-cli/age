import { exec } from "@cloud-cli/exec";
import type { Context } from "../agents.mjs";
import { clonePublicRepository as cloneRepository } from "./git-repository.mjs";

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
  return (await cloneRepository.call(this, repoUrl, targetPath)).output;
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
