import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const dataPath = await mkdtemp(join(tmpdir(), "age-gitmini-"));
process.env.DATA_PATH = dataPath;
process.env.CONNECTOR_ENCRYPTION_KEY = "gitmini-test-encryption-key";
process.env.GITMINI_URL = "https://gitmini.example.test";
const [
  { default: routes },
  { createTeam },
  connectors,
  { remoteOptions, gitRemoteArgs, pushDestinationRef, authenticatedPullPlan },
] = await Promise.all([
  import(pathToFileURL(join(process.cwd(), "server/workspaces.mjs"))),
  import(pathToFileURL(join(process.cwd(), "server/teams.mjs"))),
  import(pathToFileURL(join(process.cwd(), "server/connectors.mjs"))),
  import(pathToFileURL(join(process.cwd(), "server/tools/gitmini-auth.mjs"))),
]);
after(() => rm(dataPath, { recursive: true, force: true }));

function invoke(handler, body, params, subject = "gitmini-user") {
  let response;
  const req = { authSubject: subject, toArray: async () => [Buffer.from(JSON.stringify(body))] };
  const res = { sendJson: (value, status = 200) => (response = { value, status }) };
  return Promise.resolve(handler(req, res, params)).then(() => response);
}

async function prepareWorkspace(name) {
  const root = join(dataPath, name);
  await Promise.all([
    mkdir(join(root, "files"), { recursive: true }),
    mkdir(join(root, "config"), { recursive: true }),
  ]);
  await (await import("node:fs/promises")).writeFile(join(root, "config", "workspace.json"), JSON.stringify({ name }));
  return root;
}

test("workspace GitMini linking initializes an empty local main checkout without committing and is idempotent", async (t) => {
  const oldFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = oldFetch));
  await createTeam("gitmini-user", "GitMini tests");
  const token = `gmpat_${"z".repeat(43)}`;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/orgs") {
      return globalThis.Response.json({ orgs: [{ slug: "test.org" }] });
    }
    if (path.endsWith("/repos")) {
      return globalThis.Response.json({ repos: [] });
    }
    if (path.endsWith("/repos/workspace")) {
      return globalThis.Response.json({ repo: "workspace" }, { status: 201 });
    }
    throw new Error(`Unexpected GitMini request ${options.method} ${path}`);
  };
  const teamId = await (await import("../server/teams.mjs")).teamFor("gitmini-user");
  await connectors.saveGitMiniConnector(`team:${teamId}`, { org: "test.org", token });
  const workspace = await prepareWorkspace("workspace");
  const linked = await invoke(routes["POST /workspaces/:name/gitmini"], {}, { name: "workspace" });
  assert.equal(linked.status, 200, JSON.stringify(linked.value));
  assert.equal(linked.value.ready, true);
  const files = join(workspace, "files");
  assert.equal(execFileSync("git", ["-C", files, "branch", "--show-current"], { encoding: "utf8" }).trim(), "main");
  assert.throws(() => execFileSync("git", ["-C", files, "rev-parse", "--verify", "HEAD"], { stdio: "ignore" }));
  const storedRemote = execFileSync("git", ["-C", files, "remote", "get-url", "gitmini"], { encoding: "utf8" }).trim();
  assert.equal(storedRemote, "https://gitmini.example.test/git/test.org/workspace.git");
  assert.equal(storedRemote.includes(token), false);
  const authContext = { workspacePath: workspace, getPath: () => files, subject: "gitmini-user" };
  const auth = await remoteOptions(authContext, "");
  assert.equal(auth.remote, "gitmini");
  assert.equal(auth.authenticated, true);
  assert.equal(auth.options.env.GIT_CONFIG_GLOBAL, "/dev/null");
  assert.equal(auth.options.env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(
    auth.options.env.GIT_CONFIG_KEY_0,
    "http.https://gitmini.example.test/git/test.org/workspace.git.extraheader",
  );
  assert.equal(
    Buffer.from(auth.options.env.GIT_CONFIG_VALUE_0.replace("AUTHORIZATION: Basic ", ""), "base64").toString(),
    `age:${token}`,
  );
  assert.equal(
    execFileSync("git", ["-C", files, "config", "--local", "--get", "remote.gitmini.url"], {
      encoding: "utf8",
    }).includes(token),
    false,
  );
  const nonGitMini = await remoteOptions(authContext, "origin");
  assert.equal(nonGitMini.authenticated, false);
  assert.equal(nonGitMini.options.env, undefined);
  const linkedMetadataPath = join(workspace, "config", "workspace.json");
  const savedMetadata = JSON.parse(await readFile(linkedMetadataPath, "utf8"));
  await (
    await import("node:fs/promises")
  ).writeFile(
    linkedMetadataPath,
    JSON.stringify({ ...savedMetadata, gitmini: { org: "wrong-org", repo: "workspace" } }),
  );
  await assert.rejects(remoteOptions(authContext, ""), /different organization/);
  await (await import("node:fs/promises")).writeFile(linkedMetadataPath, JSON.stringify(savedMetadata));
  const pullArgs = gitRemoteArgs(files, "pull", "gitmini", "main", true);
  assert.ok(pullArgs.includes("core.hooksPath=/dev/null"));
  const pushArgs = gitRemoteArgs(files, "push", "gitmini", "main", true);
  assert.ok(pushArgs.includes("core.hooksPath=/dev/null"));
  assert.equal(pullArgs.includes(token), false);
  assert.equal(pushArgs.includes(token), false);
  const pullPlan = authenticatedPullPlan(files, "gitmini", "main");
  assert.deepEqual(pullPlan.fetchArgs.slice(-3), ["fetch", "gitmini", "main"]);
  assert.deepEqual(pullPlan.mergeArgs.slice(-3), ["merge", "--no-edit", "FETCH_HEAD"]);
  assert.equal(pullPlan.fetchArgs.includes(token), false);
  assert.equal(pullPlan.mergeArgs.includes(token), false);
  assert.equal(Object.hasOwn(pullPlan.mergeOptions, "env"), false);
  assert.equal(pullPlan.mergeOptions.cwd, files);
  assert.equal(String(auth.options.env.GIT_CONFIG_VALUE_0).includes(token), false);
  const metadata = JSON.parse(await readFile(join(workspace, "config", "workspace.json"), "utf8"));
  assert.deepEqual(metadata.gitmini, { org: "test.org", repo: "workspace" });
  delete metadata.gitmini;
  await (
    await import("node:fs/promises")
  ).writeFile(join(workspace, "config", "workspace.json"), JSON.stringify(metadata));
  const retry = await invoke(routes["POST /workspaces/:name/gitmini"], {}, { name: "workspace" });
  assert.equal(retry.status, 200);
  assert.deepEqual(JSON.parse(await readFile(join(workspace, "config", "workspace.json"), "utf8")).gitmini, {
    org: "test.org",
    repo: "workspace",
  });
});

