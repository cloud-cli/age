import * as fs from "node:fs";
import { opendir } from "node:fs/promises";
import { resolve } from "node:path";
import type { Context } from "../agents.mjs";

type WorkspaceContext = Pick<Context, "getPath">;

// functions used by the workspace API via AI function calls to interact with the file system

export function WriteFile(this: WorkspaceContext, /*string*/ path: string, /*string*/ content: string) {
  "## Writes the given content to a file at the specified path. If the file does not exist, it will be created. ##";
  fs.writeFileSync(this.getPath(path), content, "utf8");
  return true;
}

export async function ListFiles(
  this: WorkspaceContext,
  /*string*/ path: string,
  /*number*/ offset = 0,
  /*number*/ limit = 500,
) {
  "## Lists a bounded page of file and directory names at the given path.##";
  if (!Number.isInteger(offset) || offset < 0 || offset > 10_000) {
    throw new Error("offset must be an integer between 0 and 10000");
  }
  const boundedLimit = Math.max(1, Math.min(1000, Number.isInteger(limit) ? limit : 500));
  const directory = await opendir(this.getPath(path));
  const files: string[] = [];
  let index = 0;
  try {
    for await (const entry of directory) {
      if (index >= offset) {
        files.push(entry.name);
        if (files.length >= boundedLimit) {
          break;
        }
      }
      index += 1;
    }
  } finally {
    await directory.close().catch(() => {});
  }
  return files;
}

export function DeleteFile(this: WorkspaceContext, /*string*/ path: string) {
  "## Deletes the file at the specified path. ##";
  fs.unlinkSync(this.getPath(path));
  return true;
}

export function CreateFolder(this: WorkspaceContext, /*string*/ path: string) {
  "## Creates a new folder at the specified path. If the folder already exists, no action is taken. ##";
  fs.mkdirSync(this.getPath(path), { recursive: true });
  return true;
}

export function DeleteFolder(this: WorkspaceContext, /*string*/ path: string) {
  "## Deletes the folder at the specified path and all its contents. ##";
  const target = this.getPath(path);
  if (resolve(target) === resolve(this.getPath("."))) {
    throw new Error("Cannot delete the workspace files root");
  }
  fs.rmSync(target, { recursive: true });
  return true;
}

export function RenameFile(this: WorkspaceContext, /*string*/ oldPath: string, /*string*/ newPath: string) {
  "## Renames a file from oldPath to newPath. ##";
  fs.renameSync(this.getPath(oldPath), this.getPath(newPath));
  return true;
}

export function RenameFolder(this: WorkspaceContext, /*string*/ oldPath: string, /*string*/ newPath: string) {
  "## Renames a folder from oldPath to newPath. ##";
  fs.renameSync(this.getPath(oldPath), this.getPath(newPath));
  return true;
}

export function GetFileStats(this: WorkspaceContext, /*string*/ path: string) {
  "## Returns statistics about the file or folder at the specified path, including size, creation date, and modification date. ##";
  const stats = fs.statSync(this.getPath(path));
  return {
    size: stats.size,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
  };
}
