import { spawn } from "node:child_process";

const apiUrl = process.env.API_URL;
const apiKey = process.env.API_KEY;

export async function getModelList() {
  const response = await fetch(new URL("/v1/models", apiUrl), {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
  });
  const body = await response.json();
  return body.data.map((d) => ({ id: d.id }));
}

export async function callModel(requestBody) {
  const url = new URL("/api/chat", apiUrl).toString();
  const body = JSON.stringify(requestBody);

  if (process.env.OLLAMA_CURL) {
    return new Promise(async (resolve, reject) => {
      const auth = apiKey ? ["-H", `Authorization: Bearer ${apiKey}`] : [];
      const args = auth.concat([
        "-X",
        "POST",
        "-H",
        "Content-Type: application/json",
        url,
        "--data-binary",
        "@-",
      ]);

      const sh = spawn("curl", args);
      const chunks = [];
      sh.stderr.on("data", (c) => reject(c));
      sh.stdout.on("data", (c) => chunks.push(c));
      sh.stdout.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        resolve(JSON.parse(text));
      });
      sh.stdin.setDefaultEncoding('utf-8');
      sh.stdin.write(body);
      sh.stdin.end();
    });
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body,
  });

  return JSON.parse(await response.text());
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
