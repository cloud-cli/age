import * as fs from 'node:fs';

// functions used by the workspace API via AI function calls to interact with the file system

export function ReadFile(/*string*/ path) {
  "## Reads the content of a file at the given path and returns it as a string. ##";
  return fs.readFileSync(this.getPath(path), "utf8");
}

export function WriteFile(/*string*/ path, /*string*/ content) {
  "## Writes the given content to a file at the specified path. If the file does not exist, it will be created. ##";
  fs.writeFileSync(this.getPath(path), content, "utf8");
  return true;
}

export function ListFiles(/*string*/ path) {
  "## Lists all files and directories at the given path and returns an array of their names. ##";
  const files = fs.readdirSync(this.getPath(path));
  return files;
}

export function DeleteFile(/*string*/ path) {
  "## Deletes the file at the specified path. ##";
  fs.unlinkSync(this.getPath(path));
  return true;
}

export function CreateFolder(/*string*/ path) {
  "## Creates a new folder at the specified path. If the folder already exists, no action is taken. ##";
  fs.mkdirSync(this.getPath(path), { recursive: true });
  return true;
}

export function DeleteFolder(/*string*/ path) {
  "## Deletes the folder at the specified path and all its contents. ##";
  fs.rmdirSync(this.getPath(path), { recursive: true });
  return true;
}

export function RenameFile(/*string*/ oldPath, /*string*/ newPath) {
  "## Renames a file from oldPath to newPath. ##";
  fs.renameSync(this.getPath(oldPath), this.getPath(newPath));
  return true;
}

export function RenameFolder(/*string*/ oldPath, /*string*/ newPath) {
  "## Renames a folder from oldPath to newPath. ##";
  fs.renameSync(this.getPath(oldPath), this.getPath(newPath));
  return true;
}

export function GetFileStats(/*string*/ path) {
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

