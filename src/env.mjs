import { existsSync, mkdirSync } from "node:fs";

export const dataDir = process.env.DATA_PATH;

existsSync(dataDir) || mkdirSync(dataDir, { recursive: true });