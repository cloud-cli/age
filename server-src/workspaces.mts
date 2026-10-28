import { adjectives, colors, names, uniqueNamesGenerator } from "unique-names-generator";
import { randomUUID } from "node:crypto";
import { createGzip } from "node:zlib";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getModelList, pullModel } from "./backend/ollama.mjs";
import { dataDir } from "./env.mjs";
import { History } from "./history.mjs";
import { runAgentLoop } from "./agents.mjs";
import { publish } from "./events.mjs";
import {
  deleteConnector,
  getConfiguredModels,
  listConnectors,
  pollChatgptLogin,
  saveConnector,
  startChatgptLogin,
} from "./connectors.mjs";
import { addTeamMember, createTeam, readTeam, teamFor } from "./teams.mjs";
import { mutateTaskFile } from "./task-store.mjs";

async function connectorScope(subject) {
  const teamId = await teamFor(subject);
  if (!teamId) {
    throw new Error("Create or join a team to use shared integrations");
  }
  return `team:${teamId}`;
}

async function onTeam(req, res) {
  res.sendJson((await readTeam(req.authSubject)) || {});
}
async function onCreateTeam(req, res) {
  try {
    const body = JSON.parse(Buffer.concat(await req.toArray()).toString("utf8"));
    res.sendJson(await createTeam(req.authSubject, body.name || ""), 201);
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not create team" }, 400);
  }
}
async function onAddTeamMember(req, res) {
  try {
    const body = JSON.parse(Buffer.concat(await req.toArray()).toString("utf8"));
    res.sendJson(await addTeamMember(req.authSubject, body.subject), 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not add team member";
    res.sendJson({ error: message }, /Team admin/.test(message) ? 403 : 400);
  }
}

async function onListConnectors(req, res) {
  try {
    res.sendJson(await listConnectors(await connectorScope(req.authSubject)));
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not load connector settings" }, 500);
  }
}

async function onSaveConnector(req, res) {
  try {
    const body = Buffer.concat(await req.toArray()).toString("utf8");
    res.sendJson(await saveConnector(await connectorScope(req.authSubject), JSON.parse(body)));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save connector settings";
    const status = /^(Unsupported|Invalid|Enter|Ollama)/.test(message) ? 400 : 500;
    res.sendJson({ error: message }, status);
  }
}

async function onDeleteConnector(req, res, params) {
  try {
    await deleteConnector(await connectorScope(req.authSubject), params.provider, params.id);
    res.writeHead(204).end();
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not disconnect provider" }, 400);
  }
}

async function onTestConnector(req, res, params) {
  try {
    const models = await getConfiguredModels(await connectorScope(req.authSubject), params.provider, params.id);
    if (!models.length) {
      res.sendJson({ error: "No models were returned by this connector" }, 502);
      return;
    }
    res.sendJson({ models });
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not reach connector" }, 502);
  }
}

async function onStartChatgptLogin(req, res) {
  try {
    res.sendJson(await startChatgptLogin(await connectorScope(req.authSubject)));
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not start ChatGPT sign-in" }, 502);
  }
}

async function onPollChatgptLogin(req, res, params) {
  try {
    res.sendJson(await pollChatgptLogin(await connectorScope(req.authSubject), params.id));
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not complete ChatGPT sign-in" }, 400);
  }
}

const randomName = () =>
  uniqueNamesGenerator({
    dictionaries: [adjectives, colors, names],
  }).toLowerCase();

const sanitize = (str) => str.replace(/[^a-zA-Z0-9-_]/g, "");

// returns a list of directories in the dataDir
async function onReadWorkspaceList(req, res) {
  try {
    const files = await readdir(dataDir, {
      withFileTypes: true,
      encoding: "utf8",
    });

    const workspaces = files.filter(
      (file) =>
        file.isDirectory() &&
        (existsSync(join(dataDir, file.name, "config", "workspace.json")) ||
          existsSync(join(dataDir, file.name, "config", "project.json"))),
    );

    const json = await Promise.all(
      workspaces.map(async (file) => ({
        name: file.name,
        createdAt: await stat(join(dataDir, file.name)).then((stats) => stats.birthtime.getTime()),
      })),
    );

    res.sendJson(json);
  } catch (err: any) {
    res.sendJson({ error: err.message }, 500);
  }
}

const workspaceFolders = ["files", "history", "config", "tasks"];

// Serialize mutations in this process and replace files atomically so concurrent updates cannot
// truncate JSON or overwrite fields loaded by an earlier request.
const mutationQueues = new Map<string, Promise<unknown>>();
const isMissingFile = (error: unknown) => (error as NodeJS.ErrnoException)?.code === "ENOENT";
function serializeMutation<T>(key: string, mutation: () => Promise<T>): Promise<T> {
  const previous = mutationQueues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(mutation);
  mutationQueues.set(key, current);
  return current.finally(() => {
    if (mutationQueues.get(key) === current) {
      mutationQueues.delete(key);
    }
  });
}

async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { flag: "wx" });
  await rename(temporary, file);
}

