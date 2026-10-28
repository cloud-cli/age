import { DatabaseQuery, DatabaseSearch } from "./tools/db.mjs";
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./env.mjs";

const enabled = () => Boolean(process.env.DATABASE_URL);
let initialized: Promise<void> | undefined;
const ensure = () => {
  if (!enabled()) {
    return Promise.resolve();
  }
  return (initialized ||= DatabaseQuery(
    `CREATE TABLE IF NOT EXISTS workspaces (name TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)), createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL)`,
    {},
  )
    .then(() => undefined)
    .catch((error) => {
      initialized = undefined;
      throw error;
    }));
};

async function metadataInWorkspace(dir: string) {
  for (const file of [join(dir, "config", "workspace.json"), join(dir, "config", "project.json")]) {
    try {
      const content = await readFile(file, "utf8");
      try {
        return JSON.parse(content);
      } catch {
        return {};
      }
    } catch {
      continue;
    }
  }
  return null;
}

export async function backfillWorkspaces(dataDir: string) {
  if (!enabled()) {
    return;
  }
  await ensure();
  const entries = await readdir(dataDir, { withFileTypes: true });
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const dir = join(dataDir, entry.name);
    const metadata = await metadataInWorkspace(dir);
    if (metadata === null) {
      continue;
    }
    const createdAt = (await stat(dir)).birthtimeMs;
    await DatabaseQuery(
      `INSERT OR IGNORE INTO workspaces (name,description,archived,createdAt,updatedAt) VALUES (:name,:description,0,:createdAt,:updatedAt)`,
      {
        name: entry.name,
        description: typeof metadata.description === "string" ? metadata.description : metadata.summary || "",
        createdAt,
        updatedAt: createdAt,
      },
    );
  }
}

export async function listWorkspaces(dataDir: string, includeArchived = false) {
  await backfillWorkspaces(dataDir);
  if (!enabled()) {
    const entries = await readdir(dataDir, { withFileTypes: true });
    const workspaces: Array<{
      name: string;
      description: string;
      createdAt: number;
      updatedAt: number;
      archived: number;
    }> = [];
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const dir = join(dataDir, entry.name);
      if ((await metadataInWorkspace(dir)) === null) {
        continue;
      }
      const stats = await stat(dir);
      workspaces.push({
        name: entry.name,
        description: "",
        createdAt: stats.birthtimeMs,
        updatedAt: stats.mtimeMs,
        archived: 0,
      });
    }
    return workspaces;
  }
  return (await DatabaseSearch(
    `SELECT name,description,createdAt,updatedAt,archived FROM workspaces ${includeArchived ? "" : "WHERE archived = 0"} ORDER BY name`,
    {},
  )) as any[];
}

export async function setArchived(name: string, archived: boolean) {
  if (!enabled()) {
    throw new Error("DATABASE_URL is required for workspace archiving");
  }
  await backfillWorkspaces(dataDir);
  await DatabaseQuery("UPDATE workspaces SET archived=:archived, updatedAt=:updatedAt WHERE name=:name", {
    name,
    archived: archived ? 1 : 0,
    updatedAt: Date.now(),
  });
}
export async function removeWorkspace(name: string) {
  await ensure();
  if (enabled()) {
    await DatabaseQuery("DELETE FROM workspaces WHERE name=:name", { name });
  }
}
export async function saveDescription(name: string, description: string) {
  await backfillWorkspaces(dataDir);
  if (enabled()) {
    await DatabaseQuery("UPDATE workspaces SET description=:description, updatedAt=:updatedAt WHERE name=:name", {
      name,
      description,
      updatedAt: Date.now(),
    });
  }
}
export async function workspaceDescription(name: string) {
  await backfillWorkspaces(dataDir);
  if (!enabled()) {
    return undefined;
  }
  const rows = (await DatabaseSearch("SELECT description FROM workspaces WHERE name=:name", { name })) as any[];
  return rows?.[0]?.description;
}
