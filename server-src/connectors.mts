import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./env.mjs";

const providers = ["gemini", "openai", "ollama"] as const;

function ollamaConnections(stored: any) {
  if (Array.isArray(stored.ollama)) {
    return stored.ollama;
  }
  if (stored.ollama?.url) {
    const id = `ollama-${createHash("sha256").update(stored.ollama.url).digest("hex").slice(0, 12)}`;
    return [{ ...stored.ollama, id, name: "Ollama" }];
  }
  return [];
}

function validateOllamaUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Ollama URL must use HTTP or HTTPS");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const ipv4 = hostname.split(".").map(Number);
  const blockedIPv4 =
    isIP(hostname) === 4 &&
    (ipv4[0] === 0 ||
      ipv4[0] === 127 ||
      (ipv4[0] === 169 && ipv4[1] === 254) ||
      (ipv4[0] === 100 && ipv4[1] === 100) ||
      ipv4[0] >= 224);
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "metadata.google.internal" ||
    hostname === "::1" ||
    blockedIPv4
  ) {
    throw new Error("Ollama server URL cannot point to a local or link-local address");
  }
  return url;
}

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
  return [
    ...providers
      .filter((provider) => provider !== "ollama")
      .map((provider) => ({
        provider,
        configured: Boolean(stored[provider]?.credential),
        model: stored[provider]?.model || "",
      })),
    ...ollamaConnections(stored).map(({ id, name, model, url }) => ({
      provider: "ollama",
      id,
      name,
      model: model || "",
      url,
      configured: true,
    })),
  ];
}

export async function deleteConnector(subject: string, provider: string, id?: string) {
  if (!providers.includes(provider as (typeof providers)[number])) {
    throw new Error("Unsupported connector");
  }
  const stored = await readConnectors(subject);
  if (provider === "ollama") {
    const connections = ollamaConnections(stored);
    if (id) {
      stored.ollama = connections.filter((connection) => connection.id !== id);
    } else {
      stored.ollama = [];
    }
  } else {
    delete stored[provider];
  }
  await writeConnectors(subject, stored);
}