function defaultWorkspaceMetadata(name: string) {
  return {
    name,
    description: "",
    summary: "",
    goals: [],
    revision: 0,
    recentUpdates: [],
    nextSteps: [],
    createdAt: new Date().toISOString(),
  };
}

async function readMetadata(workspace: string, name: string) {
  const config = join(workspace, "config");
  const file = join(config, "workspace.json");
  await mkdir(config, { recursive: true });
  if (!existsSync(file)) {
    const legacyFile = join(config, "project.json");
    let metadata = defaultWorkspaceMetadata(name);
    if (existsSync(legacyFile)) {
      metadata = normalizeMetadata(JSON.parse(await readFile(legacyFile, "utf8")));
    }
    await atomicJson(file, metadata);
  }
  const metadata = JSON.parse(await readFile(file, "utf8"));
  normalizeMetadata(metadata);
  return { file, metadata };
}

function normalizeMetadata(metadata: any) {
  metadata.revision = Number.isInteger(metadata.revision) && metadata.revision >= 0 ? metadata.revision : 0;
  metadata.description =
    typeof metadata.description === "string"
      ? metadata.description
      : typeof metadata.summary === "string"
        ? metadata.summary
        : "";
  if (!Array.isArray(metadata.goals)) {
    metadata.goals = [];
  }
  metadata.goals = metadata.goals.map((goal) => {
    if (typeof goal === "string") {
      return { id: randomUUID(), title: goal, description: "" };
    }
    return {
      ...goal,
      id: typeof goal?.id === "string" && goal.id ? goal.id : randomUUID(),
      title: typeof goal?.title === "string" ? goal.title : String(goal?.name || ""),
      description: typeof goal?.description === "string" ? goal.description : "",
    };
  });
  return metadata;
}

class WorkspaceConflictError extends Error {}

function validGoal(goal: any) {
  return (
    goal &&
    typeof goal === "object" &&
    !Array.isArray(goal) &&
    typeof goal.title === "string" &&
    goal.title.trim().length > 0 &&
    goal.title.trim().length <= 200 &&
    typeof goal.description === "string" &&
    goal.description.length <= 5_000
  );
}

async function onUpdateWorkspaceSettings(req, res, params) {
  const name = sanitize(params.name);
  const workspace = join(dataDir, name);
  if (!existsSync(workspace)) {
    return res.sendJson({ error: "Workspace not found" }, 404);
  }
  try {
    const body = JSON.parse(Buffer.concat(await req.toArray()).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Invalid settings");
    }
    if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 5_000)) {
      throw new Error("Description must be text");
    }
    if (
      body.goals !== undefined &&
      (!Array.isArray(body.goals) || body.goals.length > 100 || body.goals.some((goal) => !validGoal(goal)))
    ) {
      throw new Error("Goals must have a title and description");
    }
    if (body.goals !== undefined && (!Number.isInteger(body.revision) || body.revision < 0)) {
      throw new Error("Reload workspace settings before saving goals");
    }
    const { file } = await readMetadata(workspace, name);
    const updated = await serializeMutation(file, async () => {
      const current = JSON.parse(await readFile(file, "utf8"));
      if (body.goals !== undefined && (current.revision || 0) !== body.revision) {
        throw new WorkspaceConflictError("Goals changed elsewhere. Reload workspace settings and try again.");
      }
      if (body.description !== undefined) {
        current.description = body.description;
        current.summary = body.description;
      }
      if (body.goals !== undefined) {
        current.goals = body.goals.map((goal) => ({
          id: typeof goal.id === "string" && goal.id ? goal.id : randomUUID(),
          title: goal.title.trim(),
          description: goal.description,
        }));
        current.revision = (current.revision || 0) + 1;
      }
      await atomicJson(file, current);
      return current;
    });
    res.sendJson(updated);
  } catch (error) {
    const status = error instanceof WorkspaceConflictError ? 409 : 400;
    res.sendJson({ error: error instanceof Error ? error.message : "Could not update workspace settings" }, status);
  }
}