test("workspace GitMini linking preserves an existing Git checkout and origin remote", async (t) => {
  const oldFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = oldFetch));
  const token = `gmpat_${"o".repeat(43)}`;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/orgs") {
      return globalThis.Response.json({ orgs: [{ slug: "test.org" }] });
    }
    if (path.endsWith("/repos")) {
      return globalThis.Response.json({ repos: [] });
    }
    if (path.endsWith("/repos/existing-origin")) {
      return globalThis.Response.json({ repo: "existing-origin" }, { status: 201 });
    }
    throw new Error(`Unexpected GitMini request ${options.method} ${path}`);
  };
  const team = await (await import("../server/teams.mjs")).teamFor("gitmini-user");
  await connectors.saveGitMiniConnector(`team:${team}`, { org: "test.org", token });
  const workspace = await prepareWorkspace("existing-origin");
  const files = join(workspace, "files");
  execFileSync("git", ["-C", files, "init", "-b", "feature"]);
  execFileSync("git", ["-C", files, "remote", "add", "origin", "https://github.com/example/project.git"]);

  const linked = await invoke(routes["POST /workspaces/:name/gitmini"], {}, { name: "existing-origin" });
  assert.equal(linked.status, 200, JSON.stringify(linked.value));
  assert.equal(execFileSync("git", ["-C", files, "branch", "--show-current"], { encoding: "utf8" }).trim(), "feature");
  assert.equal(
    execFileSync("git", ["-C", files, "remote", "get-url", "origin"], { encoding: "utf8" }).trim(),
    "https://github.com/example/project.git",
  );
  assert.equal(
    execFileSync("git", ["-C", files, "remote", "get-url", "gitmini"], { encoding: "utf8" }).trim(),
    "https://gitmini.example.test/git/test.org/existing-origin.git",
  );
});

