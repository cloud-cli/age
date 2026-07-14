import { exec } from "@cloud-cli/exec";

// functions used by the workspace API via AI function calls to interact with a git repository
export async function CloneRepository(/*string*/ repoUrl, /*string*/ targetPath) {
  "## Clones a git repository from the specified URL into the target path. ##";
  const options = { cwd: this.getPath(".") };
  const sh = await exec("git", ["clone", repoUrl, targetPath], options);
  return sh.stdout;
}

export async function CommitChanges(/*string*/ repoPath, /*string*/ message) {
  "## Commits all changes in the specified repository path with the given commit message. ##";
  const options = { cwd: this.getPath(".") };
  const a = await exec("git", ["-C", repoPath, "add", "."], options);
  const b = await exec("git", ["-C", repoPath, "commit", "-m", message], options);
  return a.stdout + "\n" + b.stdout;
}

export async function PushChanges(/*string*/ repoPath, /*string*/ remote = "origin", /*string*/ branch = "main") {
  "## Pushes committed changes from the specified repository path to the given remote and branch. ##";
  const options = { cwd: this.getPath(".") };
  const sh = await exec("git", ["-C", repoPath, "push", remote, branch], options);
  return sh.stdout;
}

export async function PullChanges(/*string*/ repoPath, /*string*/ remote = "origin", /*string*/ branch = "main") {
  "## Pulls the latest changes from the specified remote and branch into the given repository path. ##";
  const options = { cwd: this.getPath(".") };
  const sh = await exec("git", ["-C", repoPath, "pull", remote, branch], options);
  return sh.stdout;
}
