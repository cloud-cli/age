import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

const dataPath = await mkdtemp(join(tmpdir(), "age-workspaces-"));
process.env.DATA_PATH = dataPath;
const { default: routes } = await import(pathToFileURL(join(process.cwd(), "server/workspaces.mjs")));
const { CommentOnTask, UpdateTaskStatus } = await import(pathToFileURL(join(process.cwd(), "server/tools/core.mjs")));
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
  const stale = await invoke(
    routes["PUT /workspaces/:name/settings"],
    { goals: [{ title: "Stale", description: "Overwrite attempt" }], revision: value.revision },
    { name: "sample" },
  );
  assert.equal(stale.status, 409);
  const afterStale = await invoke(routes["GET /workspaces/:name/settings"], {}, { name: "sample" });
  assert.equal(afterStale.value.goals[0].title, "Target");
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

test("task status and comments persist with authenticated author, retaining legacy task records", async () => {
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
});