async function onReadWorkspaceSettings(_req, res, params) {
  const name = sanitize(params.name);
  const workspace = join(dataDir, name);
  if (!existsSync(workspace)) {
    return res.sendJson({ error: "Workspace not found" }, 404);
  }
  try {
    const { file } = await readMetadata(workspace, name);
    const metadata = await serializeMutation(file, async () => {
      const current = JSON.parse(await readFile(file, "utf8"));
      const normalized = normalizeMetadata(current);
      if (JSON.stringify(normalized) !== JSON.stringify(current)) {
        await atomicJson(file, normalized);
      }
      return normalized;
    });
    res.sendJson(metadata);
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not read workspace settings" }, 500);
  }
}

async function onCreateTask(req, res, params) {
  const name = sanitize(params.name);
  const directory = join(dataDir, name, "tasks");
  if (!existsSync(join(dataDir, name))) {
    return res.sendJson({ error: "Workspace not found" }, 404);
  }
  try {
    const body = JSON.parse(Buffer.concat(await req.toArray()).toString("utf8"));
    if (
      !body ||
      typeof body.title !== "string" ||
      !body.title.trim() ||
      body.title.trim().length > 200 ||
      (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 10_000))
    ) {
      throw new Error("Invalid task details");
    }
    if (body.goalId !== undefined) {
      const { metadata } = await readMetadata(join(dataDir, name), name);
      if (typeof body.goalId !== "string" || !metadata.goals.some((goal) => goal.id === body.goalId)) {
        throw new Error("Goal not found");
      }
    }
    const task = {
      id: randomUUID(),
      title: body.title.trim(),
      description: typeof body.description === "string" ? body.description : "",
      goalId: typeof body.goalId === "string" ? body.goalId : undefined,
      status: "new",
      comments: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await mkdir(directory, { recursive: true });
    await atomicJson(join(directory, `${task.id}.json`), task);
    res.sendJson(task, 201);
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not create task" }, 400);
  }
}

async function onUpdateTask(req, res, params) {
  const name = sanitize(params.name);
  const id = sanitize(params.id);
  const file = join(dataDir, name, "tasks", `${id}.json`);
  try {
    const body = JSON.parse(Buffer.concat(await req.toArray()).toString("utf8"));
    if (!["new", "in-progress", "done"].includes(body.status)) {
      throw new Error("Invalid task status");
    }
    const updated = await mutateTaskFile(file, (task) => {
      task.status = body.status;
      return task;
    });
    res.sendJson(updated);
  } catch (error) {
    const missing = isMissingFile(error);
    res.sendJson(
      { error: missing ? "Task not found" : error instanceof Error ? error.message : "Could not update task" },
      missing ? 404 : 400,
    );
  }
}

async function addTaskComment(name: string, id: string, content: string, author: string) {
  if (typeof content !== "string" || !content.trim() || content.length > 5_000) {
    throw new Error("Comment is required");
  }
  const file = join(dataDir, sanitize(name), "tasks", `${sanitize(id)}.json`);
  return mutateTaskFile(file, (task) => {
    const comment = { id: randomUUID(), author, content: content.trim(), createdAt: new Date().toISOString() };
    task.comments = Array.isArray(task.comments) ? task.comments : [];
    task.comments.push(comment);
    return { task, comment };
  });
}

async function onAddTaskComment(req, res, params) {
  try {
    const body = JSON.parse(Buffer.concat(await req.toArray()).toString("utf8"));
    const result = await addTaskComment(params.name, params.id, body.content, req.authSubject);
    res.sendJson(result, 201);
  } catch (error) {
    const missing = isMissingFile(error);
    res.sendJson(
      { error: missing ? "Task not found" : error instanceof Error ? error.message : "Could not add comment" },
      missing ? 404 : 400,
    );
  }
}