test("GitMini setup rejects invalid names, aliases, conflicting local remotes, and existing unrelated remote repos", async (t) => {
  const oldFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = oldFetch));
  const workspace = await prepareWorkspace("conflict");
  let listings = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === "/api/v1/orgs") {
      return globalThis.Response.json({ orgs: [{ slug: "test.org" }] });
    }
    if (path.endsWith("/repos")) {
      listings += 1;
      return globalThis.Response.json({ repos: [{ repo: "taken" }] });
    }
    return globalThis.Response.json({}, { status: 201 });
  };
  const team = await (await import("../server/teams.mjs")).teamFor("gitmini-user");
  await connectors.saveGitMiniConnector(`team:${team}`, { org: "test.org", token: `gmpat_${"q".repeat(43)}` });
  assert.equal(
    (await invoke(routes["POST /workspaces/:name/gitmini"], { repo: "-bad" }, { name: "conflict" })).status,
    400,
  );
  assert.equal(
    (await invoke(routes["POST /workspaces/:name/gitmini"], { repo: "ok" }, { name: "conflict/../conflict" })).status,
    400,
  );
  const files = join(workspace, "files");
  execFileSync("git", ["-C", files, "init", "-b", "main"]);
  execFileSync("git", ["-C", files, "remote", "add", "gitmini", "https://other.example/git/org/repo.git"]);
  const conflict = await invoke(routes["POST /workspaces/:name/gitmini"], { repo: "different" }, { name: "conflict" });
  assert.equal(conflict.status, 409);
  assert.equal(listings, 0);

  const metadataConflictRoot = await prepareWorkspace("metadata-conflict");
  await (
    await import("node:fs/promises")
  ).writeFile(
    join(metadataConflictRoot, "config", "workspace.json"),
    JSON.stringify({ gitmini: { org: "other-org", repo: "other-repo" } }),
  );
  const metadataConflict = await invoke(
    routes["POST /workspaces/:name/gitmini"],
    { repo: "new-repo" },
    { name: "metadata-conflict" },
  );
  assert.equal(metadataConflict.status, 409);
  assert.deepEqual(JSON.parse(await readFile(join(metadataConflictRoot, "config", "workspace.json"), "utf8")).gitmini, {
    org: "other-org",
    repo: "other-repo",
  });

  const fresh = await prepareWorkspace("taken-workspace");
  const unrelated = await invoke(
    routes["POST /workspaces/:name/gitmini"],
    { repo: "taken" },
    { name: "taken-workspace" },
  );
  assert.equal(unrelated.status, 409);
  assert.equal(JSON.parse(await readFile(join(fresh, "config", "workspace.json"), "utf8")).gitmini, undefined);

  const failedRoot = await prepareWorkspace("failed-create");
  let ambiguousCreate = false;
  let createAttempts = 0;
  globalThis.fetch = async (url) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith("/repos")) {
      return globalThis.Response.json({ repos: ambiguousCreate ? [{ repo: "failed" }] : [] });
    }
    if (path.endsWith("/repos/failed")) {
      createAttempts += 1;
      if (createAttempts === 1) {
        ambiguousCreate = true;
        return globalThis.Response.json({ error: "opaque" }, { status: 500 });
      }
      return globalThis.Response.json({ repo: "failed" }, { status: 201 });
    }
    return globalThis.Response.json({ orgs: [{ slug: "test.org" }] });
  };
  const failed = await invoke(routes["POST /workspaces/:name/gitmini"], { repo: "failed" }, { name: "failed-create" });
  assert.equal(failed.status, 502);
  const failedMetadata = JSON.parse(await readFile(join(failedRoot, "config", "workspace.json"), "utf8"));
  assert.equal(failedMetadata.gitmini, undefined);
  assert.deepEqual(failedMetadata.gitminiPending, { org: "test.org", repo: "failed" });
  assert.equal(
    execFileSync("git", ["-C", join(failedRoot, "files"), "remote", "get-url", "gitmini"], {
      encoding: "utf8",
    }).trim(),
    "https://gitmini.example.test/git/test.org/failed.git",
  );
  const retried = await invoke(routes["POST /workspaces/:name/gitmini"], { repo: "failed" }, { name: "failed-create" });
  assert.equal(retried.status, 200, JSON.stringify(retried.value));
  const repairedMetadata = JSON.parse(await readFile(join(failedRoot, "config", "workspace.json"), "utf8"));
  assert.deepEqual(repairedMetadata.gitmini, { org: "test.org", repo: "failed" });
  assert.equal(repairedMetadata.gitminiPending, undefined);
});