export async function getConfiguredModels(subject: string, onlyProvider?: string, onlyConnectionId?: string) {
  const stored = await readConnectors(subject);
  const results = await Promise.all(
    providers
      .filter((provider) => !onlyProvider || onlyProvider === provider)
      .flatMap((provider) => {
        const connectors =
          provider === "ollama"
            ? ollamaConnections(stored).filter((connector) => !onlyConnectionId || connector.id === onlyConnectionId)
            : stored[provider]
              ? [{ ...stored[provider], id: undefined, name: undefined }]
              : [];
        return connectors.map(async (connector) => {
          try {
            const ollamaURL = provider === "ollama" ? validateOllamaUrl(connector.url) : undefined;
            const url =
              provider === "gemini"
                ? "https://generativelanguage.googleapis.com/v1beta/openai/models"
                : provider === "openai"
                  ? "https://api.openai.com/v1/models"
                  : `${ollamaURL!.origin}/v1/models`;
            const response = await fetch(url, {
              headers:
                provider === "gemini"
                  ? { "x-goog-api-key": connector.credential }
                  : connector.credential
                    ? { Authorization: `Bearer ${connector.credential}` }
                    : {},
              signal: AbortSignal.timeout(15_000),
              redirect: "error",
            });
            if (!response.ok) {
              throw new Error(`${provider} model lookup failed (${response.status})`);
            }
            const body: any = await response.json();
            return (body.data || []).map((model, index) => {
              const name = provider === "gemini" ? model.id.replace(/^models\//, "") : model.id;
              return {
                id: provider === "ollama" ? `ollama:${connector.id}/${name}` : `${provider}/${name}`,
                name,
                provider,
                ...(provider === "ollama" ? { serverName: connector.name } : {}),
                default: connector.model ? connector.model === name : index === 0,
              };
            });
          } catch (error) {
            if (onlyProvider) {
              throw error;
            }
            return [];
          }
        });
      }),
  );
  return results.flat();
}

export async function callConfiguredModel(subject: string, requestBody: any) {
  const requested = String(requestBody.model || "");
  const separator = requested.indexOf("/");
  if (separator < 1) {
    return undefined;
  }
  const providerKey = requested.slice(0, separator);
  const [provider, connectionId] = providerKey.split(":", 2);
  if (!providers.includes(provider as (typeof providers)[number])) {
    return undefined;
  }
  const model = requested.slice(separator + 1);
  if (!model) {
    throw new Error("Select a model in AI settings before sending a message");
  }
  const stored = await readConnectors(subject);
  const connector =
    provider === "ollama"
      ? ollamaConnections(stored).find((item) => item.id === connectionId) ||
        (!connectionId ? ollamaConnections(stored)[0] : undefined)
      : stored[provider];
  if (!connector) {
    throw new Error(`${provider} is not configured. Open AI settings to connect it.`);
  }
  const ollamaURL = provider === "ollama" ? validateOllamaUrl(connector.url) : undefined;
  const url =
    provider === "gemini"
      ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
      : provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : `${ollamaURL!.origin}/v1/chat/completions`;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (provider === "gemini") {
    headers["x-goog-api-key"] = connector.credential;
  } else if (connector.credential) {
    headers.Authorization = `Bearer ${connector.credential}`;
  }
  const body: any = { ...requestBody };
  delete body.think;
  const messages: any[] = Array.from(body.messages || []);
  const pendingCalls = new Map<string, string[]>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const call of message.tool_calls || []) {
        const functionName = call.function?.name;
        if (!functionName) {
          continue;
        }
        pendingCalls.set(functionName, [...(pendingCalls.get(functionName) || []), call.id]);
      }
    } else if (message.role === "tool" && !message.tool_call_id) {
      const ids = pendingCalls.get(message.tool_name);
      if (ids?.length) {
        message.tool_call_id = ids.shift();
      }
      delete message.tool_name;
    }
  }
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...body, messages, model }),
    signal: AbortSignal.timeout(180_000),
    redirect: "error",
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`${provider} request failed (${response.status}): ${message.slice(0, 500)}`);
  }
  const result: any = await response.json();
  const message = result.choices?.[0]?.message;
  if (!message) {
    throw new Error(`${provider} returned an unexpected chat response`);
  }
  return { message };
}

export async function saveConnector(subject: string, input: any) {
  const { provider, credential, model, url, id, name } = input || {};
  if (!providers.includes(provider)) {
    throw new Error("Unsupported connector");
  }
  if (typeof model !== "string" || model.length > 200) {
    throw new Error("Invalid model name");
  }
  if (provider === "ollama") {
    try {
      validateOllamaUrl(url);
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error("Enter a valid Ollama server URL", { cause: error });
      }
      throw error;
    }
    if (typeof name !== "string" || !name.trim() || name.length > 100) {
      throw new Error("Enter an Ollama server name");
    }
  } else if (credential !== undefined && (typeof credential !== "string" || credential.length > 4096)) {
    throw new Error("Invalid API key");
  }

  const stored = await readConnectors(subject);
  if (provider === "ollama") {
    const connections = ollamaConnections(stored);
    const previous = id ? connections.find((connection) => connection.id === id) : undefined;
    if (id && !previous) {
      throw new Error("Ollama server not found");
    }
    const connection = {
      id: previous?.id || randomUUID(),
      name: name.trim(),
      url: validateOllamaUrl(url).origin,
      model: model.trim() || previous?.model || "",
    };
    stored.ollama = previous
      ? connections.map((item) => (item.id === previous.id ? connection : item))
      : [...connections, connection];
    await writeConnectors(subject, stored);
    return (await listConnectors(subject)).find(
      (connector) => connector.provider === provider && connector.id === connection.id,
    );
  }

  const previous = stored[provider] || {};
  stored[provider] = {
    credential: credential?.trim() || previous.credential,
    model: model.trim() || previous.model || "",
  };
  if (!stored[provider].credential) {
    throw new Error("Enter an API key");
  }
  await writeConnectors(subject, stored);
  return (await listConnectors(subject)).find((connector) => connector.provider === provider);
}

async function writeConnectors(subject: string, stored: any) {
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
}
