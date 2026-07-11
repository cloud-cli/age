import { callModel, getModelList } from "./utils.mjs";

export async function OllamaListModels() {
  return await getModelList();
}

export async function OllamaCallModel(/* string */ model, /* string */ message) {
  const requestBody = {
    model,
    stream: false,
    think: true,
    messages: [{ role: "user", content: message }],
  };
  const response = await callModel(requestBody);
  return response.message;
}
