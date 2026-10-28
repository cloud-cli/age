import { spawn } from "node:child_process";
import type { Context } from "../agents.mjs";

type WorkspaceContext = Pick<Context, "getPath" | "workspacePath">;
const maxCommandBytes = 10_000;
const maxOutputBytes = 50_000;

export async function ShellExec(this: WorkspaceContext, /*string*/ command: string) {
  "##Runs a model-capable shell command in the workspace; approval gated, timed and output bounded.##";
  if (Buffer.byteLength(command, "utf8") > maxCommandBytes) {
    throw new Error(`Shell command exceeds ${maxCommandBytes} bytes`);
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(process.env.SHELL || "/bin/sh", ["-c", command], {
      cwd: this.getPath("."),
      env: { PATH: process.env.PATH || "/usr/bin:/bin", HOME: this.workspacePath, LANG: "C.UTF-8" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const chunks: Buffer[] = [];
    let size = 0;
    let timedOut = false;
    let settled = false;
    const finish = (callback: () => void) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        callback();
      }
    };
    const add = (chunk: Buffer) => {
      if (size < maxOutputBytes) {
        const bounded = chunk.subarray(0, maxOutputBytes - size);
        chunks.push(bounded);
        size += bounded.length;
      }
    };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else {
        child.kill("SIGKILL");
      }
    }, 15_000);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) =>
      finish(() =>
        resolve({
          code,
          timedOut,
          output: Buffer.concat(chunks).toString("utf8"),
          truncated: size >= maxOutputBytes,
        }),
      ),
    );
  });
}
