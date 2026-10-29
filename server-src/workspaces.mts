import { adjectives, colors, names, uniqueNamesGenerator } from "unique-names-generator";
import { randomUUID } from "node:crypto";
import { exec } from "@cloud-cli/exec";
import { createGzip } from "node:zlib";
import { createReadStream, existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getModelList, pullModel } from "./backend/ollama.mjs";
import { dataDir } from "./env.mjs";
import { clonePublicRepository } from "./tools/git-repository.mjs";
import { History } from "./history.mjs";
import { runAgentLoop } from "./agents.mjs";
import { publish } from "./events.mjs";
import {
  deleteConnector,
  deleteGitMiniConnector,
  createGitMiniRepository,
  getGitMiniConnector,
  getConfiguredModels,
  listConnectors,
  pollChatgptLogin,
  saveConnector,
  saveGitMiniConnector,
  startChatgptLogin,
} from "./connectors.mjs";
import { addTeamMember, createTeam, readTeam, teamFor } from "./teams.mjs";
import { mutateTaskFile } from "./task-store.mjs";
import { enqueueTask, enqueueTaskReview, markTaskVerified, taskIsActive } from "./task-queue.mjs";
import {
  listWorkspaces,
  removeWorkspace,
  saveDescription,
  setArchived,
  workspaceDescription,
} from "./workspace-registry.mjs";

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

async function onGitMiniConnector(req, res) {
  try {
    const input = JSON.parse(Buffer.concat(await req.toArray()).toString("utf8"));
    res.sendJson(await saveGitMiniConnector(await connectorScope(req.authSubject), input));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not configure GitMini";
    const status =
      Number((error as { statusCode?: number }).statusCode) ||
      (/^Enter a valid GitMini/.test(message) ? 400 : /^GitMini URL/.test(message) ? 500 : 502);
    res.sendJson({ error: message }, status);
  }
}
async function onDeleteGitMini(req, res) {
  try {
    await deleteGitMiniConnector(await connectorScope(req.authSubject));
    res.writeHead(204).end();
  } catch {
    res.sendJson({ error: "Could not disconnect GitMini" }, 500);
  }
}

