import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, URLSearchParams } from "node:url";
import { after, test } from "node:test";

const dataPath = await mkdtemp(join(tmpdir(), "age-workspaces-"));
process.env.DATA_PATH = dataPath;
// Database-backed behavior must use an explicitly provisioned isolated test DB, never runtime credentials.
if (process.env.AGE_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.AGE_TEST_DATABASE_URL;
} else {
  delete process.env.DATABASE_URL;
}
const hasTestDatabase = Boolean(process.env.AGE_TEST_DATABASE_URL);
const { default: routes } = await import(pathToFileURL(join(process.cwd(), "server/workspaces.mjs")));
const { CommentOnTask, UpdateTaskStatus } = await import(pathToFileURL(join(process.cwd(), "server/tools/core.mjs")));
const { Context, executeFunction } = await import(pathToFileURL(join(process.cwd(), "server/agents.mjs")));
const { clonePublicRepository } = await import(pathToFileURL(join(process.cwd(), "server/tools/git-repository.mjs")));
const { processTask, initializeTaskQueue } = await import(pathToFileURL(join(process.cwd(), "server/task-queue.mjs")));
after(() => rm(dataPath, { recursive: true, force: true }));

function invoke(handler, body = {}, params = {}, subject = "user:alice", url = "/") {
  let response;
  const req = { authSubject: subject, url, toArray: async () => [Buffer.from(JSON.stringify(body))] };
  const res = {
    sendJson: (value, status = 200) => (response = { value, status }),
    writeHead: (status) => ({ end: () => (response = { status }) }),
  };
  return Promise.resolve(handler(req, res, params)).then(() => response);
}

test("workspace settings migrate legacy goals without discarding existing fields", async () => {
  const path = join(dataPath, "sample");
  await mkdir(join(path, "config"), { recursive: true });
  await writeFile(
    join(path, "config/project.json"),
    JSON.stringify({ name: "sample", summary: "keep", goals: ["String goal", { title: "Old goal" }], custom: 7 }),
  );
  const { value } = await invoke(routes["GET /workspaces/:name/settings"], {}, { name: "sample" });
  assert.equal(value.summary, "keep");
  assert.equal(value.description, "keep");
  assert.equal(value.custom, 7);
  assert.equal(value.goals[0].title, "String goal");
  assert.equal(value.goals[1].title, "Old goal");
  assert.ok(value.goals[0].id);
  const updated = await invoke(
    routes["PUT /workspaces/:name/settings"],
    {
      description: "A short description",
      goals: [{ title: "Target", description: "Details" }],
      revision: value.revision,
    },
    { name: "sample" },
  );
  assert.equal(updated.value.goals[0].description, "Details");
  assert.equal(updated.value.revision, value.revision + 1);
  assert.equal(updated.value.custom, 7);
  const delegated = await executeFunction(
    "DelegateTask",
    {
      specialist: "specialist",
      task: "Implement the goal",
      context: "Acceptance: tests pass",
      goalId: updated.value.goals[0].id,
    },
    { workspacePath: path, sessionId: "planner-session", plannerMode: true },
  );
  assert.equal(delegated.status, "queued");
  assert.equal(delegated.goalId, updated.value.goals[0].id);
  const previousMutatingPolicy = process.env.ALLOW_MUTATING_TOOLS;
  process.env.ALLOW_MUTATING_TOOLS = "true";
  try {
    const blockedPlannerWrite = await executeFunction(
      "WriteFile",
      { path: "not-created.txt", content: "not allowed" },
      { workspacePath: path, plannerMode: true },
    );
    assert.equal(blockedPlannerWrite.status, "approval_required");
    const blockedTaskDeploy = await executeFunction(
      "DeployPush",
      { name: "should-not-deploy" },
      { workspacePath: path, taskId: delegated.id },
    );
    assert.equal(blockedTaskDeploy.status, "approval_required");
  } finally {
    if (previousMutatingPolicy === undefined) {
      delete process.env.ALLOW_MUTATING_TOOLS;
    } else {
      process.env.ALLOW_MUTATING_TOOLS = previousMutatingPolicy;
    }
  }
  const stale = await invoke(
    routes["PUT /workspaces/:name/settings"],
    { goals: [{ title: "Stale", description: "Overwrite attempt" }], revision: value.revision },
    { name: "sample" },
  );
  assert.equal(stale.status, 409);
  const afterStale = await invoke(routes["GET /workspaces/:name/settings"], {}, { name: "sample" });
  assert.equal(afterStale.value.goals[0].title, "Target");
  assert.equal(afterStale.value.description, "A short description");
  await mkdir(join(dataPath, "connectors"), { recursive: true });
  const listed = await invoke(routes["GET /workspaces"]);
  assert.deepEqual(
    listed.value.map((workspace) => workspace.name),
    ["sample"],
  );
  const invalid = await invoke(
    routes["PUT /workspaces/:name/settings"],
    { goals: [{ title: "" }] },
    { name: "sample" },
  );
  assert.equal(invalid.status, 400);
});

