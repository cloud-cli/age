import { exec } from "@cloud-cli/exec";
import { resolve } from "node:path";

export async function ShellExec(/*string*/ command, /*string[]*/ args, /*string*/ cwd = '.') {
  "## Runs a single command in a shell with Node child_process.spawn. 'args' must be a list of strings, e.g. ShellExec('ls', ['-la']). Command chaining and pipes are not allowed. ##";

  if (typeof args === 'string') {
    try {
      args = JSON.parse(args);
    } catch (e) {
      console.error('ShellExecError', e);
    }
  }

  if (typeof command !== 'string' || !Array.isArray(args)) {
    throw new Error("Invalid arguments list: " + JSON.stringify([command, args]));
  }

  args = args.map((a) => {
    const arg = String(a);
    if (arg.includes("..") || arg.trim().startsWith("/")) {
      return this.getPath(resolve("/", arg.trim()));
    }

    return arg;
  });

  const options = { cwd: this.getPath(cwd), encoding: "utf8" };

  console.log("ShellExec", command, args);
  const sh = await exec(command, args, options);

  if (sh.ok) {
    return sh.stdout;
  }

  throw new Error(
    `Command ${command} failed with code ${sh.code}: ${sh.error + sh.stderr}`,
  );
}
