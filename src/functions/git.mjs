// functions used by the workspace API via AI function calls to interact with a git repository
export function CloneRepository(/*string*/ repoUrl, /*string*/ targetPath) {
  '## Clones a git repository from the specified URL into the target path. ##';
  const { execSync } = require("child_process");
  execSync(`git clone ${repoUrl} ${targetPath}`);
  return true;
}

export function CommitChanges(/*string*/ repoPath, /*string*/ message) {
  '## Commits all changes in the specified repository path with the given commit message. ##';
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
  '## Pushes committed changes from the specified repository path to the given remote and branch. ##';
  const { execSync } = require("child_process");
  execSync(`git -C ${repoPath} push ${remote} ${branch}`);
  return true;
}

export function PullChanges(
  /*string*/ repoPath,
  /*string*/ remote = "origin",
  /*string*/ branch = "main",
) {
  '## Pulls the latest changes from the specified remote and branch into the given repository path. ##';
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
