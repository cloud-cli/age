import { randomUUID } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";

const mutations = new Map<string, Promise<unknown>>();

export function mutateTaskFile<T>(file: string, mutate: Function): Promise<T> {
  const previous = mutations.get(file) || Promise.resolve();
  const current = previous
    .catch(() => {})
    .then(async () => {
      const task = JSON.parse(await readFile(file, "utf8"));
      const result = await mutate(task);
      task.updatedAt = new Date().toISOString();
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(task, null, 2), { flag: "wx" });
      await rename(temporary, file);
      return result;
    });
  mutations.set(file, current);
  return current.finally(() => {
    if (mutations.get(file) === current) {
      mutations.delete(file);
    }
  });
}
