import { spawn } from "node:child_process";
export async function ShellExec(this: any, /*string*/ command) {
  "##Runs a model-capable shell command in the workspace; approval gated, timed and output bounded.##";
  return await new Promise((resolve) => {
    const child = spawn(process.env.SHELL || "/bin/sh", ["-c", command], {
      cwd: this.getPath("."),
      env: { PATH: process.env.PATH || "/usr/bin:/bin", HOME: this.workspacePath, LANG: "C.UTF-8" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    const add = (chunk) => {
      if (size < 50000) {
        const b = chunk.subarray(0, 50000 - size);
        chunks.push(b);
        size += b.length;
      }
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, 15000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, timedOut, output: Buffer.concat(chunks).toString("utf8"), truncated: size >= 50000 });
    });
  });
}
