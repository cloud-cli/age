import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { after, test } from "node:test";

const dataPath = await mkdtemp(join(tmpdir(), "age-connectors-"));
process.env.DATA_PATH = dataPath;
process.env.CONNECTOR_ENCRYPTION_KEY = "connector-test-key";
delete process.env.API_URL;
const { getConfiguredModels, saveGitMiniConnector, listConnectors, createGitMiniRepository } = await import(
  pathToFileURL(join(process.cwd(), "server/connectors.mjs"))
);
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

test("GitMini connector validates exact PAT/org formats, verifies accessible org, and redacts encrypted token", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = originalFetch));
  const gitminiSubject = "team:gitmini-test";
  const token = `gmpat_${"a".repeat(43)}`;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), options };
    return globalThis.Response.json({ orgs: [{ slug: "org.example" }] });
  };
  await assert.rejects(saveGitMiniConnector(gitminiSubject, { org: "org", token: "gmpat_short" }), /valid GitMini/);
  await assert.rejects(saveGitMiniConnector(gitminiSubject, { org: "-bad", token }), /valid GitMini/);
  assert.deepEqual(await saveGitMiniConnector(gitminiSubject, { org: "org.example", token }), {
    configured: true,
    org: "org.example",
  });
  assert.equal(request.url, "https://git.api.apphor.de/api/v1/orgs");
  assert.equal(request.options.redirect, "error");
  assert.equal(request.options.headers.authorization, `Bearer ${token}`);
  const listed = await listConnectors(gitminiSubject);
  const summary = listed.find((item) => item.provider === "gitmini");
  assert.deepEqual(summary, { provider: "gitmini", configured: true, org: "org.example" });
  assert.equal(JSON.stringify(listed).includes(token), false);
  const encryptedFile = await readFile(
    join(dataPath, "connectors", `${createHash("sha256").update(gitminiSubject).digest("hex")}.json`),
    "utf8",
  );
  assert.equal(encryptedFile.includes(token), false);
});

test("GitMini repo create reports repo:write denial without exposing response text", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => (globalThis.fetch = originalFetch));
  globalThis.fetch = async () => new globalThis.Response("private upstream details", { status: 403 });
  await assert.rejects(
    createGitMiniRepository({ baseUrl: "https://git.example", org: "org", token: `gmpat_${"x".repeat(43)}` }, "repo"),
    (error) => error.message.includes("repo:write") && !error.message.includes("private upstream"),
  );
});

test("GitMini base URL is process-configured and must be a credential-free HTTPS origin", async (t) => {
  const oldFetch = globalThis.fetch;
  const oldUrl = process.env.GITMINI_URL;
  t.after(() => {
    globalThis.fetch = oldFetch;
    if (oldUrl === undefined) {
      delete process.env.GITMINI_URL;
    } else {
      process.env.GITMINI_URL = oldUrl;
    }
  });
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return globalThis.Response.json({ orgs: [{ slug: "org" }] });
  };
  for (const url of [
    "http://git.example",
    "https://user:pass@git.example",
    "https://git.example/path",
    "https://git.example:70000",
  ]) {
    process.env.GITMINI_URL = url;
    await assert.rejects(
      saveGitMiniConnector("team:gitmini-url-test", { org: "org", token: `gmpat_${"a".repeat(43)}` }),
    );
  }
  assert.equal(called, false);
});