test("workspace repository linking rejects invalid HTTPS URLs and non-empty files roots", async () => {
  await mkdir(join(dataPath, "repo-test", "files"), { recursive: true });
  const { value: invalid, status: invalidStatus } = await invoke(
    routes["POST /workspaces/:name/repository"],
    { repositoryUrl: "http://example.com/repo.git" },
    { name: "repo-test" },
  );
  assert.equal(invalidStatus, 400);
  assert.match(invalid.error, /HTTPS/);

  await writeFile(join(dataPath, "repo-test", "files", "keep.txt"), "preserve");
  const { value, status } = await invoke(
    routes["POST /workspaces/:name/repository"],
    { repositoryUrl: "https://github.com/cloud-cli/age.git" },
    { name: "repo-test" },
  );
  assert.equal(status, 409);
  assert.match(value.error, /empty workspace files folder/);
  assert.equal(await readFile(join(dataPath, "repo-test", "files", "keep.txt"), "utf8"), "preserve");

  const oversized = await invoke(
    routes["POST /workspaces/:name/repository"],
    { repositoryUrl: `https://github.com/${"a".repeat(5000)}` },
    { name: "repo-test" },
  );
  assert.equal(oversized.status, 413);
});

test("workspace repository linking clones into files and persists the connected remote", async () => {
  const workspace = join(dataPath, "repo-success");
  const files = join(workspace, "files");
  await mkdir(files, { recursive: true });
  let cloneCall;
  const clone = async function (repositoryUrl, targetPath) {
    cloneCall = { repositoryUrl, targetPath, workspacePath: this.workspacePath };
    const staging = this.getPath(targetPath);
    await mkdir(join(staging, ".git"), { recursive: true });
    await writeFile(join(staging, ".git/config"), `[remote "origin"]\n\turl = ${repositoryUrl}\n`);
    await writeFile(join(staging, "README.md"), "cloned repository");
    return { url: repositoryUrl, output: "clone succeeded" };
  };
  const handler = (req, res, params) =>
    routes["POST /workspaces/:name/repository"](req, res, params, new URLSearchParams(), clone);
  const { value, status } = await invoke(
    handler,
    { repositoryUrl: "https://github.com/cloud-cli/age.git" },
    { name: "repo-success" },
  );
  assert.equal(status, 200);
  assert.deepEqual(value, { repositoryUrl: "https://github.com/cloud-cli/age.git" });
  assert.equal(cloneCall.repositoryUrl, "https://github.com/cloud-cli/age.git");
  assert.match(cloneCall.targetPath, /^\.age-repository-/);
  assert.equal(cloneCall.workspacePath, workspace);
  assert.equal(await readFile(join(files, "README.md"), "utf8"), "cloned repository");
  assert.match(await readFile(join(files, ".git/config"), "utf8"), /github\.com\/cloud-cli\/age\.git/);
  const { value: settings } = await invoke(routes["GET /workspaces/:name/settings"], {}, { name: "repo-success" });
  assert.equal(settings.repositoryUrl, "https://github.com/cloud-cli/age.git");
  assert.deepEqual((await readdir(files)).sort(), [".git", "README.md"]);
});