test("Git operations select defaults safely and require credentials for GitMini", async () => {
  const workspace = join(dataPath, "remote-options");
  const files = join(workspace, "files");
  await mkdir(join(workspace, "config"), { recursive: true });
  await mkdir(files, { recursive: true });
  const context = { workspacePath: workspace, getPath: () => files, subject: "unknown-user" };
  const fallback = await remoteOptions(context, "");
  assert.equal(fallback.remote, "origin");
  assert.equal(fallback.authenticated, false);
  const explicit = await remoteOptions(context, "upstream");
  assert.equal(explicit.remote, "upstream");
  assert.equal(explicit.authenticated, false);
  await (
    await import("node:fs/promises")
  ).writeFile(
    join(workspace, "config", "workspace.json"),
    JSON.stringify({ gitmini: { org: "test.org", repo: "repo" } }),
  );
  await assert.rejects(remoteOptions(context, ""), /Connect a team GitMini credential/);
  await assert.rejects(remoteOptions(context, "gitmini"), /Connect a team GitMini credential/);
});

test("GitMini push defaults to the current HEAD on main while other remotes retain main", () => {
  assert.equal(pushDestinationRef("gitmini", ""), "HEAD:refs/heads/main");
  assert.equal(pushDestinationRef("origin", ""), "main");
  assert.equal(pushDestinationRef("gitmini", "release"), "release");
});

test("GitMini default push updates main from a differently named local branch", async () => {
  const root = join(dataPath, "push-branch-test");
  const remote = join(root, "remote");
  const local = join(root, "local");
  await Promise.all([mkdir(remote, { recursive: true }), mkdir(local, { recursive: true })]);
  const git = (args) => execFileSync("git", args, { encoding: "utf8" });
  git(["-C", remote, "init", "-b", "main"]);
  git(["-C", remote, "config", "receive.denyCurrentBranch", "updateInstead"]);
  git(["-C", local, "init", "-b", "feature"]);
  git(["-C", local, "config", "user.name", "Test"]);
  git(["-C", local, "config", "user.email", "test@example.test"]);
  await (await import("node:fs/promises")).writeFile(join(local, "README.md"), "seed\n");
  git(["-C", local, "add", "README.md"]);
  git(["-C", local, "commit", "-m", "seed"]);
  git(["-C", local, "remote", "add", "gitmini", remote]);
  const pushRef = pushDestinationRef("gitmini", "");
  git(gitRemoteArgs(local, "push", "gitmini", pushRef, true));
  assert.equal(
    git(["-C", remote, "rev-parse", "refs/heads/main"]).trim(),
    git(["-C", local, "rev-parse", "HEAD"]).trim(),
  );
  assert.equal(await readFile(join(remote, "README.md"), "utf8"), "seed\n");
});

test("authenticated GitMini fetch cannot run a repository reference hook that can read auth env", async () => {
  const root = join(dataPath, "fetch-hook-test");
  const remote = join(root, "remote");
  const local = join(root, "local");
  const hooks = join(local, "untrusted-hooks");
  const marker = join(root, "hook-ran");
  await Promise.all([
    mkdir(remote, { recursive: true }),
    mkdir(local, { recursive: true }),
    mkdir(hooks, { recursive: true }),
  ]);
  const git = (args, options = {}) => execFileSync("git", args, { encoding: "utf8", ...options });
  git(["-C", remote, "init", "-b", "main"]);
  git(["-C", remote, "config", "user.name", "Test"]);
  git(["-C", remote, "config", "user.email", "test@example.test"]);
  await (await import("node:fs/promises")).writeFile(join(remote, "README.md"), "seed\n");
  git(["-C", remote, "add", "README.md"]);
  git(["-C", remote, "commit", "-m", "seed"]);
  git(["-C", local, "init", "-b", "main"]);
  git(["-C", local, "remote", "add", "gitmini", remote]);
  git(["-C", local, "config", "core.hooksPath", hooks]);
  await (
    await import("node:fs/promises")
  ).writeFile(join(hooks, "reference-transaction"), '#!/bin/sh\nprintf "%s" "$GIT_CONFIG_VALUE_0" > "$HOOK_MARKER"\n', {
    mode: 0o700,
  });

  const plan = authenticatedPullPlan(local, "gitmini", "main");
  const authEnv = {
    ...process.env,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "http.https://gitmini.example.test/git/test.org/workspace.git.extraheader",
    GIT_CONFIG_VALUE_0: "AUTHORIZATION: Basic c2VjcmV0",
    GIT_CONFIG_KEY_1: "credential.helper",
    GIT_CONFIG_VALUE_1: "",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    HOOK_MARKER: marker,
  };
  git(plan.fetchArgs, { cwd: local, env: authEnv, stdio: "ignore" });
  assert.equal(existsSync(marker), false);
  assert.equal(Object.hasOwn(plan.mergeOptions, "env"), false);
});
