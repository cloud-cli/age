import { existsSync, mkdirSync } from 'node:fs';

export const dataDir = process.env.DATA_PATH || '/data';

existsSync(dataDir) || mkdirSync(dataDir, { recursive: true });