test("workspace repository linking hides clone failures and removes its owned staging folder", async () => {
  const workspace = join(dataPath, "repo-failure");
  const files = join(workspace, "files");
  await mkdir(files, { recursive: true });
  const failedClone = async () => {
    throw Object.assign(new Error("Git clone failed"), { statusCode: 502, details: "internal path detail" });
  };
  const handler = (req, res, params) =>
    routes["POST /workspaces/:name/repository"](req, res, params, new URLSearchParams(), failedClone);
  const previousError = console.error;
  console.error = () => {};
  try {
    const { value, status } = await invoke(
      handler,
      { repositoryUrl: "https://github.com/cloud-cli/age.git" },
      { name: "repo-failure" },
    );
    assert.equal(status, 502);
    assert.match(value.error, /Could not clone repository/);
    assert.doesNotMatch(value.error, /internal path detail/);
  } finally {
    console.error = previousError;
  }
  assert.deepEqual(await readdir(files), []);
  assert.deepEqual(await readdir(workspace), ["files"]);
});

test("repository clone helper pins public HTTPS destinations and rejects failed git clones", async () => {
  const workspace = "repo-helper";
  const files = join(dataPath, workspace, "files");
  await mkdir(files, { recursive: true });
  const context = new Context({ workspace });
  let gitArgs;
  let gitOptions;
  const dependencies = {
    resolvePublicHost: async (hostname) => {
      assert.equal(hostname, "github.com");
      return [{ address: "93.184.216.34", family: 4 }];
    },
    runGit: async (command, args, options) => {
      assert.equal(command, "git");
      gitArgs = args;
      gitOptions = options;
      return { ok: true, code: 0, stdout: "Cloning into repository", stderr: "" };
    },
  };
  const result = await clonePublicRepository.call(
    context,
    "https://github.com/cloud-cli/age.git",
    "repository",
    dependencies,
  );
  assert.equal(result.url, "https://github.com/cloud-cli/age.git");
  assert.equal(gitArgs.includes("http.followRedirects=false"), true);
  assert.equal(gitArgs.includes("--depth=1"), true);
  assert.equal(gitArgs.includes("https://github.com/cloud-cli/age.git"), true);
  assert.ok(gitOptions.signal);
  assert.equal(gitOptions.signal.aborted, false);
  await assert.rejects(
    clonePublicRepository.call(context, "https://github.com/cloud-cli/age.git", "repository", {
      ...dependencies,
      runGit: async () => ({ ok: false, code: 128, stdout: "", stderr: "repository not found" }),
    }),
    (error) => error.message === "Git clone failed" && error.details === "repository not found",
  );
  await assert.rejects(
    clonePublicRepository.call(context, "https://user:secret@github.com/cloud-cli/age.git", "repository", dependencies),
    /without embedded credentials/,
  );
  await assert.rejects(
    clonePublicRepository.call(context, "https://github.com:8443/cloud-cli/age.git", "repository", dependencies),
    /port 443/,
  );
});

test("workspace history preserves planner role without changing normal sessions", async () => {
  await mkdir(join(dataPath, "session-test/history"), { recursive: true });

  const planner = await invoke(
    routes["POST /workspaces/:name/history"],
    { role: "planner", title: "Planner" },
    { name: "session-test" },
  );
  assert.equal(planner.status, 201);
  assert.equal(planner.value.role, "planner");
  const persistedPlanner = JSON.parse(
    await readFile(join(dataPath, "session-test/history", `${planner.value.id}.json`), "utf8"),
  );
  assert.equal(persistedPlanner.role, "planner");

  const normal = await invoke(routes["POST /workspaces/:name/history"], { title: "Chat" }, { name: "session-test" });
  assert.equal(normal.status, 201);
  assert.equal(normal.value.role, undefined);
});

test("planner prompt includes each exact goal ID", async () => {
  const app = await readFile(join(process.cwd(), "public/app-main.html"), "utf8");
  assert.match(app, /goalId: \$\{goal\.id\}/);
});

