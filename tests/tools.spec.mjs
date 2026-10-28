import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { link as createHardLink, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadableStream } from "node:stream/web";
import { after, test } from "node:test";
import { gunzipSync, gzipSync } from "node:zlib";

const dataPath = await mkdtemp(join(tmpdir(), "age-tools-"));
process.env.DATA_PATH = dataPath;
const previousDeployUrl = process.env.DEPLOY_API_URL;
const previousDeployKey = process.env.DEPLOY_API_KEY;
process.env.DEPLOY_API_URL = "https://deploy.test/";
process.env.DEPLOY_API_KEY = "tools-test-key";
const [{ convertFunctionsToTools, tools, toolsByName }, { Context, executeFunction }] = await Promise.all([
  import("../server/tools.mjs"),
  import("../server/agents.mjs"),
]);
const { readBoundedResponse } = await import("../server/tools/http-body.mjs");
const workspace = "tool-tests";
const filesPath = join(dataPath, workspace, "files");
await mkdir(filesPath, { recursive: true });
const context = new Context({ workspace, sessionId: "tool-test-session" });
after(async () => {
  await rm(dataPath, { recursive: true, force: true });
  if (previousDeployUrl === undefined) {
    delete process.env.DEPLOY_API_URL;
  } else {
    process.env.DEPLOY_API_URL = previousDeployUrl;
  }
  if (previousDeployKey === undefined) {
    delete process.env.DEPLOY_API_KEY;
  } else {
    process.env.DEPLOY_API_KEY = previousDeployKey;
  }
});

const requestedTools = [
  "CreateFolder",
  "DeleteFile",
  "DeleteFolder",
  "GetFileStats",
  "ListFiles",
  "RenameFile",
  "RenameFolder",
  "WriteFile",
  "CloneRepository",
  "CommitChanges",
  "PullChanges",
  "PushChanges",
  "ShellExec",
  "DeployPull",
  "DeployPush",
  "OllamaCallModel",
  "OllamaListModels",
  "OllamaPullModel",
  "OllamaSummarizeText",
  "CreatePageFromMarkdown",
  "DatabaseQuery",
  "DatabaseSearch",
  "ApplyPatch",
  "DelegateTask",
  "Glob",
  "Grep",
  "ReadFile",
  "WebFetch",
  "WebSearch",
  "CommentOnTask",
  "UpdateTaskStatus",
];

test("every requested system tool is registered once with a valid JSON schema", () => {
  const names = tools.map((tool) => tool.function.name);
  assert.equal(new Set(names).size, names.length);
  assert.deepEqual([...names].sort(), [...requestedTools].sort());
  for (const name of requestedTools) {
    assert.ok(toolsByName[name], `${name} implementation is registered`);
    const tool = tools.find((entry) => entry.function.name === name);
    assert.ok(tool, `${name} schema is registered`);
    assert.ok(tool.function.description, `${name} has a description`);
    assert.equal(tool.function.parameters.type, "object");
    assert.equal(tool.function.parameters.additionalProperties, false);
    assert.ok(Array.isArray(tool.function.parameters.required));
  }
  assert.deepEqual(tools.find((tool) => tool.function.name === "ReadFile").function.parameters.properties, {
    path: { type: "string" },
    offset: { type: "number" },
    limit: { type: "number" },
  });
  assert.deepEqual(tools.find((tool) => tool.function.name === "Glob").function.parameters.required, ["pattern"]);
  assert.deepEqual(tools.find((tool) => tool.function.name === "DeployPush").function.parameters.required, ["name"]);
  assert.equal(
    tools.find((tool) => tool.function.name === "Grep").function.parameters.properties.caseSensitive.type,
    "boolean",
  );
  function Sample(/*string*/ text = "a,b", /*number*/ limit = Math.max(1, 2)) {
    return { text, limit };
  }
  const parsed = convertFunctionsToTools({ Sample })[0].function.parameters;
  assert.deepEqual(parsed.required, []);
  assert.deepEqual(parsed.properties, { text: { type: "string" }, limit: { type: "number" } });
});

test("remote response bodies are bounded while streaming", async () => {
  const response = new globalThis.Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from("1234"));
        controller.enqueue(Buffer.from("5678"));
        controller.close();
      },
    }),
  );
  await assert.rejects(readBoundedResponse(response, 5), /size limit/);
  assert.equal((await readBoundedResponse(new globalThis.Response("small"), 5)).toString("utf8"), "small");
});

