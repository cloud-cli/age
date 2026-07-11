import { execSync } from "node:child_process";

// functions used by the workspace API via AI function calls to interact with a git repository
export function CloneRepository(/*string*/ repoUrl, /*string*/ targetPath) {
  "## Clones a git repository from the specified URL into the target path. ##";
  const options = { cwd: this.getPath(".") };
  execSync(`git clone ${repoUrl} ${targetPath}`, options);
  return true;
}

export function CommitChanges(/*string*/ repoPath, /*string*/ message) {
  "## Commits all changes in the specified repository path with the given commit message. ##";
  const options = { cwd: this.getPath(".") };
  execSync(`git -C ${repoPath} add .`, options);
  execSync(`git -C ${repoPath} commit -m "${message}"`, options);
  return true;
}

export function PushChanges(
  /*string*/ repoPath,
  /*string*/ remote = "origin",
  /*string*/ branch = "main",
) {
  "## Pushes committed changes from the specified repository path to the given remote and branch. ##";
  const options = { cwd: this.getPath(".") };
  execSync(`git -C ${repoPath} push ${remote} ${branch}`, options);
  return true;
}

export function PullChanges(
  /*string*/ repoPath,
  /*string*/ remote = "origin",
  /*string*/ branch = "main",
) {
  "## Pulls the latest changes from the specified remote and branch into the given repository path. ##";
  const options = { cwd: this.getPath(".") };
  execSync(`git -C ${repoPath} pull ${remote} ${branch}`, options);
  return true;
}