async function onCreateWorkspace(req, res) {
  const body = Buffer.concat(await req.toArray()).toString("utf8");
  const name = sanitize((body.trim() && JSON.parse(body)?.name) || randomName());

  const workspacePath = join(dataDir, name);

  try {
    await mkdir(workspacePath, { recursive: true });

    for (const folder of workspaceFolders) {
      await mkdir(join(workspacePath, folder), { recursive: true });
    }
    await atomicJson(join(workspacePath, "config", "workspace.json"), defaultWorkspaceMetadata(name)).catch(() => {});

    res.sendJson({ name }, 201);
  } catch (err: any) {
    res.sendJson({ error: err.message }, 500);
  }
}

async function onReadTasks(req, res, params) {
  const workspace = join(dataDir, sanitize(params.name));
  const directory = join(workspace, "tasks");
  try {
    if (!existsSync(workspace)) {
      res.sendJson({ error: "Workspace not found" }, 404);
      return;
    }
    await mkdir(directory, { recursive: true });
    const files = (await readdir(directory)).filter((file) => file.endsWith(".json")).slice(0, 1000);
    const tasks = await Promise.all(
      files.map(async (file) => JSON.parse(await readFile(join(directory, file), "utf8"))),
    );
    const goalId = new URL(req.url, "http://localhost").searchParams.get("goalId");
    res.sendJson(goalId ? tasks.filter((task) => task.goalId === goalId) : tasks);
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Failed to read tasks" }, 500);
  }
}

async function onReadTask(_req, res, params) {
  const file = join(dataDir, sanitize(params.name), "tasks", `${sanitize(params.id)}.json`);
  try {
    res.sendJson(JSON.parse(await readFile(file, "utf8")));
  } catch (error) {
    res.sendJson(
      { error: isMissingFile(error) ? "Task not found" : "Could not read task" },
      isMissingFile(error) ? 404 : 500,
    );
  }
}

const exclude = [".git"];

async function onReadWorkspace(req, res, params) {
  const name = sanitize(params.name);
  const workspacePath = join(dataDir, name, "files");

  if (!existsSync(workspacePath)) {
    res.sendJson({ error: "Workspace not found" }, 404);
    return;
  }

  async function readFolder(folderPath) {
    const files = await readdir(folderPath, {
      withFileTypes: true,
      encoding: "utf8",
    });

    const result = await Promise.all(
      files.map(async (file) => {
        if (exclude.includes(file.name)) {
          return null;
        }

        const filePath = join(folderPath, file.name);
        if (file.isDirectory()) {
          return {
            name: file.name,
            path: filePath.replace(workspacePath, ""),
            type: "d",
            files: await readFolder(filePath),
          };
        } else {
          return {
            name: file.name,
            path: filePath.replace(workspacePath, ""),
            type: "f",
          };
        }
      }),
    );

    return result.filter(Boolean);
  }

  const workspaceFiles = await readFolder(workspacePath);
  const acceptEncoding = (req.headers["accept-encoding"] || "").includes("gzip");

  if (acceptEncoding) {
    res.writeHead(200, { "Content-Encoding": "gzip", "Content-Type": "application/json" });
    const src = createGzip();
    src.pipe(res);
    src.write(JSON.stringify(workspaceFiles));
    src.end();
  } else {
    res.sendJson(workspaceFiles);
  }
}

async function onReadFile(_req, res, params, searchParams) {
  const name = sanitize(params.name);
  const file = decodeURIComponent(searchParams.get("file"));

  if (!file) {
    res.sendJson("Not found", 400);
    return;
  }

  const workspacePath = join(dataDir, name, "files");
  const realPath = join(workspacePath, resolve("/", file));

  if (!existsSync(realPath)) {
    res.sendJson("Not found", 404);
    return;
  }

  res.setHeader("content-type", "text/plain");
  createReadStream(realPath).pipe(res);
}

