import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "./env.mjs";

const providers = ["gemini", "openai", "ollama", "chatgpt"] as const;
const CHATGPT_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CHATGPT_ISSUER = "https://auth.openai.com";
const chatgptModels = ["gpt-5.3-codex", "gpt-5.2-codex", "gpt-5.1-codex", "gpt-5.1-codex-mini"];
const pendingChatgptLogins = new Map<
  string,
  { subject: string; deviceAuthId: string; userCode: string; expires: number }
>();

function parseJwtClaims(token: string) {
  try {
    return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
  } catch {
    return {};
  }
}

function accountIdFromTokens(tokens: any) {
  const claims = parseJwtClaims(tokens.id_token || tokens.access_token);
  return (
    claims.chatgpt_account_id ||
    claims["https://api.openai.com/auth"]?.chatgpt_account_id ||
    claims.organizations?.[0]?.id
  );
}

export async function startChatgptLogin(subject: string) {
  for (const [id, pending] of pendingChatgptLogins) {
    if (pending.expires <= Date.now()) {
      pendingChatgptLogins.delete(id);
    }
  }
  const response = await fetch(`${CHATGPT_ISSUER}/api/accounts/deviceauth/usercode`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "age/1.0" },
    body: JSON.stringify({ client_id: CHATGPT_CLIENT_ID }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`Could not start ChatGPT sign-in (${response.status})`);
  }
  const data: any = await response.json();
  const loginId = randomUUID();
  const interval = Math.max(Number(data.interval) || 5, 1);
  pendingChatgptLogins.set(loginId, {
    subject: createHash("sha256").update(subject).digest("hex"),
    deviceAuthId: data.device_auth_id,
    userCode: data.user_code,
    expires: Date.now() + Math.min(Number(data.expires_in) || 600, 900) * 1000,
  });
  return { loginId, verificationUrl: `${CHATGPT_ISSUER}/codex/device`, userCode: data.user_code, interval };
}

