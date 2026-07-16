import { exec } from "@cloud-cli/exec";

export async function ShellExec(/*string[]*/ args) {
  "## Runs a shell command in the current workspace. 'args' are a list of strings, e.g. ['ls', '-lah'] ##";
  if (!Array.isArray(args)) {
    throw new Error("Invalid arguments list: " + JSON.String(args));
  }

  for (const arg of args) {
    if (arg.includes("..") || arg.trim().startsWith("/")) {
      throw new Error("Access outside the designated workspace is forbidden.");
    }
  }

  const options = { cwd: this.getPath("."), encoding: "utf8" };
  const [command, ...rest] = args;

  const sh = await exec(command, rest, options);

  if (sh.ok) {
    return sh.stdout;
  }

  throw new Error(`Command ${command} failed with code ${sh.code}: ${sh.error || sh.stderr}`);
}
