import { exec } from "@cloud-cli/exec";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getGitMiniConnector } from "../connectors.mjs";
import { teamFor } from "../teams.mjs";

export async function remoteOptions(context: any, requested: string) {
  let remote = requested || "origin";
  let linked: any;
  try {
    linked = JSON.parse(await readFile(join(context.workspacePath, "config", "workspace.json"), "utf8")).gitmini;
  } catch {
    linked = undefined;
  }
  if (!requested && linked?.org && linked?.repo) {
    remote = "gitmini";
  }
  const options: any = { cwd: context.getPath(".") };
  if (remote === "gitmini") {
    if (!linked?.org || !linked?.repo) {
      throw new Error("GitMini remote is not linked to this workspace");
    }
    if (!context.subject) {
      throw new Error("Connect a team GitMini credential before using this remote");
    }
    const team = await teamFor(context.subject);
    const auth = team && (await getGitMiniConnector(`team:${team}`));
    if (!auth) {
      throw new Error("Connect a team GitMini credential before using this remote");
    }
    if (auth.org !== linked.org) {
      throw new Error("The team GitMini credential is for a different organization");
    }
    const url = `${auth.baseUrl}/git/${encodeURIComponent(auth.org)}/${encodeURIComponent(linked.repo)}.git`;
    const configuredUrl = await exec("git", ["-C", context.getPath("."), "remote", "get-url", "gitmini"], {
      cwd: context.getPath("."),
    })
      .then((result) => result.stdout.trim())
      .catch(() => "");
    if (configuredUrl !== url) {
      throw new Error("GitMini remote URL conflicts with workspace metadata");
    }
    const header = `Basic ${Buffer.from(`age:${auth.token}`).toString("base64")}`;
    const env = { ...process.env };
    for (const key of Object.keys(env)) {
      if (key.startsWith("GIT_CONFIG_KEY_") || key.startsWith("GIT_CONFIG_VALUE_") || key === "GIT_CONFIG_PARAMETERS") {
        delete env[key];
      }
    }
    options.env = {
      ...env,
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: `http.${url}.extraheader`,
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: ${header}`,
      GIT_CONFIG_KEY_1: "credential.helper",
      GIT_CONFIG_VALUE_1: "",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_TERMINAL_PROMPT: "0",
    };
    return { remote, options, authenticated: true };
  }
  return { remote, options, authenticated: false };
}

export function gitRemoteArgs(
  path: string,
  action: "push" | "pull",
  remote: string,
  branch: string,
  authenticated: boolean,
) {
  const args = ["-C", path];
  if (authenticated) {
    args.push("-c", "core.hooksPath=/dev/null");
  }
  args.push(action, remote, branch);
  return args;
}

export function pushDestinationRef(remote: string, branch: string) {
  if (branch) {
    return branch;
  }
  return remote === "gitmini" ? "HEAD:refs/heads/main" : "main";
}

export function authenticatedPullPlan(path: string, remote: string, branch: string) {
  return {
    fetchArgs: ["-C", path, "-c", "core.hooksPath=/dev/null", "fetch", remote, branch],
    mergeArgs: ["-C", path, "-c", "core.hooksPath=/dev/null", "merge", "--no-edit", "FETCH_HEAD"],
    mergeOptions: { cwd: path },
  };
}
