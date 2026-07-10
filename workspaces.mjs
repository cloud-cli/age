import {
  uniqueNamesGenerator,
  adjectives,
  colors,
  names,
} from "unique-names-generator";

import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readdir, stat, mkdir, rm, readFile } from "node:fs/promises";

const randomName = uniqueNamesGenerator({
  dictionaries: [adjectives, colors, names],
});
const dataDir = process.env.DATA_PATH;

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

async function onCreateWorkspace(req, res, args) {
  const name = randomName();
  const workspacePath = join(dataDir, name);

  try {
    await mkdir(workspacePath, { recursive: true });

    for (const folder of workspaceFolders) {
      await mkdir(join(workspacePath, folder), { recursive: true });
    }

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: name }));
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
  const { name } = params;
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
  const { name } = params;

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
async function onReadWorkspaceHistory(req, res, params) {
  const { name } = params;
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
  const { name } = params;
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
    writeFile(join(workspacePath, `${uid}.json`), JSON.stringify(json), {
      encoding: "utf8",
    });

    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ id: uid }));
  } catch (err) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  }
}

export default {
  "GET /workspaces": onReadWorkspaceList,
  "POST /workspaces": onCreateWorkspace,
  "GET /workspaces/:name": onReadWorkspace,
  "DELETE /workspaces/:name": onDeleteWorkspace,
  "GET /workspaces/:name/history": onReadWorkspaceHistory,
  "POST /workspaces/:name/history": onCreateWorkspaceHistory,
};
