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
  const response = await fetch(new URL("/api/chat", apiUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(requestBody),
  });

  const body = await response.text();
  return JSON.parse(body);
}
