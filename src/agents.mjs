import { join, resolve } from "node:path";
import { functions as FS } from "./functions/fs.mjs";
import { functions as Git } from "./functions/git.mjs";
import { convertFunctionsToTools } from "./functions/tools.mjs";
import { readFile } from "node:fs/promises";

const API_KEY = process.env.API_KEY;
const modelApi = process.env.API_URL;
const defaultModel = process.env.MODEL;
const agentSystemPrompt = await readFile(
  new URL("./system.txt", import.meta.url),
  "utf8",
);

export const tools = [
  ...convertFunctionsToTools(FS),
  ...convertFunctionsToTools(Git),
];

const toolsByName = {
  ...FS,
  ...Git,
};

// console.log(JSON.stringify(tools, null, 2));

// call Ollama server to get a response from the model
// history is an array of messages, each message is an object with role and content, just like an OpenAI chat completion request
export async function getModelResponse(history, model = defaultModel) {
  const requestBody = JSON.stringify({
    model,
    tools,
    stream: false,
    think: true,
    messages: [
      {
        role: "system",
        content: agentSystemPrompt,
      },
      ...history,
    ],
  });

  const response = await fetch(new URL("/api/chat", modelApi), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { Authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: requestBody,
  });

  const body = await response.text();
  const json = JSON.parse(body);

  console.log("AI response", json);

  return json.message;
}

function convertValue(value, type) {
  switch (type) {
    case "string":
      return String(value);
    case "number":
      return Number(value);
    case "boolean":
      return Boolean(value);
    case "object":
      return typeof value === "object" ? value : JSON.parse(value);

    default:
      return value;
  }
}

// name and args are coming from a model response, and we want to execute the corresponding function from the tools array
export function executeFunction(functionName, modelArgs, workspacePath) {
  const specs = tools.find((next) => next.function.name === functionName);

  if (!specs) {
    throw new Error(`Function not found: ${functionName}`);
  }

  // an array with [name, { type: x }]
  const args = Object.entries(specs.function.parameters.properties);
  const foundArgs = [];

  for (const [argName, x] of args) {
    const { type } = x;
    const value = modelArgs[argName];

    if (value === undefined) {
      continue;
    }

    foundArgs.push(convertValue(value, type));
  }

  const f = toolsByName[functionName];
  const context = {
    getPath(s) {
      const x = join(workspacePath, "files", resolve("/", s || "."));
      console.log("GetPath", s, x);
      return x;
    },
  };

  console.log(`Call ${functionName}`, modelArgs, foundArgs, workspacePath);
  return f.apply(context, foundArgs);
}
