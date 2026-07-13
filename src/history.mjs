import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "./env.mjs";
import { readFile, writeFile } from "node:fs/promises";

export class History {
  #cache;

  constructor(workspaceName, sessionId) {
    Object.assign(this, { workspaceName, sessionId });
    this.#cache = null;
  }

  get file() {
    return join(dataDir, this.workspaceName, "history", `${sessionId}.json`);
  }

  async getModel() {
    if (!this.#cache) {
      await this.read();
    }

    return this.#cache.model;
  }

  async setModel(model) {
    const history = await this.read();
    history.model = model;
    return await this.write(history);
  }

  async getMessagesForModel() {
    const history = await this.read();
    return history.messages.map((x) => {
      const { meta = null, ...rest } = x;
      return rest;
    });
  }

  exists() {
    return existsSync(this.file);
  }

  async read() {
    const f = await readFile(this.file, "utf8");
    const json = JSON.parse(f);
    this.#cache = json;
    return json;
  }

  async write(content) {
    await writeFile(this.file, JSON.stringify(content));
    this.#cache = null;
  }

  async push(message) {
    const history = await this.read();
    history.messages.push(message);
    return await this.write(history);
  }
}
