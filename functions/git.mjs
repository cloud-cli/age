// functions used by the workspace API via AI function calls to interact with a git repository
export function CloneRepository(/*string*/ repoUrl, /*string*/ targetPath) {
  const { execSync } = require("child_process");
  execSync(`git clone ${repoUrl} ${targetPath}`);
  return true;
}

export function CommitChanges(/*string*/ repoPath, /*string*/ message) {
  const { execSync } = require("child_process");
  execSync(`git -C ${repoPath} add .`);
  execSync(`git -C ${repoPath} commit -m "${message}"`);
  return true;
}

export function PushChanges(
  /*string*/ repoPath,
  /*string*/ remote = "origin",
  /*string*/ branch = "main",
) {
  const { execSync } = require("child_process");
  execSync(`git -C ${repoPath} push ${remote} ${branch}`);
  return true;
}

export function PullChanges(
  /*string*/ repoPath,
  /*string*/ remote = "origin",
  /*string*/ branch = "main",
) {
  const { execSync } = require("child_process");
  execSync(`git -C ${repoPath} pull ${remote} ${branch}`);
  return true;
}

export const functions = {
  CloneRepository,
  CommitChanges,
  PushChanges,
  PullChanges,
};
