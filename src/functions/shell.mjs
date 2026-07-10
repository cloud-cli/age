import { execSync } from "node:child_process";

export function ShellExec(/*string*/ command) {
  "## Runs a shell command in the current workspace ##";
  const options = { cwd: this.getPath("."), encoding: "utf8" };
  return String(execSync(command, options));
}

export const functions = {
  ShellExec,
};
