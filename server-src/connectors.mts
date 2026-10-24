import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./env.mjs";

const providers = ["gemini", "openai", "ollama"] as const;

function encryptionKey() {
  const secret = process.env.CONNECTOR_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error("Connector settings are unavailable: CONNECTOR_ENCRYPTION_KEY is not configured");
  }
  return createHash("sha256").update(secret).digest();
}

function connectorPath(subject: string) {
  const user = createHash("sha256").update(subject).digest("hex");
  return join(dataDir, "connectors", `${user}.json`);
}

async function readConnectors(subject: string) {
  try {
    const record = JSON.parse(await readFile(connectorPath(subject), "utf8"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.iv, "base64"));
    decipher.setAuthTag(Buffer.from(record.tag, "base64"));
    return JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(record.data, "base64")), decipher.final()]).toString(),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw new Error("Could not read connector settings", { cause: error });
  }
}

export async function listConnectors(subject: string) {
  const stored = await readConnectors(subject);
  return providers.map((provider) => ({
    provider,
    configured: Boolean(stored[provider]?.credential || stored[provider]?.url),
    model: stored[provider]?.model || "",
    url: provider === "ollama" ? stored[provider]?.url || "" : undefined,
  }));
}

export async function saveConnector(subject: string, input: any) {
  const { provider, credential, model, url } = input || {};
  if (!providers.includes(provider)) {
    throw new Error("Unsupported connector");
  }
  if (typeof model !== "string" || model.length > 200) {
    throw new Error("Invalid model name");
  }
  if (provider === "ollama") {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error("Enter a valid Ollama server URL");
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Ollama URL must use HTTP or HTTPS");
    }
  } else if (typeof credential !== "string" || !credential.trim() || credential.length > 4096) {
    throw new Error("Enter a valid API key");
  }

  const stored = await readConnectors(subject);
  const previous = stored[provider] || {};
  stored[provider] = {
    ...(provider === "ollama" ? { url: new URL(url).origin } : { credential: credential.trim() }),
    model: model.trim() || previous.model || "",
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(stored)), cipher.final()]);
  const path = connectorPath(subject);
  await mkdir(join(dataDir, "connectors"), { recursive: true, mode: 0o700 });
  await writeFile(
    path,
    JSON.stringify({
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      data: encrypted.toString("base64"),
    }),
    { mode: 0o600 },
  );
  return (await listConnectors(subject)).find((connector) => connector.provider === provider);
}