async function onWriteFile(req, res, params, searchParams) {
  const name = sanitize(params.name);
  const file = decodeURIComponent(searchParams.get("file"));

  if (!file) {
    res.sendJson("Not found", 400);
    return;
  }

  const workspacePath = join(dataDir, name, "files");
  const realPath = join(workspacePath, resolve("/", file));
  const content = Buffer.concat(await req.toArray());

  try {
    await writeFile(realPath, content);
    res.writeHead(202).end();
    publish("filechange", { workspace: name, path: file });
  } catch (e) {
    console.error(e);
    res.writeHead(500).end();
  }
}

async function onDeleteWorkspace(req, res, params) {
  const name = sanitize(params.name);
  const workspacePath = join(dataDir, name);

  if (!existsSync(workspacePath)) {
    res.sendJson({ error: "Workspace not found" }, 404);
    return;
  }

  try {
    await rm(workspacePath, { recursive: true, force: true });
    res.writeHead(204).end();
  } catch (err: any) {
    res.sendJson({ error: err.message }, 500);
  }
}

async function onReadWorkspaceHistoryList(_req, res, params) {
  const name = sanitize(params.name);
  const workspacePath = join(dataDir, name, "history");

  if (!existsSync(workspacePath)) {
    res.sendJson({ error: "Workspace history not found" }, 404);
    return;
  }

  // Implementation for reading workspace history
  const files = await readdir(workspacePath, {
    withFileTypes: true,
    encoding: "utf8",
  });

  const sessions = files.filter((file) => file.isFile() && file.name.endsWith(".json"));
  const json = await Promise.all(
    sessions.map(async (file) => {
      const content = await readFile(join(workspacePath, file.name), "utf8");
      const json = JSON.parse(content);
      // delete messages from list API to reduce response length
      json.messages = [];
      return json;
    }),
  );

  res.sendJson(json);
}

async function onCreateWorkspaceHistory(req, res, params) {
  const name = sanitize(params.name);
  const uid = randomUUID();
  const workspacePath = join(dataDir, name, "history");

  if (!existsSync(workspacePath)) {
    res.sendJson({ error: "Workspace history not found" }, 404);
    return;
  }

  try {
    const body = JSON.parse(Buffer.concat(await req.toArray()).toString("utf8"));
    const json = {
      id: uid,
      title: body.title,
      model: body.model,
      createdAt: new Date().getTime(),
      messages: [],
    };
    await writeFile(join(workspacePath, `${uid}.json`), JSON.stringify(json));

    res.sendJson(json, 201);
  } catch (err: any) {
    res.sendJson({ error: err.message }, 500);
  }
}

async function onReadWorkspaceHistory(_req, res, params) {
  const name = sanitize(params.name);
  const id = sanitize(params.id);
  const workspacePath = join(dataDir, name, "history", `${id}.json`);

  if (!existsSync(workspacePath)) {
    res.sendJson({ error: "Workspace history not found" }, 404);
    return;
  }

  try {
    const content = JSON.parse(await readFile(workspacePath, "utf8"));
    res.sendJson(content);
  } catch (err: any) {
    res.sendJson({ error: err.message }, 500);
  }
}

async function onDeleteWorkspaceHistory(_req, res, params) {
  const name = sanitize(params.name);
  const id = sanitize(params.id);
  const workspacePath = join(dataDir, name, "history", `${id}.json`);

  if (!existsSync(workspacePath)) {
    res.sendJson({ error: "Workspace history not found" }, 404);
    return;
  }

  try {
    await rm(workspacePath, { force: true });
    res.writeHead(204).end();
  } catch (err: any) {
    res.sendJson({ error: err.message }, 500);
  }
}

async function onMessage(req, res, params) {
  const name = sanitize(params.name);
  const sessionId = sanitize(params.id);
  const history = new History(name, sessionId);

  if (!history.exists()) {
    console.error(`Workspace history not found: ${history.file}`);
    res.sendJson({ error: `Session ${sessionId} not found` }, 404);
    return;
  }

  const body = Buffer.concat(await req.toArray()).toString("utf8");

  try {
    const { message, model = "", files } = JSON.parse(body);
    const msg = { role: "user", content: message, meta: { model, files, uid: randomUUID() } };
    await history.push(msg);
    res.sendJson(msg);
    tryAgentLoop(name, sessionId, req.authSubject);
  } catch (err: any) {
    console.error(`Failed to add message in session ${history.file}: ${err}`);
    res.sendJson({ error: "Failed to push message" }, 400);
    return;
  }
}