test("bounded reads, globstar matching, and literal search work within workspace", async () => {
  await mkdir(join(filesPath, "src/nested"), { recursive: true });
  await writeFile(join(filesPath, "src/direct.mjs"), "first\nneedle direct\nlast\n");
  await writeFile(join(filesPath, "src/nested/child.mjs"), "needle nested\n");

  assert.equal(
    await executeFunction("ReadFile", { path: "src/direct.mjs", offset: 1, limit: 1 }, context),
    "2: needle direct",
  );
  assert.deepEqual(await executeFunction("Glob", { pattern: "**/*.mjs", path: "src" }, context), [
    "direct.mjs",
    join("nested", "child.mjs"),
  ]);
  const matches = await executeFunction(
    "Grep",
    { pattern: "NEEDLE", path: "src", include: "**/*.mjs", caseSensitive: false },
    context,
  );
  assert.match(matches, /direct\.mjs:2: needle direct/);
  assert.match(matches, /nested[/\\]child\.mjs:1: needle nested/);
  await writeFile(join(filesPath, "large-line.txt"), "x".repeat(1_000_001));
  await assert.rejects(executeFunction("ReadFile", { path: "large-line.txt" }, context), /line exceeds/);
  for (const url of ["http://[::ffff:7f00:1]/", "http://[64:ff9b::7f00:1]/", "http://[2002:7f00:1::]/"]) {
    await assert.rejects(executeFunction("WebFetch", { url }, context), /Private network destinations/);
  }
});