test(
  "task status and comments persist with authenticated author, retaining legacy task records",
  { skip: !hasTestDatabase },
  async () => {
    await mkdir(join(dataPath, "sample/tasks"), { recursive: true });
    const currentSettings = await invoke(routes["GET /workspaces/:name/settings"], {}, { name: "sample" });
    await invoke(
      routes["PUT /workspaces/:name/settings"],
      {
        goals: [{ id: "goal-1", title: "Goal", description: "Description" }],
        revision: currentSettings.value.revision,
      },
      { name: "sample" },
    );
    await writeFile(
      join(dataPath, "sample/tasks/legacy.json"),
      JSON.stringify({ id: "legacy", status: "queued", role: "specialist" }),
    );
    const created = await invoke(
      routes["POST /workspaces/:name/tasks"],
      { title: "Implement", goalId: "goal-1" },
      { name: "sample" },
    );
    assert.equal(created.status, 201);
    const id = created.value.id;
    const status = await invoke(
      routes["PATCH /workspaces/:name/tasks/:id"],
      { status: "in-progress" },
      { name: "sample", id },
    );
    assert.equal(status.value.status, "in-progress");
    assert.equal(
      (await invoke(routes["PATCH /workspaces/:name/tasks/:id"], { status: "verified" }, { name: "sample", id }))
        .status,
      400,
    );
    assert.equal(
      (await invoke(routes["PATCH /workspaces/:name/tasks/:id"], { status: "queued" }, { name: "sample", id })).status,
      400,
    );
    const comment = await invoke(
      routes["POST /workspaces/:name/tasks/:id/comments"],
      { content: "Working", author: "forged" },
      { name: "sample", id },
    );
    assert.equal(comment.value.comment.author, "user:alice");
    assert.equal(JSON.parse(await readFile(join(dataPath, "sample/tasks", `${id}.json`), "utf8")).comments.length, 1);
    const taskWithComment = await invoke(
      routes["PATCH /workspaces/:name/tasks/:id"],
      { status: "done" },
      { name: "sample", id },
    );
    assert.equal(taskWithComment.value.comments.length, 1);
    assert.equal(taskWithComment.value.execution.phase, "reviewing");
    const agentContext = { workspacePath: join(dataPath, "sample") };
    const agentComment = await CommentOnTask.call(agentContext, id, "Agent update");
    assert.equal(agentComment.author, "agent");
    const agentStatus = await UpdateTaskStatus.call(agentContext, id, "done");
    assert.equal(agentStatus.status, "done");
    await Promise.all([
      invoke(
        routes["POST /workspaces/:name/tasks/:id/comments"],
        { content: "Concurrent user update" },
        { name: "sample", id },
      ),
      CommentOnTask.call(agentContext, id, "Concurrent agent update"),
      UpdateTaskStatus.call(agentContext, id, "done"),
    ]);
    const finalTask = JSON.parse(await readFile(join(dataPath, "sample/tasks", `${id}.json`), "utf8"));
    assert.equal(finalTask.comments.length, 4);
    assert.equal(finalTask.status, "done");
    const tasks = await invoke(
      routes["GET /workspaces/:name/tasks"],
      {},
      { name: "sample" },
      "user:alice",
      "/workspaces/sample/tasks?goalId=goal-1",
    );
    assert.deepEqual(
      tasks.value.map((task) => task.id),
      [id],
    );
    const legacy = JSON.parse(await readFile(join(dataPath, "sample/tasks/legacy.json"), "utf8"));
    assert.equal(legacy.status, "queued");
    assert.equal(legacy.role, "specialist");
  },
);