async function onRetry(req, res, params) {
  const name = sanitize(params.name);
  const sessionId = sanitize(params.id);
  const history = new History(name, sessionId);

  if (!history.exists()) {
    console.error(`Workspace history not found: ${history.file}`);
    res.sendJson({ error: `Session ${sessionId} not found` }, 404);
    return;
  }

  res.sendJson({}, 202);
  tryAgentLoop(name, sessionId, req.authSubject);
}

async function tryAgentLoop(name, sessionId, subject) {
  publish("agent-status", { sessionId, status: "working" });
  try {
    await runAgentLoop(name, sessionId, 0, subject);
    publish("agent-status", { sessionId, status: "complete" });
  } catch (e) {
    console.log("Agent loop error", e);
    publish("agent-status", {
      sessionId,
      status: "error",
      error: "The agent could not complete the request. Check the provider configuration and try again.",
    });
  }
}

async function onDeleteMessage(_req, res, params) {
  const name = sanitize(params.name);
  const sessionId = sanitize(params.id);
  const uid = sanitize(params.uid);
  const history = new History(name, sessionId);

  if (!history.exists()) {
    console.error(`Workspace history not found: ${history.file}`);
    res.sendJson({ error: `Session ${sessionId} not found` }, 404);
    return;
  }

  try {
    const content = await history.read();
    content.messages = content.messages.filter((m) => m.meta?.uid !== uid);
    await history.write(content);

    res.writeHead(202).end();
  } catch (e) {
    console.error(e);
    res.writeHead(500).end();
  }
}

async function onModelList(req, res) {
  try {
    res.sendJson(await getModelList(await connectorScope(req.authSubject)));
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not load models" }, 502);
  }
}

async function onModelPull(_req, res, params) {
  const { name } = params;
  const success = await pullModel(name);
  res.sendJson(success, success ? 200 : 500);
}

export default {
  "GET /teams/current": onTeam,
  "POST /teams": onCreateTeam,
  "POST /teams/members": onAddTeamMember,
  "GET /connectors": onListConnectors,
  "PUT /connectors": onSaveConnector,
  "POST /connectors/chatgpt/login": onStartChatgptLogin,
  "GET /connectors/chatgpt/login/:id": onPollChatgptLogin,
  "DELETE /connectors/:provider": onDeleteConnector,
  "DELETE /connectors/ollama/:id": onDeleteConnector,
  "GET /connectors/:provider/models": onTestConnector,
  "GET /connectors/ollama/:id/models": onTestConnector,
  "GET /models": onModelList,
  "POST /models/:name": onModelPull,

  "GET /workspaces": onReadWorkspaceList,
  "POST /workspaces": onCreateWorkspace,

  "DELETE /workspaces/:name/history/:id/message/:uid": onDeleteMessage,
  "POST /workspaces/:name/history/:id/message": onMessage,
  "POST /workspaces/:name/history/:id/retry": onRetry,

  "GET /workspaces/:name/history/:id": onReadWorkspaceHistory,
  "DELETE /workspaces/:name/history/:id": onDeleteWorkspaceHistory,

  "GET /workspaces/:name/history": onReadWorkspaceHistoryList,
  "POST /workspaces/:name/history": onCreateWorkspaceHistory,

  "GET /workspaces/:name/file": onReadFile,
  "POST /workspaces/:name/file": onWriteFile,

  // Keep these specific routes above the generic workspace path; the router matches in declaration order.
  "GET /workspaces/:name/settings": onReadWorkspaceSettings,
  "PUT /workspaces/:name/settings": onUpdateWorkspaceSettings,
  "GET /workspaces/:name/tasks": onReadTasks,
  "POST /workspaces/:name/tasks": onCreateTask,
  "GET /workspaces/:name/tasks/:id": onReadTask,
  "PATCH /workspaces/:name/tasks/:id": onUpdateTask,
  "POST /workspaces/:name/tasks/:id/comments": onAddTaskComment,
  "GET /workspaces/:name": onReadWorkspace,
  "DELETE /workspaces/:name": onDeleteWorkspace,
};
