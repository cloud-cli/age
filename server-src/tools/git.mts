import { exec } from "@cloud-cli/exec";
import type { Context } from "../agents.mjs";
import { clonePublicRepository as cloneRepository } from "./git-repository.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { authenticatedPullPlan, gitRemoteArgs, pushDestinationRef, remoteOptions } from "./gitmini-auth.mjs";
const execFileAsync = promisify(execFile);

type WorkspaceContext = Pick<Context, "getPath" | "workspacePath" | "subject" | "taskId">;

async function runGit(remote: { options: any; authenticated: boolean }, args: string[]) {
  if (!remote.authenticated) {
    return exec("git", args, remote.options);
  }
  try {
    return await execFileAsync("git", args, { ...remote.options, timeout: 120000, maxBuffer: 1_000_000 });
  } catch {
    throw new Error("Authenticated GitMini operation failed");
  }
}

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
  /*string*/ remote = "",
  /*string*/ branch = "",
) {
  "## Pushes committed changes; defaults to the GitMini remote when linked, otherwise origin. Without a branch, pushes HEAD to GitMini main (or main for another remote). ##";
  if (this.taskId) {
    throw new Error("Task agents cannot push or pull");
  }
  const selected = await remoteOptions(this, remote);
  validateRemote(selected.remote);
  const options = selected.options;
  const targetBranch = branch || "main";
  await validateBranch(targetBranch, { cwd: options.cwd });
  const path = repositoryPath(this, repoPath);
  const pushRef = pushDestinationRef(selected.remote, branch);
  const args = gitRemoteArgs(path, "push", selected.remote, pushRef, selected.authenticated);
  const sh = await runGit(selected, args);
  return sh.stdout;
}

export async function PullChanges(
  this: WorkspaceContext,
  /*string*/ repoPath: string,
  /*string*/ remote = "",
  /*string*/ branch = "main",
) {
  "## Pulls the latest changes into the repository path; defaults to the GitMini remote when linked, otherwise origin. ##";
  if (this.taskId) {
    throw new Error("Task agents cannot push or pull");
  }
  const selected = await remoteOptions(this, remote);
  validateRemote(selected.remote);
  const options = selected.options;
  await validateBranch(branch, { cwd: options.cwd });
  const path = repositoryPath(this, repoPath);
  if (selected.authenticated) {
    const plan = authenticatedPullPlan(path, selected.remote, branch);
    const fetched = await runGit(selected, plan.fetchArgs);
    const merged = await exec("git", plan.mergeArgs, plan.mergeOptions);
    return `${fetched.stdout}${fetched.stdout && merged.stdout ? "\n" : ""}${merged.stdout}`;
  }
  const args = gitRemoteArgs(path, "pull", selected.remote, branch, selected.authenticated);
  const sh = await runGit(selected, args);
  return sh.stdout;
}
