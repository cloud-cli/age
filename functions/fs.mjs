// functions used by the workspace API via AI function calls to interact with the file system

export function ReadFile(/*string*/ path) {
  "## Reads the content of a file at the given path and returns it as a string. ##";
  const fs = require("fs");
  return fs.readFileSync(path, "utf8");
}

export function WriteFile(/*string*/ path, /*string*/ content) {
  const fs = require("fs");
  fs.writeFileSync(path, content, "utf8");
  return true;
}

export function ListFiles(/*string*/ path) {
  const fs = require("fs");
  const files = fs.readdirSync(path);
  return files;
}

export function DeleteFile(/*string*/ path) {
  const fs = require("fs");
  fs.unlinkSync(path);
  return true;
}

export function CreateFolder(/*string*/ path) {
  const fs = require("fs");
  fs.mkdirSync(path, { recursive: true });
  return true;
}

export function DeleteFolder(/*string*/ path) {
  const fs = require("fs");
  fs.rmdirSync(path, { recursive: true });
  return true;
}

export function RenameFile(/*string*/ oldPath, /*string*/ newPath) {
  const fs = require("fs");
  fs.renameSync(oldPath, newPath);
  return true;
}

export function RenameFolder(/*string*/ oldPath, /*string*/ newPath) {
  const fs = require("fs");
  fs.renameSync(oldPath, newPath);
  return true;
}

export function GetFileStats(/*string*/ path) {
  const fs = require("fs");
  const stats = fs.statSync(path);
  return {
    size: stats.size,
    isFile: stats.isFile(),
    isDirectory: stats.isDirectory(),
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
  };
}

export const functions = {
  ReadFile,
  WriteFile,
  ListFiles,
  DeleteFile,
  CreateFolder,
  DeleteFolder,
  RenameFile,
  RenameFolder,
  GetFileStats,
};

