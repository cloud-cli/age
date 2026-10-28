import { request } from "https";
import { callConfiguredModel, getConfiguredModels } from "../connectors.mjs";
import { teamFor } from "../teams.mjs";

const apiUrl = process.env.API_URL;
const apiKey = process.env.API_KEY;

export async function getModelList(subject?: string) {
  if (subject) {
    const teamId = subject.startsWith("team:") ? subject.slice(5) : await teamFor(subject);
    const configured = teamId ? await getConfiguredModels(`team:${teamId}`) : [];
    if (!apiUrl) {
      return configured;
    }
    let legacy: any[] = [];
    try {
      legacy = await getLegacyModelList();
    } catch {
      // User-configured provider models remain available if the legacy Ollama endpoint is offline.
    }
    return [...configured, ...legacy.map((model) => ({ ...model, default: model.id === process.env.MODEL }))];
  }
  return getLegacyModelList();
}

async function getLegacyModelList() {
  if (!apiUrl) {
    return [];
  }
  const response = await fetch(new URL("/v1/models", apiUrl), {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });
  const body: any = await response.json();
  return body.data.map((d) => ({ id: d.id }));
}

export async function callModel(requestBody, subject?: string) {
  if (subject) {
    const teamId = subject.startsWith("team:") ? subject.slice(5) : await teamFor(subject);
    const configured = teamId ? await callConfiguredModel(`team:${teamId}`, requestBody) : undefined;
    if (configured) {
      return configured;
    }
  }
  const url = new URL("/api/chat", apiUrl);
  const body = JSON.stringify(requestBody);
  console.log("CallModel started");

  // useful for slower response times. node fetch has a timeout that is hardcoded
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "POST",
      headers: {
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
    });

    req.on("response", (res) => {
      const all: Buffer[] = [];

      res.on("data", (c) => {
        all.push(c);
      });

      res.on("end", () => {
        const b = Buffer.concat(all).toString("utf8");

        try {
          console.log("CallModel finished");
          resolve(JSON.parse(b));
        } catch (e) {
          reject(e);
        }
      });

      res.on("error", reject);
    });

    req.write(body);
    req.end();
  });
}

export async function pullModel(model) {
  const response = await fetch(new URL("/api/pull", apiUrl), {
    method: "POST",
    body: JSON.stringify({ model }),
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });

  return response.ok;
}

export async function getChatTitle(history) {
  const system = `You are an expert at creating concise, 3-5 word chat session titles. Read the conversation history and generate an accurate, catchy title that captures the main topic. Do not include quotes or conversational filler, just the title.`;
  const res = await fetch(new URL("/api/generate", apiUrl), {
    method: "POST",
    body: JSON.stringify({
      model: "gemma2:9b",
      prompt: `Based on this conversation history, generate a title:\n` + history.map((h) => `${h.role}: ${h.content}`),
      system,
      stream: false,
    }),
  });

  if (res.ok) {
    return res.json();
  }

  const text = await res.text();
  throw new Error(text);
}
