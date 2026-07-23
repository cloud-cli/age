import { callModel, getModelList, pullModel } from '../backend/ollama.mjs';

export async function OllamaListModels() {
  '##List pulled models##';
  return await getModelList();
}

export async function OllamaCallModel(/* string */ model, /* string */ message) {
  '##Call Ollama Chat API with the given model and message ##';
  const response = await callModel({
    model,
    stream: false,
    think: true,
    messages: [{ role: 'user', content: message }],
  });
  return response.message;
}

export async function OllamaSummarizeText(/*string*/ model, /*string*/ text) {
  '##Reduce text to a one-page summary##';
  const response = await callModel({
    model,
    stream: false,
    think: false,
    messages: [
      { role: 'user', content: 'Turn the following text into a one-page summary:' },
      { role: 'user', content: text },
    ],
  });
  return response.message;
}

export function OllamaPullModel(/*string*/ name) {
  '##Pull Ollama model##';
  return pullModel(name);
}