test(
  "completed tasks require reviewer guidance to reopen and humans can verify",
  { skip: !hasTestDatabase },
  async () => {
    const directory = join(dataPath, "sample/tasks");
    await mkdir(directory, { recursive: true });
    const task = { id: "review-task", title: "Review me", description: "", status: "done", comments: [] };
    await writeFile(join(directory, `${task.id}.json`), JSON.stringify(task));

    const rejected = await invoke(
      routes["PATCH /workspaces/:name/tasks/:id"],
      { status: "in-progress" },
      { name: "sample", id: task.id },
    );
    assert.equal(rejected.status, 400);

    const reopened = await invoke(
      routes["PATCH /workspaces/:name/tasks/:id"],
      { status: "in-progress", guidance: "Add a missing test" },
      { name: "sample", id: task.id },
    );
    assert.equal(reopened.value.status, "in-progress", JSON.stringify(reopened));
    assert.equal(reopened.value.comments[0].content, "Add a missing test");
    assert.equal(reopened.value.execution.phase, "queued");

    const completed = await invoke(
      routes["PATCH /workspaces/:name/tasks/:id"],
      { status: "done" },
      { name: "sample", id: task.id },
    );
    assert.equal(completed.value.status, "done");

    const verified = await invoke(
      routes["PATCH /workspaces/:name/tasks/:id"],
      { status: "verified" },
      { name: "sample", id: task.id },
    );
    assert.equal(verified.value.status, "verified");
    assert.equal(verified.value.execution.phase, "verified");
  },
);

test(
  "durable queue retries incomplete reviews, records final verification, prevents duplicate claims, and caps rounds",
  { skip: !hasTestDatabase },
  async () => {
    await initializeTaskQueue();
    const workspace = "queue-test";
    const taskDirectory = join(dataPath, workspace, "tasks");
    await mkdir(taskDirectory, { recursive: true });
    await mkdir(join(dataPath, workspace, "files"), { recursive: true });
    await mkdir(join(dataPath, workspace, "history"), { recursive: true });
    const makeTask = async (id) => {
      const task = { id, title: id, description: "Complete it", status: "todo", comments: [] };
      await writeFile(join(taskDirectory, `${id}.json`), JSON.stringify(task));
      return task;
    };
    const task = await makeTask("retry-task");
    let workerCalls = 0;
    let reviewerCalls = 0;
    const dependencies = {
      worker: async () => {
        workerCalls += 1;
      },
      reviewer: async () => {
        reviewerCalls += 1;
        return reviewerCalls === 1
          ? { complete: false, percent: 70, summary: "Incomplete", guidance: "Add a regression test" }
          : { complete: true, percent: 100, summary: "All criteria met", guidance: "" };
      },
    };
    await processTask(workspace, task, dependencies);
    let persisted = JSON.parse(await readFile(join(taskDirectory, `${task.id}.json`), "utf8"));
    assert.equal(persisted.status, "in-progress");
    assert.equal(persisted.comments[0].content, "Add a regression test");
    assert.equal(persisted.execution.phase, "queued");
    await processTask(workspace, persisted, dependencies);
    persisted = JSON.parse(await readFile(join(taskDirectory, `${task.id}.json`), "utf8"));
    assert.equal(persisted.status, "verified");
    assert.equal(workerCalls, 2);
    assert.equal(reviewerCalls, 2);

    const duplicate = await makeTask("duplicate-task");
    let releaseWorker;
    let notifyWorker;
    const workerBlocked = new Promise((resolve) => {
      releaseWorker = resolve;
    });
    const workerStarted = new Promise((resolve) => {
      notifyWorker = resolve;
    });
    const first = processTask(workspace, duplicate, {
      worker: async () => {
        notifyWorker();
        await workerBlocked;
      },
      reviewer: async () => ({ complete: true, percent: 100, summary: "done", guidance: "" }),
    });
    await workerStarted;
    assert.equal(await processTask(workspace, duplicate, dependencies), false);
    assert.equal(
      (
        await invoke(
          routes["PATCH /workspaces/:name/tasks/:id"],
          { status: "todo" },
          { name: workspace, id: duplicate.id },
        )
      ).status,
      409,
    );
    const sibling = await makeTask("parallel-task");
    assert.equal(await processTask(workspace, sibling, dependencies), false);
    releaseWorker();
    await first;

    const exhausted = await makeTask("exhausted-task");
    const queryUrl = new URL("query", new URL(".", process.env.DATABASE_URL));
    await fetch(queryUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        s: "INSERT OR IGNORE INTO task_queue(workspace,task_id,state,rounds,updated_at) VALUES(:workspace,:task_id,'queued',10,:now)",
        d: { workspace, task_id: exhausted.id, now: Date.now() },
        m: "run",
      }),
    });
    await processTask(workspace, exhausted, dependencies);
    persisted = JSON.parse(await readFile(join(taskDirectory, `${exhausted.id}.json`), "utf8"));
    assert.equal(persisted.status, "in-progress");
    assert.match(persisted.comments[0].content, /review limit reached/i);
    assert.equal(persisted.execution.phase, "needs-human");
  },
);

