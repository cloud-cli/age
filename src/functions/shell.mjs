import { execSync } from "node:child_process";

export function ShellExec(/*string*/ command) {
  "## Clones a git repository from the specified URL into the target path. ##";
  const options = { cwd: this.getPath("."), encoding: "utf8" };
  return String(execSync(command, options));
}

export const functions = [ShellExec];
