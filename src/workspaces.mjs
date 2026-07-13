import { adjectives, colors, names, uniqueNamesGenerator } from "unique-names-generator";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { addToQueue, runAgentLoop } from "./agents.mjs";
import { getModelList } from "./ollama-api.mjs";
import { dataDir } from "./env.mjs";
import { History } from "./history.mjs";

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

// Reads all files in the workspace and returns them as a JSON object with the entire file tree
// - each entry can be either a file or folder.
// - files do not have content. we have a separate endpoint for reading file content.
// - folders have a list of files and folders inside them. the structure is recursive.
// the structure is as follows:
// file: { name: string, path: string, type: "file" }
// folder: { name: string, path: string, type: "folder", files: [file | folder] }
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
        const filePath = join(folderPath, file.name);
        if (file.isDirectory()) {
          return {
            name: file.name,
            path: filePath,
            type: "folder",
            files: await readFolder(filePath),
          };
        } else {
          return {
            name: file.name,
            path: filePath,
            type: "file",
          };
        }
      }),
    );

    return result;
  }

  const workspaceFiles = await readFolder(workspacePath);

  res.sendJson(workspaceFiles);
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

// Read all the JSON files in the workspace history folder and return them as a JSON array of objects with the following structure:
// [
//   {
//     id: string, // uuid of this session
//     createdAt: string, // the creation date of the file in ISO format
//     title: string, // the creation date of the file in ISO format
//     messages: [ { role: string, content: string } ] // the content of the file parsed as JSON
//   }
// ]
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

// create an empty session file in the workspace history
// the request body may contain:
// {
//   title?: string,
//   model?: string,
// }
//
// returns a session object:
// {
//   id: string, // uuid of this session
//   model?: string, // optional, specified model to use in this session
//   title?: string, // session title
//   createdAt: string, // the creation date of the file
//   messages: []
// }
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

// Handle a message sent to the workspace. The message is expected to be a JSON object with the following structure:
// { message: string }
async function onMessage(req, res, params) {
  const name = sanitize(params.name);
  const sessionId = sanitize(params.id);
  const workspacePath = join(dataDir, name);
  const history = new History(name, sessionId);

  if (!history.exists()) {
    console.error(`Workspace history not found: ${history.file}`);
    res.sendJson({ error: `Session ${sessionId} not found` }, 404);
    return;
  }

  const body = Buffer.concat(await req.toArray()).toString("utf8");
  const loopOptions = { history, name, sessionId, workspacePath, model: "" };

  try {
    const { message, model = "", files } = JSON.parse(body);
    loopOptions.model = model;
    loopOptions.files = files;
    await history.push({ role: "user", content: message, meta: { model, files, uid: randomUUID() } });
  } catch (err) {
    console.error(`Failed to add message in session ${history.file}: ${err}`);
    res.sendJson({ error: "Failed to push message" }, 400);
    return;
  }

  try {
    await runAgentLoop(loopOptions);
    res.sendJson(await history.read());
  } catch (e) {
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
  const { success } = await pullModel(name);
  res.sendJson(success, success ? 200 : 500);
}

export default {
  "GET /models": onModelList,
  "POST /models/:name": onModelPull,

  "GET /workspaces": onReadWorkspaceList,
  "POST /workspaces": onCreateWorkspace,

  "DELETE /workspaces/:name/history/:id/message/:uid": onDeleteMessage,
  "POST /workspaces/:name/history/:id/message": onMessage,

  "GET /workspaces/:name/history/:id": onReadWorkspaceHistory,
  "DELETE /workspaces/:name/history/:id": onDeleteWorkspaceHistory,

  "GET /workspaces/:name/history": onReadWorkspaceHistoryList,
  "POST /workspaces/:name/history": onCreateWorkspaceHistory,

  "GET /workspaces/:name": onReadWorkspace,
  "DELETE /workspaces/:name": onDeleteWorkspace,
};