test("mutations require approval, stay inside the workspace, and apply both patch formats", async () => {
  const previous = process.env.ALLOW_MUTATING_TOOLS;
  delete process.env.ALLOW_MUTATING_TOOLS;
  const taskContext = new Context({ workspace, sessionId: "tool-task-session", taskId: "task-1" });
  try {
    const blocked = await executeFunction("WriteFile", { path: "blocked.txt", content: "no" }, context);
    assert.deepEqual(blocked, { status: "approval_required", tool: "WriteFile" });
    await assert.rejects(readFile(join(filesPath, "blocked.txt")), { code: "ENOENT" });
    const shellBlocked = await executeFunction("ShellExec", { command: "printf unsafe" }, context);
    assert.deepEqual(shellBlocked, { status: "approval_required", tool: "ShellExec" });
    assert.deepEqual(await executeFunction("ShellExec", { command: "printf unsafe" }, taskContext), {
      status: "approval_required",
      tool: "ShellExec",
    });

    process.env.ALLOW_MUTATING_TOOLS = "true";
    assert.equal(await executeFunction("CreateFolder", { path: "file-actions/folder" }, context), true);
    assert.equal(
      await executeFunction("WriteFile", { path: "file-actions/first.txt", content: "first" }, context),
      true,
    );
    await executeFunction("WriteFile", { path: "file-actions/second.txt", content: "second" }, context);
    const firstPage = await executeFunction("ListFiles", { path: "file-actions", limit: 1 }, context);
    assert.equal(firstPage.length, 1);
    assert.ok(["first.txt", "folder", "second.txt"].includes(firstPage[0]));
    assert.equal((await executeFunction("GetFileStats", { path: "file-actions/first.txt" }, context)).isFile, true);
    assert.equal(
      await executeFunction(
        "RenameFile",
        { oldPath: "file-actions/first.txt", newPath: "file-actions/second.txt" },
        context,
      ),
      true,
    );
    assert.equal(
      await executeFunction(
        "RenameFolder",
        { oldPath: "file-actions/folder", newPath: "file-actions/renamed" },
        context,
      ),
      true,
    );
    assert.equal(await executeFunction("DeleteFile", { path: "file-actions/second.txt" }, context), true);
    assert.equal(await executeFunction("DeleteFolder", { path: "file-actions/renamed" }, context), true);
    const shellResult = await executeFunction("ShellExec", { command: "printf safe" }, context);
    assert.equal(shellResult.code, 0);
    assert.equal(shellResult.output, "safe");
    const approvedTaskShell = await executeFunction("ShellExec", { command: "printf approved" }, taskContext);
    assert.equal(approvedTaskShell.output, "approved");
    const outsideFile = join(dataPath, "outside.txt");
    await writeFile(outsideFile, "untouched");
    await symlink(outsideFile, join(filesPath, "outside-link.txt"));
    await assert.rejects(
      executeFunction("WriteFile", { path: "outside-link.txt", content: "overwritten" }, context),
      /Path escapes workspace/,
    );
    assert.equal(await readFile(outsideFile, "utf8"), "untouched");
    await symlink(join(dataPath, "dangling-target.txt"), join(filesPath, "dangling-link.txt"));
    await assert.rejects(
      executeFunction("WriteFile", { path: "dangling-link.txt", content: "created" }, context),
      /Path escapes workspace/,
    );
    await assert.rejects(readFile(join(dataPath, "dangling-target.txt")), { code: "ENOENT" });
    await assert.rejects(
      executeFunction(
        "ApplyPatch",
        {
          patch:
            "diff --git a/outside-link.txt b/outside-link.txt\n--- a/outside-link.txt\n+++ b/outside-link.txt\n@@ -1 +1 @@\n-untouched\n+overwritten\n",
        },
        context,
      ),
      /Path escapes workspace/,
    );
    assert.equal(await readFile(outsideFile, "utf8"), "untouched");
    await createHardLink(outsideFile, join(filesPath, "hard-link.txt"));
    await assert.rejects(
      executeFunction("WriteFile", { path: "hard-link.txt", content: "overwritten" }, context),
      /Hard-linked files/,
    );
    assert.equal(await readFile(outsideFile, "utf8"), "untouched");

    await writeFile(join(filesPath, "patch.txt"), "old\n");
    const applied = await executeFunction(
      "ApplyPatch",
      { patch: "*** Begin Patch\n*** Update File: patch.txt\n@@\n-old\n+new\n*** End Patch" },
      context,
    );
    assert.deepEqual(applied, { status: "applied", files: 1 });
    assert.equal(await readFile(join(filesPath, "patch.txt"), "utf8"), "new\n");

    await executeFunction(
      "ApplyPatch",
      {
        patch: "diff --git a/patch.txt b/patch.txt\n--- a/patch.txt\n+++ b/patch.txt\n@@ -1 +1 @@\n-new\n+changed\n",
      },
      context,
    );
    assert.equal(await readFile(join(filesPath, "patch.txt"), "utf8"), "changed\n");
    await writeFile(join(filesPath, "patch-order.txt"), "repeat\nspecific\nother\nrepeat\nnot-specific\n");
    await assert.rejects(
      executeFunction(
        "ApplyPatch",
        {
          patch:
            "*** Begin Patch\n*** Update File: patch-order.txt\n@@\n specific\n+inserted\n@@ repeat\n repeat\n specific\n-other\n+changed\n*** End Patch",
        },
        context,
      ),
      /Patch context did not match/,
    );
    assert.equal(
      await readFile(join(filesPath, "patch-order.txt"), "utf8"),
      "repeat\nspecific\nother\nrepeat\nnot-specific\n",
    );

    await writeFile(join(filesPath, "no-newline.txt"), "without newline");
    await executeFunction(
      "ApplyPatch",
      {
        patch:
          "*** Begin Patch\n*** Update File: no-newline.txt\n@@\n-without newline\n\\ No newline at end of file\n+with newline\n*** End Patch",
      },
      context,
    );
    assert.equal(await readFile(join(filesPath, "no-newline.txt"), "utf8"), "with newline\n");
    await executeFunction(
      "ApplyPatch",
      {
        patch:
          "*** Begin Patch\n*** Update File: no-newline.txt\n@@\n-with newline\n+without final newline\n\\ No newline at end of file\n*** End Patch",
      },
      context,
    );
    assert.equal(await readFile(join(filesPath, "no-newline.txt"), "utf8"), "without final newline");
    await executeFunction(
      "ApplyPatch",
      {
        patch:
          "*** Begin Patch\n*** Add File: add-no-newline.txt\n+no final newline\n\\ No newline at end of file\n*** End Patch",
      },
      context,
    );
    assert.equal(await readFile(join(filesPath, "add-no-newline.txt"), "utf8"), "no final newline");

    await executeFunction(
      "ApplyPatch",
      { patch: "*** Begin Patch\n*** Add File: added.txt\n+created\n*** End Patch\n" },
      context,
    );
    assert.equal(await readFile(join(filesPath, "added.txt"), "utf8"), "created\n");
    await executeFunction(
      "ApplyPatch",
      { patch: "*** Begin Patch\n*** Delete File: added.txt\n*** End Patch" },
      context,
    );
    await assert.rejects(readFile(join(filesPath, "added.txt")), { code: "ENOENT" });
    await writeFile(join(filesPath, "move-from.txt"), "before move\n");
    await executeFunction(
      "ApplyPatch",
      {
        patch:
          "*** Begin Patch\n*** Update File: move-from.txt\n*** Move to: move-to.txt\n@@\n-before move\n+moved\n*** End Patch",
      },
      context,
    );
    await assert.rejects(readFile(join(filesPath, "move-from.txt")), { code: "ENOENT" });
    assert.equal(await readFile(join(filesPath, "move-to.txt"), "utf8"), "moved\n");

    await assert.rejects(
      executeFunction("ReadFile", { path: "patch.txt", unexpected: true }, context),
      /Unexpected tool argument/,
    );

    await assert.rejects(
      executeFunction(
        "ApplyPatch",
        { patch: "*** Begin Patch\n*** Add File: ../escape.txt\n+bad\n*** End Patch" },
        context,
      ),
      /relative to the workspace|traverse parent/i,
    );
    await assert.rejects(readFile(join(dataPath, "escape.txt")), { code: "ENOENT" });
    await assert.rejects(
      executeFunction(
        "ApplyPatch",
        {
          patch:
            "*** Begin Patch\n*** Add File: staged.txt\n+not written\n*** Update File: missing.txt\n@@\n-old\n+new\n*** End Patch",
        },
        context,
      ),
      /not a file/,
    );
    await assert.rejects(readFile(join(filesPath, "staged.txt")), { code: "ENOENT" });
    await assert.rejects(executeFunction("DeleteFolder", { path: "." }, context), /workspace files root/);
    assert.equal(await readFile(join(filesPath, "patch.txt"), "utf8"), "changed\n");
    await assert.rejects(
      executeFunction("CloneRepository", { repoUrl: "file:///etc/passwd", targetPath: "leak" }, context),
      /HTTPS/,
    );
    await assert.rejects(
      executeFunction("CloneRepository", { repoUrl: "https://127.0.0.1/repo", targetPath: "leak" }, context),
      /Private network destinations/,
    );
    await assert.rejects(
      executeFunction("PushChanges", { repoPath: "repo", remote: "--upload-pack", branch: "main" }, context),
      /configured Git remote name/,
    );
    await assert.rejects(
      executeFunction("DeployPull", { name: "https://attacker.example/steal" }, context),
      /simple alias/,
    );
    await assert.rejects(executeFunction("DatabaseQuery", { query: " ", data: {} }, context), /SQL statement/);
    await assert.rejects(executeFunction("DatabaseSearch", { query: " ", data: {} }, context), /SQL statement/);
  } finally {
    if (previous === undefined) {
      delete process.env.ALLOW_MUTATING_TOOLS;
    } else {
      process.env.ALLOW_MUTATING_TOOLS = previous;
    }
  }
});

