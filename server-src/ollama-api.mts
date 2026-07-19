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
  console.log('CallModel started');

  // useful for slower response times. node fetch has a timeout that is hardcoded
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
          console.log('CallModel finished', b);
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
