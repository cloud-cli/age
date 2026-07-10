import {
  adjectives,
  colors,
  names,
  uniqueNamesGenerator,
} from "unique-names-generator";

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";

import { executeFunction, getModelResponse } from "./agents.mjs";

const dataDir = process.env.DATA_PATH;

const randomName = () =>
  uniqueNamesGenerator({
    dictionaries: [adjectives, colors, names],
  }).toLowerCase();

const sanitize = (str) => str.replace(/[^a-zA-Z0-9-_]/g, "");

existsSync(dataDir) || mkdirSync(dataDir, { recursive: true });

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
        id: file.name,
        name: await stat(join(dataDir, file.name)).then((stats) =>
          stats.birthtime.toISOString(),
        ),
      })),
    );

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(json));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

const workspaceFolders = ["files", "history", "config"];

async function onCreateWorkspace(_req, res) {
  const name = sanitize(randomName());
  const workspacePath = join(dataDir, name);

  try {
    await mkdir(workspacePath, { recursive: true });

    for (const folder of workspaceFolders) {
      await mkdir(join(workspacePath, folder), { recursive: true });
    }

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ name }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
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
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Workspace not found" }));
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

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(workspaceFiles));
}

async function onDeleteWorkspace(req, res, params) {
  const name = sanitize(params.name);
  const workspacePath = join(dataDir, name);

  if (!existsSync(workspacePath)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Workspace not found" }));
    return;
  }

  try {
    await rm(workspacePath, { recursive: true, force: true });
    res.writeHead(204);
    res.end();
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
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
async function onReadWorkspaceHistoryList(req, res, params) {
  const name = sanitize(params.name);
  const workspacePath = join(dataDir, name, "history");

  if (!existsSync(workspacePath)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Workspace history not found" }));
    return;
  }

  // Implementation for reading workspace history
  const files = await readdir(workspacePath, {
    withFileTypes: true,
    encoding: "utf8",
  });

  const sessions = files.filter(
    (file) => file.isFile() && file.name.endsWith(".json"),
  );
  const json = await Promise.all(
    sessions.map(async (file) => {
      const content = await readFile(join(workspacePath, file.name), "utf8");
      return JSON.parse(content);
    }),
  );

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify(json));
}

// create an empty session file in the workspace history folder with a random uuid as the filename and the following structure:
// {
//   id: string, // uuid of this session
//   createdAt: string, // the creation date of the file in ISO format
//   title: string, // the creation date of the file in ISO format
//   messages: [ { role: string, content: string } ] // the content of the file parsed as JSON
// }
async function onCreateWorkspaceHistory(req, res, params) {
  const name = sanitize(params.name);
  const uid = randomUUID();
  const workspacePath = join(dataDir, name, "history");

  if (!existsSync(workspacePath)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Workspace history not found" }));
    return;
  }

  try {
    const json = {
      id: uid,
      title: "",
      createdAt: new Date().getTime(),
      messages: [],
    };
    await writeFile(join(workspacePath, `${uid}.json`), JSON.stringify(json), {
      encoding: "utf8",
    });

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: uid }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function onReadWorkspaceHistory(req, res, params) {
  const name = sanitize(params.name);
  const id = sanitize(params.id);
  const workspacePath = join(dataDir, name, "history", `${id}.json`);

  if (!existsSync(workspacePath)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Workspace history not found" }));
    return;
  }

  try {
    const content = await readFile(workspacePath, "utf8");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(content);
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

async function onDeleteWorkspaceHistory(req, res, params) {
  const name = sanitize(params.name);
  const id = sanitize(params.id);
  const workspacePath = join(dataDir, name, "history", `${id}.json`);

  if (!existsSync(workspacePath)) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Workspace history not found" }));
    return;
  }

  try {
    await rm(workspacePath, { force: true });
    res.writeHead(204);
    res.end();
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

// Handle a message sent to the workspace. The message is expected to be a JSON object with the following structure:
// { message: string }
async function onMessage(req, res, params) {
  const name = sanitize(params.name);
  const id = sanitize(params.id);
  const workspacePath = join(dataDir, name);
  const historyFile = join(workspacePath, "history", `${id}.json`);

  if (!existsSync(historyFile)) {
    console.error(`Workspace history not found: ${historyFile}`);
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Workspace history not found" }));
    return;
  }

  // read session, append message and run an AI model to generate a response.
  const history = JSON.parse(await readFile(historyFile, "utf8"));
  const body = Buffer.concat(await req.toArray()).toString("utf8");

  try {
    const { message } = JSON.parse(body);
    history.messages.push({ role: "user", content: message });
  } catch (err) {
    console.error(
      `Invalid JSON body for workspace history ${historyFile}: ${err.message}`,
    );
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid JSON body" }));
    return;
  }

  let aiResponse;

  try {
    aiResponse = await getModelResponse(history.messages);
    console.log("AI Responses:", aiResponse);
  } catch (err) {
    console.error(
      `Error getting model response at ${historyFile}: ${err.message}`,
    );
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
    return;
  }

  if (aiResponse.tool_calls) {
    history.messages.push({
      role: aiResponse.role,
      content: aiResponse.content,
      thinking: aiResponse.thinking,
    });

    for (const call of aiResponse.tool_calls) {
      const functionName = call.function.name;
      const functionArgs = call.function.arguments;

      try {
        const functionResponse = await executeFunction(
          functionName,
          functionArgs,
          workspacePath,
        );

        history.messages.push({
          role: "function",
          name: functionName,
          content: functionResponse,
        });
      } catch (error) {
        console.error(
          `Error executing function: ${functionName} with args: ${JSON.stringify(functionArgs)}:\n ${error}`,
        );
        history.messages.push({
          role: "system",
          content: `Error executing function: ${functionName} with args: ${JSON.stringify(functionArgs)}:\n ${error}`,
        });
      }
    }
  } else {
    history.messages.push(aiResponse);
  }

  await writeFile(historyFile, JSON.stringify(history));
}

export default {
  "GET /workspaces": onReadWorkspaceList,
  "POST /workspaces": onCreateWorkspace,
  "GET /workspaces/:name": onReadWorkspace,
  "DELETE /workspaces/:name": onDeleteWorkspace,

  "GET /workspaces/:name/history": onReadWorkspaceHistoryList,
  "POST /workspaces/:name/history": onCreateWorkspaceHistory,

  "GET /workspaces/:name/history/:id": onReadWorkspaceHistory,
  "DELETE /workspaces/:name/history/:id": onDeleteWorkspaceHistory,

  "POST /workspaces/:name/history/:id/message": onMessage,
};