test("deploy push and Markdown publishing use bounded, validated remote responses", async () => {
  const previousDeployUrl = process.env.DEPLOY_API_URL;
  const previousDeployKey = process.env.DEPLOY_API_KEY;
  process.env.DEPLOY_API_URL = "http://deploy.test/";
  process.env.DEPLOY_API_KEY = "insecure-test-key";
  try {
    const { DeployPush } = await import("../server/tools/deploy.mjs?insecure-config-test");
    await assert.rejects(DeployPush.call(context, "release"), /credential-free HTTPS/);
  } finally {
    process.env.DEPLOY_API_URL = previousDeployUrl;
    process.env.DEPLOY_API_KEY = previousDeployKey;
  }

  const source = join(filesPath, "deploy-source");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "index.html"), "published page");
  const originalFetch = globalThis.fetch;
  let uploadSeen = false;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, "https://deploy.test");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.authorization, "tools-test-key");
    assert.ok(options.body.size > 0);
    uploadSeen = true;
    return new globalThis.Response(JSON.stringify({ url: "https://pages.test/release" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const previous = process.env.ALLOW_MUTATING_TOOLS;
  process.env.ALLOW_MUTATING_TOOLS = "true";
  try {
    const deployed = await executeFunction("DeployPush", { name: "release", path: "deploy-source" }, context);
    assert.deepEqual(deployed, { url: "https://pages.test/release" });
    assert.equal(uploadSeen, true);

    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://mdbin.api.apphor.de/p");
      assert.equal(options.redirect, "error");
      return new globalThis.Response(JSON.stringify({ url: "https://pages.test/markdown" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    };
    assert.equal(
      await executeFunction("CreatePageFromMarkdown", { content: "# Safe" }, context),
      "https://pages.test/markdown",
    );
    globalThis.fetch = async () =>
      new globalThis.Response(JSON.stringify({ url: "javascript:alert(1)" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    await assert.rejects(
      executeFunction("CreatePageFromMarkdown", { content: "# Invalid" }, context),
      /unsupported URL/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) {
      delete process.env.ALLOW_MUTATING_TOOLS;
    } else {
      process.env.ALLOW_MUTATING_TOOLS = previous;
    }
  }
});

test("deployment pull validates remote tar paths and rejects symlinks before extraction", async () => {
  const source = join(dataPath, "deployment-source");
  await mkdir(source, { recursive: true });
  await writeFile(join(source, "index.html"), "safe page");
  const archivePath = join(dataPath, "safe.tgz");
  execFileSync("tar", ["czf", archivePath, "-C", source, "."]);
  const archive = await readFile(archivePath);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, "https://deploy.test");
    assert.equal(options.method, "COPY");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "tools-test-key");
    return new globalThis.Response(archive, { status: 200, headers: { "content-type": "application/gzip" } });
  };
  const previous = process.env.ALLOW_MUTATING_TOOLS;
  process.env.ALLOW_MUTATING_TOOLS = "true";
  try {
    await executeFunction("DeployPull", { name: "release", targetPath: "pulled" }, context);
    assert.equal(await readFile(join(filesPath, "pulled/index.html"), "utf8"), "safe page");

    const outsideFile = join(dataPath, "deployment-outside.txt");
    await writeFile(outsideFile, "untouched");
    const linkedTarget = join(filesPath, "linked-target");
    await mkdir(linkedTarget, { recursive: true });
    await symlink(outsideFile, join(linkedTarget, "index.html"));
    await assert.rejects(
      executeFunction("DeployPull", { name: "release", targetPath: "linked-target" }, context),
      /Path escapes workspace/,
    );
    assert.equal(await readFile(outsideFile, "utf8"), "untouched");

    const maliciousSource = join(dataPath, "malicious-source");
    await mkdir(maliciousSource, { recursive: true });
    await symlink(outsideFile, join(maliciousSource, "outside-link"));
    const maliciousArchivePath = join(dataPath, "malicious.tgz");
    execFileSync("tar", ["czf", maliciousArchivePath, "-C", maliciousSource, "."]);
    const maliciousArchive = await readFile(maliciousArchivePath);
    globalThis.fetch = async () => new globalThis.Response(maliciousArchive, { status: 200 });
    await assert.rejects(
      executeFunction("DeployPull", { name: "malicious", targetPath: "rejected" }, context),
      /only regular files and directories/,
    );
    assert.equal(await readFile(outsideFile, "utf8"), "untouched");

    const traversal = gunzipSync(archive);
    const header = traversal.subarray(0, 512);
    header.fill(0, 0, 100);
    Buffer.from("../escape.txt").copy(header, 0);
    header.fill(0x20, 148, 156);
    let checksum = 0;
    for (const byte of header) {
      checksum += byte;
    }
    Buffer.from(`${checksum.toString(8).padStart(6, "0")}\0 `).copy(header, 148);
    const traversalArchive = gzipSync(traversal);
    globalThis.fetch = async () => new globalThis.Response(traversalArchive, { status: 200 });
    await assert.rejects(
      executeFunction("DeployPull", { name: "traversal", targetPath: "traversal-rejected" }, context),
      /unsafe path/,
    );
    await assert.rejects(readFile(join(dataPath, "escape.txt")), { code: "ENOENT" });

    const longName = "f".repeat(120);
    await writeFile(join(source, longName), "PAX long path");
    const paxArchivePath = join(dataPath, "pax.tgz");
    execFileSync("tar", ["czf", paxArchivePath, "--format=pax", "-C", source, longName]);
    const paxArchive = await readFile(paxArchivePath);
    globalThis.fetch = async () => new globalThis.Response(paxArchive, { status: 200 });
    await executeFunction("DeployPull", { name: "pax", targetPath: "pax-pulled" }, context);
    assert.equal(await readFile(join(filesPath, "pax-pulled", longName), "utf8"), "PAX long path");
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) {
      delete process.env.ALLOW_MUTATING_TOOLS;
    } else {
      process.env.ALLOW_MUTATING_TOOLS = previous;
    }
  }
});
