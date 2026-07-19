import { adjectives, colors, names, uniqueNamesGenerator } from "unique-names-generator";
import { randomUUID } from "node:crypto";
import { createGzip } from "node:zlib";
import { createReadStream, existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getModelList, pullModel } from "./ollama-api.mjs";
import { dataDir } from "./env.mjs";
import { History } from "./history.mjs";
import { spawn } from "node:child_process";
import { publish } from "./events.mjs";
import { runAgentLoop } from "./agents.mjs";

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

    const workspaces = files.filter((file) => file.isDirectory());

    const json = await Promise.all(
      workspaces.map(async (file) => ({
        name: file.name,
        createdAt: await stat(join(dataDir, file.name)).then((stats) => stats.birthtime.getTime()),
      })),
    );

    res.sendJson(json);
  } catch (err) {
    res.sendJson({ error: err.message }, 500);
  }
}

const workspaceFolders = ["files", "history", "config"];

async function onCreateWorkspace(req, res) {
  const body = Buffer.concat(await req.toArray()).toString("utf8");
  const name = sanitize((body.trim() && JSON.parse(body)?.name) || randomName());

  const workspacePath = join(dataDir, name);

  try {
    await mkdir(workspacePath, { recursive: true });

    for (const folder of workspaceFolders) {
      await mkdir(join(workspacePath, folder), { recursive: true });
    }

    res.sendJson({ name }, 201);
  } catch (err) {
    res.sendJson({ error: err.message }, 500);
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
        if (exclude.includes(file.name)) return null;

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
  } catch (e) {
    console.log(e);
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
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
    await history.push({ role: "user", content: message, meta: { model, files, uid: randomUUID() } });
    tryAgentLoop(name, sessionId, res);
  } catch (err) {
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

  tryAgentLoop(name, sessionId, res);
}

async function tryAgentLoop(name, sessionId, res) {
  try {
    const history = new History(name, sessionId);
    if (process.env.AGENT_WORKERS) {
      await runAgentLoopSpawned(name, sessionId);
    } else {
      await runAgentLoop(name, sessionId);
    }
    res.sendJson(await history.read());
  } catch (e) {
    console.log('Agent loop error', e);
    res.sendJson({ error: e.message }, 500);
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
    console.log(e);
    res.writeHead(500).end();
  }
}

async function onModelList(_req, res) {
  res.sendJson(await getModelList());
}

async function onModelPull(_req, res, params) {
  const { name } = params;
  const success = await pullModel(name);
  res.sendJson(success, success ? 200 : 500);
}

async function runAgentLoopSpawned(name, sessionId) {
  return new Promise((resolve, reject) => {
    const agent = spawn(process.argv0, ["./agents.mjs", name, sessionId]);

    agent.on("exit", (code) => {
      if (code) {
        reject(new Error("Agent crashed: " + code));
      }
    });

    agent.on("close", () => {
      if (agent.exitCode > 0) {
        reject(new Error("Agent crashed :" + agent.exitCode));
      }

      resolve(sessionId);
    });

    agent.stdout.on("data", (line) => {
      try {
        const msg = JSON.parse(line.trim());
        console.log("agent", msg);
        publish(msg.type, msg.data);
      } catch {
        console.log("Failed to parse", line);
      }
    });
  });
}

export default {
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

  "GET /workspaces/:name": onReadWorkspace,
  "DELETE /workspaces/:name": onDeleteWorkspace,
};