export async function pollChatgptLogin(subject: string, loginId: string) {
  const pending = pendingChatgptLogins.get(loginId);
  if (!pending) {
    throw new Error("ChatGPT sign-in expired. Start again.");
  }
  if (pending.subject !== createHash("sha256").update(subject).digest("hex")) {
    throw new Error("ChatGPT sign-in does not belong to this user");
  }
  if (pending.expires <= Date.now()) {
    pendingChatgptLogins.delete(loginId);
    throw new Error("ChatGPT sign-in expired. Start again.");
  }
  const response = await fetch(`${CHATGPT_ISSUER}/api/accounts/deviceauth/token`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "age/1.0" },
    body: JSON.stringify({ device_auth_id: pending.deviceAuthId, user_code: pending.userCode }),
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 403 || response.status === 404) {
    return { pending: true };
  }
  if (!response.ok) {
    pendingChatgptLogins.delete(loginId);
    throw new Error(`ChatGPT authorization check failed (${response.status})`);
  }
  pendingChatgptLogins.delete(loginId);
  const authorization: any = await response.json();
  const tokenResponse = await fetch(`${CHATGPT_ISSUER}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: authorization.authorization_code,
      redirect_uri: `${CHATGPT_ISSUER}/deviceauth/callback`,
      client_id: CHATGPT_CLIENT_ID,
      code_verifier: authorization.code_verifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!tokenResponse.ok) {
    throw new Error(`ChatGPT token exchange failed (${tokenResponse.status})`);
  }
  const tokens: any = await tokenResponse.json();
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error("ChatGPT returned an incomplete token response");
  }
  const stored = await readConnectors(subject);
  stored.chatgpt = {
    access: tokens.access_token,
    refresh: tokens.refresh_token,
    expires: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
    accountId: accountIdFromTokens(tokens),
    model: stored.chatgpt?.model || chatgptModels[0],
  };
  await writeConnectors(subject, stored);
  return { pending: false, configured: true };
}

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
        configured: provider === "chatgpt" ? Boolean(stored.chatgpt?.refresh) : Boolean(stored[provider]?.credential),
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
  const chatgptResult =
    (!onlyProvider || onlyProvider === "chatgpt") && stored.chatgpt?.refresh
      ? chatgptModels.map((name, index) => ({
          id: `chatgpt/${name}`,
          name,
          provider: "chatgpt",
          default: (stored.chatgpt.model || chatgptModels[0]) === name || (!stored.chatgpt.model && index === 0),
        }))
      : [];
  const results = await Promise.all(
    providers
      .filter((provider) => provider !== "chatgpt" && (!onlyProvider || onlyProvider === provider))
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
  return [...chatgptResult, ...results.flat()];
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
  if (provider === "chatgpt") {
    const credential = stored.chatgpt;
    if (!credential?.refresh) {
      throw new Error("ChatGPT is not connected. Connect it in Integrations.");
    }
    let access = credential.access;
    if (!access || credential.expires <= Date.now()) {
      const response = await fetch(`${CHATGPT_ISSUER}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: credential.refresh,
          client_id: CHATGPT_CLIENT_ID,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`ChatGPT token refresh failed (${response.status}); reconnect in Integrations.`);
      }
      const tokens: any = await response.json();
      access = tokens.access_token;
      stored.chatgpt = {
        ...credential,
        access,
        refresh: tokens.refresh_token || credential.refresh,
        expires: Date.now() + (Number(tokens.expires_in) || 3600) * 1000,
        accountId: accountIdFromTokens(tokens) || credential.accountId,
      };
      await writeConnectors(subject, stored);
    }
    const input = (requestBody.messages || [])
      .filter((message) => message.role !== "system")
      .flatMap((message) => {
        if (message.role === "tool") {
          return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }];
        }
        if (message.role === "assistant" && message.tool_calls?.length) {
          return message.tool_calls.map((call) => ({
            type: "function_call",
            call_id: call.id,
            name: call.function.name,
            arguments: call.function.arguments,
          }));
        }
        return [{ role: message.role, content: message.content }];
      });
    const instructions = (requestBody.messages || [])
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n");
    const tools = (requestBody.tools || []).map((tool) => ({ type: "function", ...tool.function }));
    const headers: Record<string, string> = {
      authorization: `Bearer ${access}`,
      "content-type": "application/json",
      accept: "text/event-stream",
      "openai-beta": "responses=experimental",
      originator: "opencode",
      session_id: randomUUID(),
    };
    if (credential.accountId) {
      headers["chatgpt-account-id"] = credential.accountId;
    }
    const response = await fetch("https://chatgpt.com/backend-api/codex/responses", {
      method: "POST",
      headers,
      body: JSON.stringify({ model, instructions, input, tools, store: false, stream: true }),
      signal: AbortSignal.timeout(180_000),
      redirect: "error",
    });
    if (!response.ok) {
      throw new Error(`ChatGPT request failed (${response.status}): ${(await response.text()).slice(0, 500)}`);
    }
    const text = await response.text();
    let completed: any;
    for (const line of text.split("\n")) {
      if (!line.startsWith("data: ") || line === "data: [DONE]") {
        continue;
      }
      try {
        const event = JSON.parse(line.slice(6));
        if (event.type === "response.completed") {
          completed = event.response;
        }
      } catch {
        // Ignore non-JSON SSE lines.
      }
    }
    if (!completed) {
      throw new Error("ChatGPT returned an incomplete response");
    }
    const output = completed.output || [];
    const content = output
      .flatMap((item) => item.content || [])
      .filter((item) => item.type === "output_text")
      .map((item) => item.text)
      .join("");
    const toolCalls = output
      .filter((item) => item.type === "function_call")
      .map((item) => ({
        id: item.call_id || item.id,
        type: "function",
        function: { name: item.name, arguments: item.arguments },
      }));
    return { message: { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) } };
  }
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
