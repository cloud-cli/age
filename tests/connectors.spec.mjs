import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

const dataPath = await mkdtemp(join(tmpdir(), "age-connectors-"));
process.env.DATA_PATH = dataPath;
process.env.CONNECTOR_ENCRYPTION_KEY = "connector-test-key";
delete process.env.API_URL;
const { getConfiguredModels } = await import(pathToFileURL(join(process.cwd(), "server/connectors.mjs")));
const { getModelList } = await import(pathToFileURL(join(process.cwd(), "server/backend/ollama.mjs")));
const subject = "team:connector-test";
const key = createHash("sha256").update(process.env.CONNECTOR_ENCRYPTION_KEY).digest();
const iv = randomBytes(12);
const cipher = createCipheriv("aes-256-gcm", key, iv);
const encrypted = Buffer.concat([
  cipher.update(
    JSON.stringify({
      chatgpt: { refresh: "refresh-secret", access: "expired-access", expires: 0 },
      ollama: [{ id: "local-models", name: "Test Ollama", url: "https://ollama.example.org", model: "llama3" }],
    }),
  ),
  cipher.final(),
]);
const subjectHash = createHash("sha256").update(subject).digest("hex");
await mkdir(join(dataPath, "connectors"), { recursive: true });
await writeFile(
  join(dataPath, "connectors", `${subjectHash}.json`),
  JSON.stringify({
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  }),
);
after(() => rm(dataPath, { recursive: true, force: true }));

test("aggregate model lookup retains Ollama models when ChatGPT refresh fails", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (url) => {
    if (String(url).includes("/oauth/token")) {
      return new globalThis.Response("unavailable", { status: 401 });
    }
    if (String(url) === "https://ollama.example.org/v1/models") {
      return globalThis.Response.json({ data: [{ id: "llama3" }] });
    }
    throw new Error("Unexpected model lookup");
  };

  const models = await getModelList(subject);
  assert.deepEqual(
    models.map(({ id }) => id),
    ["ollama:local-models/llama3"],
  );
});

test("explicit ChatGPT model lookup still rejects refresh errors", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new globalThis.Response("unavailable", { status: 401 });
  await assert.rejects(getConfiguredModels(subject, "chatgpt"), /ChatGPT token refresh failed \(401\)/);
});