async function onLinkGitMiniRepository(req, res, params) {
  const rawName = String(params.name || "");
  const name = sanitize(rawName);
  if (!name || name !== rawName) {
    return res.sendJson({ error: "Invalid workspace name" }, 400);
  }
  const workspace = join(dataDir, name);
  if (!existsSync(workspace)) {
    return res.sendJson({ error: "Workspace not found" }, 404);
  }
  try {
    const input = JSON.parse(await readLimitedRequestBody(req, repositoryRequestLimit));
    const repo = typeof input.repo === "string" ? input.repo.trim() : name;
    if (!/^(?=.{1,100}$)[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(repo)) {
      return res.sendJson({ error: "Invalid repository name" }, 400);
    }
    const credential = await getGitMiniConnector(await connectorScope(req.authSubject));
    if (!credential) {
      return res.sendJson({ error: "Connect GitMini in team settings first" }, 409);
    }
    const remoteUrl = `${credential.baseUrl}/git/${encodeURIComponent(credential.org)}/${encodeURIComponent(repo)}.git`;
    const files = join(workspace, "files");
    await mkdir(files, { recursive: true });
    const result = await serializeMutation(join(workspace, "config", "workspace.json"), async () => {
      const metadataFile = join(workspace, "config", "workspace.json");
      const metadata = (await readMetadata(workspace, name)).metadata;
      const previouslyLinked = Boolean(metadata.gitmini);
      const pendingMatches = metadata.gitminiPending?.org === credential.org && metadata.gitminiPending?.repo === repo;
      const current = await exec("git", ["-C", files, "remote", "get-url", "gitmini"], { cwd: files })
        .then((r) => r.stdout.trim())
        .catch(() => "");
      if (current && current !== remoteUrl) {
        throw Object.assign(new Error("A conflicting gitmini remote already exists"), { statusCode: 409 });
      }
      if (metadata.gitmini && (metadata.gitmini.org !== credential.org || metadata.gitmini.repo !== repo)) {
        throw Object.assign(new Error("Workspace is already linked to a different GitMini repository"), {
          statusCode: 409,
        });
      }
      if (metadata.gitminiPending && !pendingMatches) {
        throw Object.assign(new Error("Workspace has a pending GitMini setup for a different repository"), {
          statusCode: 409,
        });
      }
      let repositoryAlreadyExists = false;
      if (!previouslyLinked && (pendingMatches || current !== remoteUrl)) {
        const listed = await fetch(`${credential.baseUrl}/api/v1/orgs/${encodeURIComponent(credential.org)}/repos`, {
          headers: { authorization: `Bearer ${credential.token}` },
          redirect: "error",
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);
        if (!listed?.ok) {
          throw Object.assign(new Error("Could not verify whether the GitMini repository already exists"), {
            statusCode: 502,
          });
        }
        const repoList: any = await listed.json().catch(() => null);
        if (!Array.isArray(repoList?.repos)) {
          throw Object.assign(new Error("GitMini returned an invalid repository list"), { statusCode: 502 });
        }
        repositoryAlreadyExists = repoList.repos.some((item: any) => item?.repo === repo);
        if (repositoryAlreadyExists && !pendingMatches) {
          throw Object.assign(new Error("GitMini repository already exists and is not linked to this workspace"), {
            statusCode: 409,
          });
        }
      }
      if (!current) {
        const isRepo = await exec("git", ["-C", files, "rev-parse", "--is-inside-work-tree"], { cwd: files })
          .then((r) => r.stdout.trim() === "true")
          .catch(() => false);
        if (!isRepo) {
          await exec("git", ["-C", files, "init", "-b", "main"], { cwd: files });
        }
        await exec("git", ["-C", files, "remote", "add", "gitmini", remoteUrl], { cwd: files });
      }
      if (!previouslyLinked && !pendingMatches) {
        metadata.gitminiPending = { org: credential.org, repo };
        await atomicJson(metadataFile, metadata);
      }
      if (!repositoryAlreadyExists) {
        await createGitMiniRepository(credential, repo);
      }
      metadata.gitmini = { org: credential.org, repo };
      delete metadata.gitminiPending;
      await atomicJson(metadataFile, metadata);
      return { org: credential.org, repo, remote: "gitmini", ready: true };
    });
    res.sendJson(result);
  } catch (error) {
    const status = Number((error as any)?.statusCode) || (error instanceof SyntaxError ? 400 : 500);
    res.sendJson({ error: error instanceof Error ? error.message : "Could not link GitMini repository" }, status);
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
    const params = new URL(req.url, "http://localhost").searchParams;
    res.sendJson(
      await listWorkspaces(dataDir, params.get("includeArchived") === "true" || params.get("archived") === "true"),
    );
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

const repositoryRequestLimit = 4096;
async function readLimitedRequestBody(req, limit: number) {
  const declaredLength = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    req.resume?.();
    throw Object.assign(new Error("Repository request is too large"), { statusCode: 413 });
  }
  const chunks: Buffer[] = [];
  let size = 0;
  const source =
    typeof req[Symbol.asyncIterator] === "function"
      ? req
      : (async function* () {
          yield* await req.toArray();
        })();
  for await (const chunk of source) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      req.resume?.();
      throw Object.assign(new Error("Repository request is too large"), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
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
        await saveDescription(name, body.description);
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
      const description = await workspaceDescription(name);
      if (description !== undefined) {
        normalized.description = normalized.summary = description;
      }
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

async function onLinkWorkspaceRepository(req, res, params, _searchParams, cloneRepo = clonePublicRepository) {
  const originalName = String(params.name || "");
  const name = sanitize(originalName);
  if (!name || name !== originalName) {
    return res.sendJson({ error: "Invalid workspace name" }, 400);
  }
  const workspace = join(dataDir, name);
  const files = join(workspace, "files");
  if (!existsSync(workspace)) {
    return res.sendJson({ error: "Workspace not found" }, 404);
  }
  try {
    const body = JSON.parse(await readLimitedRequestBody(req, repositoryRequestLimit));
    if (!body || typeof body.repositoryUrl !== "string" || body.repositoryUrl.length > 2048) {
      throw new Error("Enter a public HTTPS repository URL");
    }
    const result = await serializeMutation(join(workspace, "config", "workspace.json"), async () => {
      await mkdir(files, { recursive: true });
      const entries = await readdir(files);
      if (entries.length) {
        throw new Error("Repository linking requires an empty workspace files folder");
      }
      const stagingName = `.age-repository-${randomUUID()}`;
      const stagingPath = join(workspace, stagingName);
      if (existsSync(stagingPath)) {
        const conflict = new Error("Repository staging path is already in use");
        Object.assign(conflict, { statusCode: 409 });
        throw conflict;
      }
      await mkdir(stagingPath, { mode: 0o700 });
      const context = {
        workspacePath: workspace,
        getPath: (path: string) => {
          if (path === ".") {
            return files;
          }
          if (path === stagingName) {
            return stagingPath;
          }
          throw new Error("Invalid repository staging path");
        },
      };
      const movedEntries: string[] = [];
      try {
        const cloned = await cloneRepo.call(context, body.repositoryUrl, stagingName);
        if ((await readdir(files)).length !== 0) {
          const conflict = new Error("Workspace files changed while linking the repository");
          Object.assign(conflict, { statusCode: 409 });
          throw conflict;
        }
        const clonedEntries = await readdir(stagingPath);
        for (const entry of clonedEntries) {
          await rename(join(stagingPath, entry), join(files, entry));
          movedEntries.push(entry);
        }
        await rm(stagingPath, { recursive: true, force: true });
        const { file, metadata } = await readMetadata(workspace, name);
        metadata.repositoryUrl = cloned.url;
        await atomicJson(file, metadata);
        return { repositoryUrl: cloned.url };
      } catch (error) {
        let rollbackComplete = true;
        if (movedEntries.length) {
          await mkdir(stagingPath, { recursive: true }).catch(() => {
            rollbackComplete = false;
          });
          for (const entry of movedEntries.reverse()) {
            await rename(join(files, entry), join(stagingPath, entry)).catch(() => {
              rollbackComplete = false;
            });
          }
        }
        if (rollbackComplete) {
          await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
        } else {
          console.error(`Repository rollback incomplete; staged data preserved at ${stagingName}`);
          throw Object.assign(
            new Error("Repository linking failed; partial repository data was preserved for recovery"),
            { statusCode: 500 },
          );
        }
        throw error;
      }
    });
    res.sendJson(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not link repository";
    const statusCode = (error as { statusCode?: number }).statusCode;
    const status =
      statusCode ||
      (error instanceof SyntaxError
        ? 400
        : /empty workspace/i.test(message)
          ? 409
          : /enter a public HTTPS|repository URL|Private network destinations|IPv6 literal|public IPv4|HTTPS port/i.test(
                message,
              )
            ? 400
            : 502);
    if (status >= 500) {
      const details = String((error as { details?: string }).details || message)
        .replace(/https?:\/\/\S+/gi, "[repository URL]")
        .replace(/\/data\/[^\s,:'"]+/g, "[workspace path]")
        .replace(/[\r\n\t]+/g, " ")
        .slice(0, 500);
      const errorName = error instanceof Error ? error.name : "UnknownError";
      console.error(`Workspace repository link failed (${errorName}): ${details}`);
    }
    const publicMessage =
      status === 502 ? "Could not clone repository. Verify the public HTTPS URL and try again." : message;
    res.sendJson({ error: publicMessage.slice(0, 600) }, status);
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
      status: "todo",
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
    if (!["todo", "new", "in-progress", "done", "verified"].includes(body.status)) {
      throw new Error("Invalid task status");
    }
    if (await taskIsActive(name, id)) {
      return res.sendJson({ error: "This task is currently being worked or reviewed" }, 409);
    }
    const status = body.status === "new" ? "todo" : body.status;
    let previousStatus: string | undefined;
    let previousExecutionPhase: string | undefined;
    const updated = await mutateTaskFile(file, (task) => {
      previousStatus = task.status;
      previousExecutionPhase = task.execution?.phase;
      if (
        task.status === "done" &&
        status === "in-progress" &&
        (typeof body.guidance !== "string" || !body.guidance.trim() || body.guidance.length > 5_000)
      ) {
        throw new Error(
          "Guidance comment (up to 5,000 characters) is required when returning a completed task to in progress",
        );
      }
      if (status === "verified" && !["done", "verified"].includes(task.status)) {
        throw new Error("Only a completed task can be verified");
      }
      task.status = status;
      if (status === "done" && (previousStatus !== "done" || previousExecutionPhase === "error")) {
        task.execution = { ...(task.execution || {}), phase: "reviewing", updatedAt: new Date().toISOString() };
      }
      if (status === "verified") {
        task.execution = { ...(task.execution || {}), phase: "verified", updatedAt: new Date().toISOString() };
      }
      if (previousStatus === "done" && status === "in-progress") {
        task.comments = Array.isArray(task.comments) ? task.comments : [];
        task.comments.push({
          id: randomUUID(),
          author: req.authSubject,
          content: body.guidance.trim(),
          createdAt: new Date().toISOString(),
        });
        task.execution = { ...(task.execution || {}), phase: "queued", updatedAt: new Date().toISOString() };
      }
      return task;
    });
    if (status === "todo" || (status === "in-progress" && previousStatus !== "in-progress")) {
      await enqueueTask(name, id);
    }
    if (status === "done" && (previousStatus !== "done" || previousExecutionPhase === "error")) {
      await enqueueTaskReview(name, id);
    }
    if (status === "verified") {
      await markTaskVerified(name, id);
    }
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
    await listWorkspaces(dataDir, true);

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
      files.map(async (file) => {
        const task = JSON.parse(await readFile(join(directory, file), "utf8"));
        if (["new", "queued"].includes(task.status)) {
          task.status = "todo";
        }
        return task;
      }),
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
    await removeWorkspace(name);
    res.writeHead(204).end();
  } catch (err: any) {
    res.sendJson({ error: err.message }, 500);
  }
}

async function onArchiveWorkspace(_req, res, params) {
  const name = sanitize(params.name);
  if (!existsSync(join(dataDir, name))) {
    return res.sendJson({ error: "Workspace not found" }, 404);
  }
  try {
    await setArchived(name, true);
    res.writeHead(204).end();
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not archive workspace" }, 503);
  }
}
async function onRestoreWorkspace(_req, res, params) {
  const name = sanitize(params.name);
  if (!existsSync(join(dataDir, name))) {
    return res.sendJson({ error: "Workspace not found" }, 404);
  }
  try {
    await setArchived(name, false);
    res.writeHead(204).end();
  } catch (error) {
    res.sendJson({ error: error instanceof Error ? error.message : "Could not restore workspace" }, 503);
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
      const updatedAt = Number(json.updatedAt) || statSync(join(workspacePath, file.name)).mtimeMs;
      return { ...json, updatedAt };
    }),
  );
  res.sendJson(json.sort((a, b) => b.updatedAt - a.updatedAt));
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
      role: body.role,
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
  "PUT /connectors/gitmini": onGitMiniConnector,
  "DELETE /connectors/gitmini": onDeleteGitMini,
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
  "POST /workspaces/:name/archive": onArchiveWorkspace,
  "POST /workspaces/:name/restore": onRestoreWorkspace,

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
  "POST /workspaces/:name/repository": onLinkWorkspaceRepository,
  "POST /workspaces/:name/gitmini": onLinkGitMiniRepository,
  "GET /workspaces/:name/tasks": onReadTasks,
  "POST /workspaces/:name/tasks": onCreateTask,
  "GET /workspaces/:name/tasks/:id": onReadTask,
  "PATCH /workspaces/:name/tasks/:id": onUpdateTask,
  "POST /workspaces/:name/tasks/:id/comments": onAddTaskComment,
  "GET /workspaces/:name": onReadWorkspace,
  "DELETE /workspaces/:name": onDeleteWorkspace,
};
