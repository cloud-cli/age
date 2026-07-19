import { spawn } from "node:child_process";
import { request } from 'https';

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
  const url = new URL("/api/chat", apiUrl);
  const body = JSON.stringify(requestBody);
  console.log('CallModel', url, body)

  // useful for slower response times. node fetch has a timeout that is hardcoded
  if (process.env.NODE_HTTP) {
    return new Promise((resolve, reject) => {
      const req = request(url, {        
        method: 'POST',
        headers: {
          ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
        }
      });

      req.on('response', res => {
        const all = [];

        res.on("data", c => all.push(c));
        res.on('end', () => {
          const b = Buffer.concat(all).toString('utf8');

          try {
            resolve(JSON.parse(b));
          } catch (e) {
            reject(e);
          }
        });

        res.on('error', reject);
      });

      req.write(body);
      req.end();
    });
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body,
    });

    const text = await response.text();
    console.log('cm', text)
    return JSON.parse(text);
  } catch (e) {
    console.error('Ollama: ', e, JSON.stringify(e));
  }
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
