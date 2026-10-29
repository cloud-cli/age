import { exec } from "@cloud-cli/exec";
import { isIP } from "node:net";
import type { Context } from "../agents.mjs";
import { resolvePublicHost } from "./network-safety.mjs";

type WorkspaceContext = Pick<Context, "getPath" | "workspacePath">;
type CloneDependencies = {
  resolvePublicHost?: typeof resolvePublicHost;
  runGit?: typeof exec;
};
type CloneError = Error & { statusCode: number; details: string };

export async function clonePublicRepository(
  this: WorkspaceContext,
  repoUrl: string,
  targetPath: string,
  dependencies: CloneDependencies = {},
) {
  let url: URL;
  try {
    if (typeof repoUrl !== "string" || repoUrl.length > 2048) {
      throw new Error();
    }
    url = new URL(repoUrl);
  } catch {
    throw new Error("Repository URL must be an HTTPS URL no longer than 2048 characters");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("Repository URL must use HTTPS without embedded credentials or query parameters");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Repository URLs must use HTTPS port 443");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname) === 6) {
    throw new Error("IPv6 literal repository URLs are not supported");
  }
  const addresses = await (dependencies.resolvePublicHost || resolvePublicHost)(hostname);
  const address = addresses.find(({ family }) => family === 4);
  if (!address) {
    throw new Error("Git clone requires a public IPv4 destination");
  }
  const port = url.port || "443";
  const destination = this.getPath(targetPath);
  const options = {
    cwd: this.getPath("."),
    env: {
      PATH: process.env.PATH || "/usr/bin:/bin",
      HOME: this.workspacePath,
      LANG: "C.UTF-8",
      GIT_ALLOW_PROTOCOL: "https",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    },
  };
  const resolveConfig = `${hostname}:${port}:${address.address}`;
  const result = await (dependencies.runGit || exec)(
    "git",
    [
      "-c",
      `http.curloptResolve=${resolveConfig}`,
      "-c",
      "http.followRedirects=false",
      "-c",
      "http.sslVerify=true",
      "-c",
      "protocol.file.allow=never",
      "-c",
      "protocol.ext.allow=never",
      "-c",
      "core.hooksPath=/dev/null",
      "clone",
      "--depth=1",
      "--",
      url.href,
      destination,
    ],
    { ...options, timeout: 120_000 },
  );
  if (!result.ok) {
    const details = String(result.stderr || result.error?.message || `exit code ${result.code}`)
      .replace(/[\r\n\t]+/g, " ")
      .slice(0, 500);
    const error = new Error("Git clone failed") as CloneError;
    error.statusCode = 502;
    error.details = details;
    throw error;
  }
  return { output: result.stdout, url: url.href };
}