test("a manually completed task is reviewed before any worker is started", { skip: !hasTestDatabase }, async () => {
  await initializeTaskQueue();
  const workspace = "manual-review-test";
  const directory = join(dataPath, workspace, "tasks");
  await mkdir(directory, { recursive: true });
  await mkdir(join(dataPath, workspace, "files"), { recursive: true });
  await mkdir(join(dataPath, workspace, "history"), { recursive: true });
  const task = {
    id: "manual-done",
    title: "Review manual completion",
    description: "Check it",
    status: "done",
    comments: [],
  };
  await writeFile(join(directory, `${task.id}.json`), JSON.stringify(task));
  let workerStarted = false;
  const processed = await processTask(workspace, task, {
    worker: async () => {
      workerStarted = true;
    },
    reviewer: async () => ({
      complete: false,
      percent: 80,
      summary: "One criterion is missing",
      guidance: "Add the missing validation",
    }),
  });
  const persisted = JSON.parse(await readFile(join(directory, `${task.id}.json`), "utf8"));
  assert.equal(processed, true);
  assert.equal(workerStarted, false);
  assert.equal(persisted.status, "in-progress");
  assert.equal(persisted.comments[0].content, "Add the missing validation");
  assert.equal(persisted.execution.phase, "queued");
});

test("session history sorts by latest durable activity, not session creation", async () => {
  const historyPath = join(dataPath, "sample/history");
  await mkdir(historyPath, { recursive: true });
  await writeFile(
    join(historyPath, "older.json"),
    JSON.stringify({ id: "older", title: "Older chat", createdAt: Date.now() - 60_000, messages: [] }),
  );
  await writeFile(
    join(historyPath, "newer.json"),
    JSON.stringify({ id: "newer", title: "Newer chat", createdAt: Date.now(), messages: [] }),
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  const { History } = await import(pathToFileURL(join(process.cwd(), "server/history.mjs")));
  await new History("sample", "older").push({ role: "assistant", content: "An agent update" });

  const result = await invoke(routes["GET /workspaces/:name/history"], {}, { name: "sample" });
  assert.deepEqual(
    result.value.map((session) => session.id),
    ["older", "newer"],
  );
  assert.ok(result.value[0].updatedAt > result.value[1].updatedAt);
});

test(
  "workspace archive is reversible and permanent deletion removes its DB record and files",
  { skip: !hasTestDatabase },
  async () => {
    const archived = await invoke(routes["POST /workspaces/:name/archive"], {}, { name: "sample" });
    assert.equal(archived.status, 204);
    assert.deepEqual((await invoke(routes["GET /workspaces"])).value, []);
    const all = await invoke(routes["GET /workspaces"], {}, {}, "user:alice", "/workspaces?includeArchived=true");
    assert.equal(all.value.length, 1);
    assert.equal(all.value[0].archived, 1);
    assert.equal(all.value[0].description, "A short description");

    const restored = await invoke(routes["POST /workspaces/:name/restore"], {}, { name: "sample" });
    assert.equal(restored.status, 204);
    assert.equal((await invoke(routes["GET /workspaces"])).value.length, 1);

    const deleted = await invoke(routes["DELETE /workspaces/:name"], {}, { name: "sample" });
    assert.equal(deleted.status, 204);
    assert.deepEqual(
      (await invoke(routes["GET /workspaces"], {}, {}, "user:alice", "/workspaces?includeArchived=true")).value,
      [],
    );
  },
);
